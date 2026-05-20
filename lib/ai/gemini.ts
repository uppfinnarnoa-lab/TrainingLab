import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIClient, AIMessage, StreamChunk } from "./client";

// ── In-process cache registry ─────────────────────────────────────────────
// Stores Gemini cached content per user. Survives within one server process.
// For multi-instance deployments, move this to Redis.
interface CacheEntry {
  cacheName: string;   // Gemini cache resource name
  expiresAt: Date;
  systemPrompt: string; // detect if system prompt changed → invalidate
}
const cacheRegistry = new Map<string, CacheEntry>();

// Cache TTL: 1 hour minimum (Gemini requirement). We refresh at 50 min to
// ensure it doesn't expire mid-conversation.
const CACHE_TTL_SEC = 3600;       // 1 hour
const CACHE_REFRESH_AT_SEC = 3000; // refresh after 50 min

export class GeminiClient implements AIClient {
  readonly provider = "gemini" as const;
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *stream(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk> {
    // Try to use context caching for the system prompt.
    // Falls back to standard request if caching fails (e.g. free tier).
    let cachedContent: Awaited<ReturnType<typeof this.getOrCreateCache>> | null = null;

    try {
      cachedContent = await this.getOrCreateCache(systemPrompt);
    } catch {
      // Free tier or API error — proceed without cache
    }

    if (cachedContent) {
      yield* this.streamWithCache(cachedContent, messages, recentContext);
    } else {
      yield* this.streamStandard(systemPrompt, messages, recentContext);
    }
  }

  // ── Cached path (paid tier) ──────────────────────────────────────────────
  private async getOrCreateCache(systemPrompt: string) {
    const cacheKey = `gemini_sys_${Buffer.from(systemPrompt.slice(0, 100)).toString("base64")}`;
    const existing = cacheRegistry.get(cacheKey);
    const now = new Date();

    if (existing && existing.expiresAt > now && existing.systemPrompt === systemPrompt) {
      return { cacheName: existing.cacheName, cacheKey };
    }

    // Create new cache
    const model = "models/gemini-2.5-flash";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caches = (this.genAI as any).caches;
    if (!caches) throw new Error("Caching API not available");

    const cache = await caches.create({
      model,
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      // Seed the cache with an empty turn so it's valid
      contents: [
        { role: "user",  parts: [{ text: "Ready." }] },
        { role: "model", parts: [{ text: "Ready." }] },
      ],
      ttl: `${CACHE_TTL_SEC}s`,
    });

    const expiresAt = new Date(now.getTime() + CACHE_REFRESH_AT_SEC * 1000);
    cacheRegistry.set(cacheKey, {
      cacheName: cache.name,
      expiresAt,
      systemPrompt,
    });

    return { cacheName: cache.name, cacheKey };
  }

  private async *streamWithCache(
    { cacheName }: { cacheName: string; cacheKey: string },
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (this.genAI as any).getGenerativeModelFromCachedContent({
      name: cacheName,
    });

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const lastUser = messages.at(-1);
    const userText = lastUser
      ? (recentContext ? `[Recent training data]\n${recentContext}\n\n---\n\n${lastUser.content}` : lastUser.content)
      : "";

    const result = await chat.sendMessageStream(userText);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield { text, done: false };
    }

    const response = await result.response;
    const usage = response.usageMetadata;
    // Estimate cost: cache reads are 75% cheaper than standard input
    const inputTokens  = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const cachedTokens = usage?.cachedContentTokenCount ?? 0;
    yield {
      text: "",
      done: true,
      inputTokens,
      outputTokens,
      cacheReadTokens: cachedTokens,
    };
  }

  // ── Standard path (free tier or fallback) ────────────────────────────────
  private async *streamStandard(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk> {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const lastUser = messages.at(-1);
    const userText = lastUser
      ? (recentContext ? `[Recent training data]\n${recentContext}\n\n---\n\n${lastUser.content}` : lastUser.content)
      : "";

    const result = await chat.sendMessageStream(userText);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield { text, done: false };
    }

    const response = await result.response;
    const usage = response.usageMetadata;
    yield {
      text: "",
      done: true,
      inputTokens:  usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }
}

// Expose cache stats for debugging
export function getGeminiCacheStats(): { entries: number; keys: string[] } {
  return { entries: cacheRegistry.size, keys: [...cacheRegistry.keys()] };
}
