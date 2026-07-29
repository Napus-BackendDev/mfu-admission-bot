"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

type Stats = {
  driveDocumentCount: number;
  promptTokens: number;
  outputTokens: number;
};

const SUGGESTIONS = [
  "Which programmes can I apply to for the second semester?",
  "How much is tuition for Software Engineering?",
  "What English test score do I need for a master's degree?",
  "ค่าเทอมปริญญาตรีเท่าไหร่",
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    const history = turns;
    setTurns([...history, { role: "user", content: trimmed }]);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "Request failed");

      setTurns((current) => [...current, { role: "assistant", content: data.text }]);
      setStats({
        driveDocumentCount: data.driveDocumentCount,
        promptTokens: data.promptTokens,
        outputTokens: data.outputTokens,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
      <header className="border-b border-stone-300 py-6">
        <h1 className="text-xl font-semibold text-mfu">MFU Admission Assistant</h1>
        <p className="mt-1 text-sm text-stone-600">
          Answers come only from the official Mae Fah Luang University Admission
          Guide 2-2026 for international applicants.
        </p>
      </header>

      <div className="flex-1 space-y-4 py-6">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-stone-500">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-left text-sm text-stone-700 transition hover:border-mfu hover:text-mfu"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                turn.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-mfu px-4 py-2.5 text-white"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-2.5"
              }
            >
              {turn.content}
            </div>
          </div>
        ))}

        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-2.5 text-stone-400">
              Thinking…
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 border-t border-stone-300 bg-stone-100 py-4"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about programmes, fees, deadlines, documents…"
            disabled={pending}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-mfu disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-lg bg-mfu px-5 py-2.5 font-medium text-white transition hover:bg-mfu-dark disabled:opacity-40"
          >
            Send
          </button>
        </div>

        {stats && (
          // Shown so it is obvious at a glance whether the Drive documents are
          // actually reaching the model, which is the thing most likely to be
          // misconfigured after handover.
          <p className="mt-2 text-xs text-stone-500">
            Drive documents in use: {stats.driveDocumentCount} · prompt{" "}
            {stats.promptTokens.toLocaleString()} tokens · reply{" "}
            {stats.outputTokens.toLocaleString()} tokens
          </p>
        )}
      </form>
    </main>
  );
}
