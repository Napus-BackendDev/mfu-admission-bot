import { NextResponse } from "next/server";

import {
  getDriveKnowledge,
  getDriveMode,
  invalidateDriveCache,
  isDriveConfigured,
} from "@/lib/drive";

export const runtime = "nodejs";

/**
 * Health and sync status.
 *
 * This exists so that after handover someone can answer "is the bot actually
 * reading my Google Doc?" without reading any code. It lists every document
 * the bot can see, when each was last edited, and every file it had to skip.
 *
 * POST to the same URL forces an immediate re-read instead of waiting for the
 * cache to expire.
 */
export async function GET() {
  const drive = await getDriveKnowledge();

  return NextResponse.json({
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY),
    },
    drive: {
      configured: isDriveConfigured(),
      mode: getDriveMode(),
      reachable: drive !== null,
      documentCount: drive?.documents.length ?? 0,
      lastSyncedAt: drive ? new Date(drive.fetchedAt).toISOString() : null,
      documents:
        drive?.documents.map((doc) => ({
          name: doc.name,
          lastEditedAt: doc.modifiedTime,
          characters: doc.text.length,
        })) ?? [],
      // Anything Drive returned that could not be turned into text. Surfaced
      // because a PDF dropped into the folder looks like it worked otherwise.
      skipped: drive?.skipped ?? [],
    },
    bundledGuides: {
      note: "The 2-2026 admission guides are always available, even when Drive is not.",
    },
  });
}

export async function POST() {
  invalidateDriveCache();
  const drive = await getDriveKnowledge();

  return NextResponse.json({
    refreshed: true,
    documentCount: drive?.documents.length ?? 0,
    documents: drive?.documents.map((doc) => doc.name) ?? [],
  });
}
