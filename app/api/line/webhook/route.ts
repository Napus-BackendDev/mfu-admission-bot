import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

import { answer } from "@/lib/gemini";
import { detectLanguageCode } from "@/lib/language";
import { loadConversation, saveConversation } from "@/lib/memory";
import {
  isTextMessage,
  pushText,
  reply,
  splitIntoBubbles,
  verifySignature,
  type LineTextMessageEvent,
  type LineWebhookBody,
} from "@/lib/line";

// node:crypto is used for signature verification, so this cannot run on the
// edge runtime.
export const runtime = "nodejs";

/**
 * How long to wait before replying.
 *
 * An instant answer to a detailed question reads as canned. A short pause makes
 * the bot feel like it is actually looking something up.
 *
 * The ceiling is not arbitrary: a LINE reply token is only valid for one minute
 * from the moment the webhook arrives, and generating the answer already spends
 * a few seconds of that. Anything much beyond 30s risks the token expiring
 * before the reply is sent, which would leave the applicant with silence.
 */
const REPLY_DELAY_MS = Math.min(
  Number(process.env.LINE_REPLY_DELAY_MS ?? 12000),
  30000,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A short typing-like pause between separate LINE chat bubbles. */
const BUBBLE_DELAY_MS = Math.max(
  0,
  Number(process.env.LINE_BUBBLE_DELAY_MS ?? 3000),
);

/** Generates and sends the answer for one message event. */
async function handleEvent(event: LineTextMessageEvent): Promise<void> {
  try {
    const conversationIdentity = event.source.userId
      ? [
          event.source.userId,
          event.source.groupId ?? event.source.roomId ?? "direct",
        ].join(":")
      : null;
    const memory = conversationIdentity
      ? await loadConversation(conversationIdentity)
      : null;
    const languageCode = detectLanguageCode(
      event.message.text,
      memory?.languageCode ?? null,
    );
    const result = await answer(event.message.text, {
      channel: "line",
      history: memory?.turns ?? [],
      languageHint: languageCode,
    });

    if (conversationIdentity) {
      await saveConversation(conversationIdentity, {
        languageCode:
          languageCode === "und" ? memory?.languageCode ?? null : languageCode,
        turns: [
          ...(memory?.turns ?? []),
          { role: "user", content: event.message.text },
          { role: "assistant", content: result.text },
        ],
        updatedAt: new Date().toISOString(),
      });
    }

    if (REPLY_DELAY_MS > 0) await sleep(REPLY_DELAY_MS);

    const bubbles = splitIntoBubbles(result.text);

    // A reply token can be used only once. Send the first bubble with it, then
    // use push messages for the remaining bubbles so each one can have its own
    // delay. Events without a userId cannot be pushed to, so retain the old
    // single-call behaviour for those uncommon cases.
    if (bubbles.length > 1 && event.source.userId) {
      await reply(event.replyToken, [bubbles[0]]);
      for (const bubble of bubbles.slice(1)) {
        if (BUBBLE_DELAY_MS > 0) await sleep(BUBBLE_DELAY_MS);
        await pushText(event.source.userId, bubble);
      }
    } else {
      await reply(event.replyToken, bubbles);
    }
  } catch (error) {
    console.error("[line] failed to answer", error);
    try {
      await reply(
        event.replyToken,
        "ขออภัยครับ ระบบมีปัญหาชั่วคราว รบกวนลองใหม่อีกครั้ง หรือติดต่อ interadmission@mfu.ac.th",
      );
    } catch (replyError) {
      console.error("[line] failed to send fallback reply", replyError);
    }
  }
}

/**
 * LINE webhook.
 *
 * Point the LINE Developers Console at https://<your-domain>/api/line/webhook
 *
 * LINE requires a 200 within two seconds of delivering an event, but answering
 * takes longer than that once the model runs and the reply delay is applied.
 * So the response is returned immediately and the work continues in the
 * background via waitUntil — which is also what LINE's own guidance recommends.
 * Blocking the response instead would report webhook timeouts to the channel
 * administrator on every single message.
 */
export async function POST(request: Request) {
  // The signature is computed over the exact bytes LINE sent, so the body has
  // to be read as text before anything parses it.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // LINE's "Verify" button sends an empty event list. Anything other than a
  // 200 here shows up as a failed webhook in the console.
  const events = body.events ?? [];
  const messages = events.filter(isTextMessage);

  if (messages.length > 0) {
    waitUntil(Promise.all(messages.map(handleEvent)));
  }

  return NextResponse.json({ ok: true });
}
