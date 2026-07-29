import crypto from "node:crypto";

/**
 * Minimal LINE Messaging API client.
 *
 * Only the two things the chatbot actually needs: proving an incoming webhook
 * really came from LINE, and replying to it.
 */

const LINE_API = "https://api.line.me/v2/bot";

/** LINE rejects a text message longer than this. */
const MAX_MESSAGE_LENGTH = 5000;

export type LineTextMessageEvent = {
  type: "message";
  replyToken: string;
  source: { userId?: string; type: string };
  message: { type: "text"; id: string; text: string };
};

type LineEvent =
  | LineTextMessageEvent
  | { type: string; replyToken?: string; source?: { userId?: string; type: string } };

export type LineWebhookBody = { destination?: string; events: LineEvent[] };

/**
 * Verifies the `x-line-signature` header against the raw request body.
 *
 * The webhook URL is public, so without this anyone who finds it could make
 * the bot reply to messages that were never sent. The body must be the exact
 * bytes LINE sent — re-serialising the parsed JSON changes the signature.
 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on a length mismatch, so check that first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Narrows a webhook event to a plain text message from a user. */
export function isTextMessage(event: LineEvent): event is LineTextMessageEvent {
  return (
    event.type === "message" &&
    "message" in event &&
    (event as LineTextMessageEvent).message?.type === "text"
  );
}

/**
 * Replies to a LINE event.
 *
 * A reply token is single-use and expires shortly after the event arrives, so
 * this has to be called within the same request that received the webhook.
 */
export async function reply(replyToken: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is not set. See README.md for how to get one.",
    );
  }

  const body = text.slice(0, MAX_MESSAGE_LENGTH);

  const response = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: body }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE reply failed (${response.status}): ${detail}`);
  }
}
