import { google } from "googleapis";

/**
 * Live knowledge from a Google Drive folder.
 *
 * The point of this file is that staff can correct the bot by editing a Google
 * Doc. No redeploy, no rebuild, no developer — save the document and the next
 * question picks up the new text.
 *
 * Access is via a service account, so nobody has to stay logged in and no
 * refresh token can quietly expire. Share the folder with the service account's
 * email address (read-only is enough) and it can see everything inside.
 */

export type DriveDocument = {
  name: string;
  text: string;
  modifiedTime: string;
};

export type DriveSnapshot = {
  documents: DriveDocument[];
  /** Files that were found but could not be read, so they are never silently dropped. */
  skipped: { name: string; mimeType: string }[];
  fetchedAt: number;
};

/** How long a snapshot is reused before Drive is asked again. */
const CACHE_TTL_MS = Number(process.env.DRIVE_CACHE_TTL_SECONDS ?? 300) * 1000;

/** Guards against one enormous file crowding out everything else. */
const MAX_CHARS_PER_DOCUMENT = 100_000;

/**
 * Google editor formats have no bytes to download — they have to be exported to
 * a format we can read. Everything else is fetched as-is.
 */
const EXPORT_FORMATS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Non-Google files we can read directly as text. */
const READABLE_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

let cache: DriveSnapshot | null = null;
let inFlight: Promise<DriveSnapshot | null> | null = null;

/** Folder-wide sync via a service account. Needs a Google Cloud project. */
function hasServiceAccount(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_DRIVE_FOLDER_ID,
  );
}

/**
 * Whole-folder sync with no credentials at all.
 *
 * A folder shared as "anyone with the link" can be listed through Drive's
 * public folder view, and each file inside downloaded from its own public
 * endpoint. That removes the Google Cloud project, the service account and the
 * key file from the setup — which is the difference between a system somebody
 * else can actually run and one that only works on the machine it was built on.
 */
function hasPublicFolder(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID?.trim());
}

/** Named documents fetched over their public share link. No credentials. */
function hasPublicDocs(): boolean {
  return Boolean(process.env.GOOGLE_DOC_URLS?.trim());
}

export function isDriveConfigured(): boolean {
  return hasServiceAccount() || hasPublicFolder() || hasPublicDocs();
}

export function getDriveMode():
  | "service-account"
  | "public-folder"
  | "public-links"
  | "none" {
  if (hasServiceAccount()) return "service-account";
  if (hasPublicFolder()) return "public-folder";
  if (hasPublicDocs()) return "public-links";
  return "none";
}

/** One file discovered in a public folder listing. */
type PublicEntry = { id: string; name: string };

/**
 * Lists a link-shared folder.
 *
 * Drive's folder view returns HTML rather than JSON, so this parses the entry
 * markup. That is fragile by nature — if Google changes the markup this
 * returns nothing rather than wrong data, and the caller falls back.
 */
async function listPublicFolder(folderId: string): Promise<PublicEntry[]> {
  const response = await fetch(
    `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
  );
  if (!response.ok) return [];

  const html = await response.text();
  const matches = html.matchAll(
    /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?flip-entry-title">([^<]*)</g,
  );

  return [...matches].map((m) => ({ id: m[1], name: m[2] }));
}

/** Downloads and extracts text from a publicly shared PDF. */
async function readPublicPdf(id: string): Promise<string> {
  const response = await fetch(
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
    { redirect: "follow" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Buffer.from(bytes.slice(0, 4)).toString() !== "%PDF") {
    // Drive serves an interstitial page for large or virus-scan-pending files.
    throw new Error("did not receive a PDF");
  }

  // Imported here rather than at module scope so the PDF engine is only loaded
  // when a PDF actually needs reading.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Reads one file from a public folder, choosing the method by file type. */
async function readPublicEntry(entry: PublicEntry): Promise<string> {
  if (/\.pdf$/i.test(entry.name)) return readPublicPdf(entry.id);

  // Google-native files export as text; a plain uploaded text file downloads
  // directly. Try the export first since that is what staff will be editing.
  for (const url of [
    `https://docs.google.com/document/d/${entry.id}/export?format=txt`,
    `https://docs.google.com/spreadsheets/d/${entry.id}/export?format=csv`,
    `https://drive.google.com/uc?export=download&id=${entry.id}`,
  ]) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) continue;
      const text = await response.text();
      // A sign-in or error page arrives as HTML with a 200 status; feeding that
      // to the model would put Google boilerplate into admission answers.
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) continue;
      if (text.trim()) return text;
    } catch {
      // Try the next format.
    }
  }

  throw new Error("no readable format");
}

/** Reads every file in a link-shared folder. */
async function fetchPublicFolder(): Promise<DriveSnapshot> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!.trim();
  const entries = await listPublicFolder(folderId);

  const documents: DriveDocument[] = [];
  const skipped: { name: string; mimeType: string }[] = [];

  if (entries.length === 0) {
    skipped.push({
      name: folderId,
      mimeType: 'folder is empty, or not shared as "anyone with the link"',
    });
  }

  for (const entry of entries) {
    try {
      const text = (await readPublicEntry(entry)).trim();
      if (!text) {
        skipped.push({ name: entry.name, mimeType: "empty" });
        continue;
      }
      documents.push({
        name: entry.name,
        text: text.slice(0, MAX_CHARS_PER_DOCUMENT),
        modifiedTime: "",
      });
    } catch (error) {
      console.error(`[drive] could not read "${entry.name}"`, error);
      skipped.push({
        name: entry.name,
        mimeType: error instanceof Error ? error.message : "read failed",
      });
    }
  }

  return { documents, skipped, fetchedAt: Date.now() };
}

