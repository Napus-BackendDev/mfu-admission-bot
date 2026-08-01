import { GoogleGenAI, ThinkingLevel } from "@google/genai";

import { buildSystemPrompt, type Channel } from "@/lib/knowledge";

/**
 * Gemini Flash on the free tier.
 *
 * Chosen over a paid model because this has to run at no cost after handover.
 * The large context window is what makes the no-retrieval design viable: the
 * entire knowledge base is sent on every request rather than being chunked and
 * searched.
 *
 * Flash-Lite rather than Flash, because the free tier caps the full Flash model
 * at 20 requests per day per project — measured, not guessed. That is a demo,
 * not a service. Flash-Lite's allowance is far larger and the task here is
 * reading facts out of context that is already in the prompt, which is exactly
 * what the smaller model is good at.
 *
 * The floating "latest" alias is deliberate. A pinned version eventually stops
 * accepting new callers — `gemini-2.5-flash` already did, with a 404 that would
 * have taken the bot down. Nobody is maintaining this after handover, so
 * surviving Google's deprecations unattended matters more than pinning exact
 * behaviour. Set GEMINI_MODEL to override if a specific version is ever needed.
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";

/**
 * Replies are two or three sentences by design, and LINE will not show more
 * than 5,000 characters anyway.
 *
 * This ceiling covers thinking as well as the reply. Set it too low and the
 * model spends the whole budget thinking and returns a truncated sentence — a
 * 100-token cap produced the literal reply "2 + 2" in testing.
 */
const MAX_OUTPUT_TOKENS = 2048;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey " +
        "and add it to .env.local",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export type Turn = { role: "user" | "assistant"; content: string };

export type AnswerResult = {
  text: string;
  /** How many staff-maintained Drive documents were in scope for this answer. */
  driveDocumentCount: number;
  promptTokens: number;
  outputTokens: number;
};

const FALLBACK_MESSAGE =
  "Sorry, I could not answer that one. Please email interadmission@mfu.ac.th and the admissions team will help you.";

/**
 * Shown when the free-tier quota is exhausted.
 *
 * This is not hypothetical — a handful of test runs was enough to trigger it.
 * Without this the applicant would receive a raw Google error mentioning
 * billing plans, which is both confusing and looks broken.
 */
const QUOTA_MESSAGE =
  "ขออภัยครับ ตอนนี้มีผู้ใช้งานพร้อมกันจำนวนมาก รบกวนลองถามใหม่อีกครั้งในอีกสักครู่ " +
  "หากเร่งด่วน ติดต่อได้ที่ interadmission@mfu.ac.th\n\n" +
  "Sorry, the assistant is busy right now. Please try again shortly, " +
  "or email interadmission@mfu.ac.th if it is urgent.";

/** True when Gemini refused because the quota or rate limit was hit. */
function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || /quota|rate limit/i.test(message);
}

/**
 * True when the exhausted quota is the daily one rather than the per-minute
 * one.
 *
 * The two need opposite handling. A per-minute limit clears in seconds, so
 * retrying is worth it. A daily limit does not clear until tomorrow, so
 * retrying only burns the LINE reply token and leaves the applicant with
 * silence instead of an answer.
 */
function isDailyQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /PerDay|per day/i.test(message);
}

/**
 * Backoff for the per-minute limit only — see isDailyQuotaError above.
 *
 * Two applicants asking at the same moment is enough to trip the per-minute
 * cap, and turning that into "the assistant is busy" would abandon a question
 * that was seconds from being answered.
 *
 * Kept short deliberately: a LINE reply token expires, so it is better to
 * answer honestly that we are busy than to hold the request until the token is
 * dead and the applicant gets nothing at all.
 */
