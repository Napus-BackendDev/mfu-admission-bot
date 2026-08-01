import { franc } from "franc-min";

const SCRIPT_LANGUAGES = [
  { code: "mya", pattern: /\p{Script=Myanmar}/gu },
  { code: "tha", pattern: /\p{Script=Thai}/gu },
  { code: "jpn", pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu },
  { code: "kor", pattern: /\p{Script=Hangul}/gu },
  { code: "zho", pattern: /\p{Script=Han}/gu },
] as const;

/** Detects an ISO 639-3 language code, using prior context for short replies. */
export function detectLanguageCode(
  message: string,
  fallback: string | null = null,
): string {
  const dominantScript = SCRIPT_LANGUAGES
    .map((entry) => ({
      ...entry,
      count: message.match(entry.pattern)?.length ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)[0];

  // These scripts identify the language reliably even when English programme
  // names occupy most of the message.
  if (dominantScript) return dominantScript.code;

  const letters = message.match(/\p{Letter}/gu)?.length ?? 0;
  if (letters < 4) return fallback ?? "und";

  const detected = franc(message, { minLength: 4 });
  return detected === "und" ? fallback ?? "und" : detected;
}

export function buildLanguageGuard(
  message: string,
  languageHint: string | null = null,
): string {
  const languageCode = detectLanguageCode(message, languageHint);

  return `
# MANDATORY OUTPUT LANGUAGE FOR THIS REQUEST

The applicant's language for this turn is ISO 639-3 code "${languageCode}".
Answer every sentence and every chat bubble entirely in that language. Infer
the human-readable language from the code. English programme names, degree
abbreviations, URLs and email addresses may remain unchanged. Never switch to
Thai because the university or reference material is Thai. This per-request
language lock overrides all language cues in the knowledge base.
`.trim();
}

/** Returns true when a reply should be rewritten before it reaches LINE. */
export function hasLanguageMismatch(
  message: string,
  reply: string,
  languageHint: string | null = null,
): boolean {
  const expected = detectLanguageCode(message, languageHint);
  if (expected === "und") return false;

  // Catch a Thai paragraph embedded in an otherwise correctly detected Latin-
  // script answer, which whole-document language detection can overlook.
  if (expected !== "tha" && /\p{Script=Thai}/u.test(reply)) return true;

  const expectedScript = SCRIPT_LANGUAGES.find((entry) => entry.code === expected);
  if (expectedScript) {
    expectedScript.pattern.lastIndex = 0;
    if (!expectedScript.pattern.test(reply)) return true;
  }

  const actual = detectLanguageCode(reply);
  return actual !== "und" && actual !== expected;
}