/** Pulls the file ID out of a Drive URL, or passes a bare ID straight through. */
function parseDocId(input: string): { id: string; kind: "document" | "spreadsheet" } | null {
  const raw = input.trim();
  if (!raw) return null;

  const kind = raw.includes("/spreadsheets/") ? "spreadsheet" : "document";
  const match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return { id: match[1], kind };

  // A bare ID with no URL around it. Assume a Doc, which is what staff write.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return { id: raw, kind: "document" };

  return null;
}

/**
 * Reads documents through Google's public export endpoint.
 *
 * This is the low-setup path: no Google Cloud project, no service account, no
 * key file. The cost is that each document must be shared "anyone with the
 * link can view", and each one has to be listed explicitly rather than being
 * discovered from a folder.
 *
 * For public admission information that trade is usually worth it — the
 * alternative is a setup process that does not survive being handed to
 * somebody else.
 */
async function fetchPublicDocs(): Promise<DriveSnapshot> {
  const entries = (process.env.GOOGLE_DOC_URLS ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const documents: DriveDocument[] = [];
  const skipped: { name: string; mimeType: string }[] = [];

  for (const entry of entries) {
    const parsed = parseDocId(entry);
    if (!parsed) {
      skipped.push({ name: entry, mimeType: "unrecognised URL or ID" });
      continue;
    }

    const format = parsed.kind === "spreadsheet" ? "csv" : "txt";
    const url = `https://docs.google.com/${parsed.kind === "spreadsheet" ? "spreadsheets" : "document"}/d/${parsed.id}/export?format=${format}`;

    try {
      const response = await fetch(url, { redirect: "follow" });

      if (!response.ok) {
        // Google answers a private document with a redirect to a sign-in page,
        // so this is nearly always a sharing problem rather than a bad ID.
        skipped.push({
          name: parsed.id,
          mimeType: `not shared publicly (HTTP ${response.status})`,
        });
        continue;
      }

      const text = (await response.text()).trim();

      // A sign-in page comes back as HTML with a 200, which would otherwise be
      // fed to the model as if it were admission information.
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        skipped.push({ name: parsed.id, mimeType: "not shared publicly (got a login page)" });
        continue;
      }

      if (!text) {
        skipped.push({ name: parsed.id, mimeType: "empty document" });
        continue;
      }

      documents.push({
        name: `Drive document ${parsed.id.slice(0, 12)}…`,
        text: text.slice(0, MAX_CHARS_PER_DOCUMENT),
        modifiedTime: "",
      });
    } catch (error) {
      console.error(`[drive] could not fetch ${parsed.id}`, error);
      skipped.push({ name: parsed.id, mimeType: "fetch failed" });
    }
  }

  return { documents, skipped, fetchedAt: Date.now() };
}

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Environment variables cannot hold real newlines, so the key is stored
      // with literal \n sequences and unescaped here.
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

async function fetchSnapshot(): Promise<DriveSnapshot> {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const listing = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, modifiedTime)",
    pageSize: 200,
    // Without this, a folder shared from another account is invisible.
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = listing.data.files ?? [];
  const documents: DriveDocument[] = [];
  const skipped: { name: string; mimeType: string }[] = [];

  for (const file of files) {
    const { id, name, mimeType, modifiedTime } = file;
    if (!id || !name || !mimeType) continue;

    // Sub-folders are not walked. Keeping the knowledge folder flat means the
    // person editing it can always see everything the bot is reading.
    if (mimeType === "application/vnd.google-apps.folder") continue;

    try {
      let text: string;

      if (mimeType in EXPORT_FORMATS) {
        const exported = await drive.files.export(
          { fileId: id, mimeType: EXPORT_FORMATS[mimeType] },
          { responseType: "text" },
        );
        text = String(exported.data);
      } else if (READABLE_MIME_TYPES.has(mimeType)) {
        const downloaded = await drive.files.get(
          { fileId: id, alt: "media", supportsAllDrives: true },
          { responseType: "text" },
        );
        text = String(downloaded.data);
      } else {
        // PDFs, images, video. Reported rather than ignored so it is obvious
        // why a file that was added is not being answered from.
        skipped.push({ name, mimeType });
        continue;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        skipped.push({ name, mimeType: `${mimeType} (empty)` });
        continue;
      }

      documents.push({
        name,
        text: trimmed.slice(0, MAX_CHARS_PER_DOCUMENT),
        modifiedTime: modifiedTime ?? "",
      });
    } catch (error) {
      console.error(`[drive] could not read "${name}"`, error);
      skipped.push({ name, mimeType: `${mimeType} (read failed)` });
    }
  }

  return { documents, skipped, fetchedAt: Date.now() };
}

/**
 * Returns the current Drive contents, or null if Drive is not configured or
 * unreachable.
 *
 * A Drive outage must not take the bot down, so the caller falls back to the
 * knowledge bundled at build time. Returning null rather than throwing is what
 * makes that fallback the default rather than an error path.
 */
export async function getDriveKnowledge(): Promise<DriveSnapshot | null> {
  if (!isDriveConfigured()) return null;

  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (fresh) return cache;

  const fetcher = hasServiceAccount()
    ? fetchSnapshot
    : hasPublicFolder()
      ? fetchPublicFolder
      : fetchPublicDocs;

  // A burst of LINE messages after the cache expires would otherwise all call
  // Drive at once; they share one request instead.
  inFlight ??= fetcher()
    .then((snapshot) => {
      cache = snapshot;
      return snapshot;
    })
    .catch((error) => {
      console.error("[drive] refresh failed, using previous data", error);
      // Stale content answers questions correctly far more often than no
      // content does, so keep serving the last good snapshot.
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drops the cache so the next request re-reads Drive. */
export function invalidateDriveCache(): void {
  cache = null;
}