const RETRY_DELAYS_MS = [2000, 5000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ScriptRule = {
  name: string;
  language: string;
  pattern: RegExp;
};

// Non-Latin scripts are deterministic signals even when an applicant mixes in
// English programme names. This guard prevents the English source material or
// Thai university context from pulling the reply into the wrong language.
const SCRIPT_RULES: ScriptRule[] = [
  { name: "Myanmar", language: "Burmese", pattern: /\p{Script=Myanmar}/gu },
  { name: "Thai", language: "Thai", pattern: /\p{Script=Thai}/gu },
  {
    name: "Japanese",
    language: "Japanese",
    pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  },
  { name: "Korean", language: "Korean", pattern: /\p{Script=Hangul}/gu },
  { name: "Han", language: "Chinese", pattern: /\p{Script=Han}/gu },
  { name: "Arabic", language: "the language used by the applicant", pattern: /\p{Script=Arabic}/gu },
  { name: "Cyrillic", language: "the language used by the applicant", pattern: /\p{Script=Cyrillic}/gu },
  { name: "Devanagari", language: "the language used by the applicant", pattern: /\p{Script=Devanagari}/gu },
];

export function buildLanguageGuard(message: string): string {
  const detected = SCRIPT_RULES
    .map((rule) => ({ ...rule, count: message.match(rule.pattern)?.length ?? 0 }))
    .filter((rule) => rule.count > 0)
    .sort((a, b) => b.count - a.count)[0];

  if (detected) {
    return `
# MANDATORY OUTPUT LANGUAGE FOR THIS REQUEST

The applicant's latest message contains ${detected.name} script. Answer this
request entirely in ${detected.language}. English programme names, degree
abbreviations and email addresses may remain unchanged. Do not answer in Thai
unless the detected language above is Thai. This request-specific rule
overrides any language implied by the university name or reference documents.
`.trim();
  }

  return `
# MANDATORY OUTPUT LANGUAGE FOR THIS REQUEST

Identify the exact language of the applicant's latest message and answer
entirely in that language. Do not default to Thai. English programme names,
degree abbreviations and email addresses may remain unchanged.
`.trim();
}

/**
 * Answers an applicant's question from the admission guides and the
 * staff-maintained Drive notes.
 */
export async function answer(
  question: string,
  { channel, history = [] }: { channel: Channel; history?: Turn[] },
): Promise<AnswerResult> {
  const system = await buildSystemPrompt(channel);
  const languageGuard = buildLanguageGuard(question);

  const request = {
    model: MODEL,
    contents: [
      ...history.map((turn) => ({
        // Gemini calls the assistant side "model", not "assistant".
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      { role: "user", parts: [{ text: question }] },
    ],
    config: {
      // Kept at the very end so the per-request language decision is closer to
      // generation than the large English-language knowledge base.
      systemInstruction: `${system.text}\n\n${languageGuard}`,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The answer is a lookup against context the model already has, so
      // near-deterministic output is what we want — the same question should
      // not produce a different fee twice.
      temperature: 0.2,
      // This is a lookup against context the model already has, not a
      // reasoning task, so thinking is held to the minimum. Note the older
      // `thinkingBudget: 0` form is rejected with a 400 on Gemini 3.x — the
      // level enum is the supported way to turn it down. Leaving it unset is
      // not an option either: thinking then eats the output budget and the
      // reply comes back truncated mid-sentence.
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  };

  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await getClient().models.generateContent(request);
      break;
    } catch (error) {
      if (!isQuotaError(error)) throw error;

      // Retrying a daily limit cannot succeed, so fall through immediately
      // rather than making the applicant wait for a foregone conclusion.
      if (!isDailyQuotaError(error) && attempt < RETRY_DELAYS_MS.length) {
        console.warn(
          `[gemini] rate limited, retrying in ${RETRY_DELAYS_MS[attempt]}ms`,
        );
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      // Still limited after the retries. The applicant gets a sentence they
      // can act on rather than a stack trace; the detail stays in the logs.
      console.error("[gemini] quota exhausted after retries", error);
      return {
        text: QUOTA_MESSAGE,
        driveDocumentCount: system.driveDocumentCount,
        promptTokens: 0,
        outputTokens: 0,
      };
    }
  }

  const usage = response.usageMetadata;
  const text = response.text?.trim();

  return {
    // An empty response means a safety filter fired or the model returned
    // nothing usable; either way the applicant needs a route to a human.
    text: text || FALLBACK_MESSAGE,
    driveDocumentCount: system.driveDocumentCount,
    promptTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}
