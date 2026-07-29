import { NextResponse } from "next/server";

import { answer } from "@/lib/gemini";
import {
  isTextMessage,
  reply,
  verifySignature,
  type LineWebhookBody,
} from "@/lib/line";

// node:crypto is used for signature verification, so this cannot run on the
// edge runtime.
export const runtime = "nodejs";

/**
 * LINE webhook.
 *
 * Point the LINE Developers Console at https://<your-domain>/api/line/webhook
 *
 * Every reply is generated inside this request because a reply token is
 * single-use and short-lived — there is no queue to hand the work off to
 * without also switching to the push-message API and paying per message.
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

  await Promise.all(
    events.map(async (event) => {
      if (!isTextMessage(event)) return;

      try {
        const result = await answer(event.message.text, { channel: "line" });
        await reply(event.replyToken, result.text);
      } catch (error) {
        console.error("[line] failed to answer", error);
        // The applicant is waiting on a reply, so say something rather than
        // leaving the message unanswered.
        try {
          await reply(
            event.replyToken,
            "Sorry, something went wrong on my end. Please try again in a moment, or email interadmission@mfu.ac.th.",
          );
        } catch (replyError) {
          console.error("[line] failed to send fallback reply", replyError);
        }
      }
    }),
  );

  // LINE retries on any non-2xx, which would double-send replies, so always
  // acknowledge once the events have been handled.
  return NextResponse.json({ ok: true });
}
