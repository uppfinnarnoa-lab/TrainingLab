// AI provider abstraction — Claude and Gemini both implement this interface.

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface AIClient {
  provider: "claude" | "gemini" | "nvidia" | "groq";
  stream(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk>;
}

// Pricing (USD per 1M tokens) — Gemini 2.0 Flash paid tier
export const PRICING = {
  claude: {
    input:       3.00,
    output:      15.00,
    cacheWrite:  3.75,
    cacheRead:   0.30,   // 90% cheaper than input
  },
  gemini: {
    input:       0.075,  // standard input
    output:      0.30,
    cacheWrite:  0.075,  // same as input to create cache
    cacheRead:   0.01875, // 75% cheaper than input
    storagePerHour: 1.00, // per 1M cached tokens per hour
  },
};

export function estimateCost(
  provider: "claude" | "gemini" | "nvidia" | "groq",
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  if (provider === "claude") {
    const p = PRICING.claude;
    const uncachedInput = Math.max(0, inputTokens - cacheReadTokens);
    return (uncachedInput / 1_000_000) * p.input
         + (cacheReadTokens / 1_000_000) * p.cacheRead
         + (outputTokens / 1_000_000) * p.output;
  }

  if (provider === "gemini") {
    const p = PRICING.gemini;
    const uncachedInput = Math.max(0, inputTokens - cacheReadTokens);
    return (uncachedInput / 1_000_000) * p.input
         + (cacheReadTokens / 1_000_000) * p.cacheRead
         + (outputTokens / 1_000_000) * p.output;
    // Note: cache storage cost (~$0.00007/hour per conversation) omitted —
    // negligible and complex to track accurately.
  }

  return 0;
}
