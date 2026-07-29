import { NextResponse } from "next/server";

import { answer, type Turn } from "@/lib/gemini";

export const runtime = "nodejs";

/**
 * Chat endpoint for the test page.
 *
 * Same answering engine the LINE webhook uses, so testing here exercises the
 * real knowledge base and the real prompt — only the reply formatting differs.
 */
export async function POST(request: Request) {
  let payload: { message?: unknown; history?: unknown; channel?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const history: Turn[] = Array.isArray(payload.history)
    ? (payload.history as unknown[])
        .filter(
          (turn): turn is Turn =>
            typeof turn === "object" &&
            turn !== null &&
            (turn as Turn).role !== undefined &&
            typeof (turn as Turn).content === "string",
        )
        // Keep the tail only. The knowledge base already carries every fact,
        // so older turns add cost without adding much.
        .slice(-10)
    : [];

  // Defaults to web. Accepting an override lets the LINE formatting be tested
  // from here without going through a real LINE channel.
  const channel = payload.channel === "line" ? "line" : "web";

  try {
    const result = await answer(message, { channel, history });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[chat] failed to answer", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
