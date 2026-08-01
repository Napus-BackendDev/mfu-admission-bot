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
  source: { userId?: string; groupId?: string; roomId?: string; type: string };
  message: { type: "text"; id: string; text: string };
};

type LineEvent =
  | LineTextMessageEvent
  | {
      type: string;
      replyToken?: string;
      source?: {
        userId?: string;
        groupId?: string;
        roomId?: string;
        type: string;
      };
    };

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

/** LINE accepts at most this many message objects in one reply. */
const MAX_MESSAGES_PER_REPLY = 5;

/**
 * Removes the markdown the model occasionally emits despite being told not to.
 *
 * LINE renders plain text, so `**39,000 THB**` arrives with the asterisks
 * showing. The system prompt forbids markdown, but a model will still slip
 * every so often, and a stray `**` around a fee looks broken to an applicant.
 * Stripping the few markers that actually turn up is cheap insurance the prompt
 * alone cannot guarantee.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // **bold** / *italic* / __bold__ / _italic_ around a run of text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      // leading markdown heading marks
      .replace(/^#{1,6}\s+/gm, "")
      // [label](url) -> label (url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
  );
}

/**
 * Splits an answer into separate chat bubbles.
 *
 * One long block is hard to read on a phone. Splitting on blank lines follows
 * the shape the model already writes — a lead sentence, then the detail —
 * so each bubble is a complete thought rather than an arbitrary slice.
 *
 * LINE caps a reply at five messages, so anything beyond the fourth is merged
 * back into the last bubble instead of being dropped.
 */
export function splitIntoBubbles(text: string): string[] {
  const paragraphs = stripMarkdown(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];
  if (paragraphs.length <= MAX_MESSAGES_PER_REPLY) {
    return paragraphs.map((p) => p.slice(0, MAX_MESSAGE_LENGTH));
  }

  const head = paragraphs.slice(0, MAX_MESSAGES_PER_REPLY - 1);
  const tail = paragraphs.slice(MAX_MESSAGES_PER_REPLY - 1).join("\n\n");
  return [...head, tail].map((p) => p.slice(0, MAX_MESSAGE_LENGTH));
}

/**
 * Replies to a LINE event, as one or more bubbles.
 *
 * A reply token is single-use and valid for one minute from the moment the
 * webhook arrived, so everything — generating the answer and any deliberate
 * delay — has to fit inside that window.
 */
export async function reply(
  replyToken: string,
  text: string | string[],
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is not set. See README.md for how to get one.",
    );
  }

  const bubbles = (
    Array.isArray(text) ? text : splitIntoBubbles(text)
  ).slice(0, MAX_MESSAGES_PER_REPLY);

  if (bubbles.length === 0) return;

  const response = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: bubbles.map((body) => ({ type: "text", text: body })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE reply failed (${response.status}): ${detail}`);
  }
}

/** Sends one text bubble after the reply token has already been consumed. */
export async function pushText(to: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is not set. See README.md for how to get one.",
    );
  }

  const body = stripMarkdown(text).trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!body) return;

  const response = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text: body }] }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE push failed (${response.status}): ${detail}`);
  }
}
