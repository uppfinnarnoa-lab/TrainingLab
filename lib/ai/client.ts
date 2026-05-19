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
  provider: "claude" | "gemini";
  stream(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk>;
}

// Pricing (USD per 1M tokens)
export const PRICING = {
  claude: {
    input:       3.00,
    output:      15.00,
    cacheWrite:  3.75,
    cacheRead:   0.30,
  },
  gemini_flash: {
    input:  0.00,
    output: 0.00,
  },
};

export function estimateCost(
  provider: "claude" | "gemini",
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  if (provider === "gemini") return 0;
  const p = PRICING.claude;
  const inputCost  = ((inputTokens - cacheReadTokens) / 1_000_000) * p.input;
  const cacheCost  = (cacheReadTokens / 1_000_000) * p.cacheRead;
  const outputCost = (outputTokens / 1_000_000) * p.output;
  return inputCost + cacheCost + outputCost;
}
