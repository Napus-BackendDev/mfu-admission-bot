import crypto from "node:crypto";

import { Redis } from "@upstash/redis";

import type { Turn } from "@/lib/gemini";

const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TURNS = 8;
const MAX_TURN_CHARACTERS = 2000;

export type ConversationMemory = {
  languageCode: string | null;
  turns: Turn[];
  updatedAt: string;
};

let redis: Redis | null | undefined;

export function isMemoryConfigured(): boolean {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return Boolean(
    url &&
      token &&
      (process.env.CONVERSATION_HASH_SECRET || process.env.LINE_CHANNEL_SECRET),
  );
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  if (!isMemoryConfigured()) {
    redis = null;
    return redis;
  }

  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL!,
    token:
      process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN!,
  });
  return redis;
}

function memoryKey(identity: string): string {
  const secret =
    process.env.CONVERSATION_HASH_SECRET ?? process.env.LINE_CHANNEL_SECRET!;
  const digest = crypto.createHmac("sha256", secret).update(identity).digest("hex");
  return `mfu:conversation:${digest}`;
}

export async function loadConversation(
  identity: string,
): Promise<ConversationMemory | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    return await client.get<ConversationMemory>(memoryKey(identity));
  } catch (error) {
    console.error("[memory] failed to load conversation", error);
    return null;
  }
}

export async function saveConversation(
  identity: string,
  memory: ConversationMemory,
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  const safeMemory: ConversationMemory = {
    ...memory,
    turns: memory.turns.slice(-MAX_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_TURN_CHARACTERS),
    })),
  };

  try {
    await client.set(memoryKey(identity), safeMemory, { ex: TTL_SECONDS });
  } catch (error) {
    // Memory is an enhancement, never a reason to make admissions go silent.
    console.error("[memory] failed to save conversation", error);
  }
}
