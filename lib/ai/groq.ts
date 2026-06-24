import OpenAI from "openai";
import type { AIClient, AIMessage, StreamChunk } from "./client";

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended — 1K req/day)" },
  { id: "openai/gpt-oss-120b",     label: "GPT-OSS 120B" },
  { id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B (fastest, 14.4K req/day)" },
] as const;

export const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

// Groq retires model ids without redirecting too (llama3-groq-70b-8192-tool-use-preview
// and mixtral-8x7b-32768 both 404 as of 2026-06) — same self-healing fallback as
// resolveNvidiaModel() in lib/ai/nvidia.ts.
export function resolveGroqModel(stored?: string | null): string {
  return GROQ_MODELS.some(m => m.id === stored) ? (stored as string) : GROQ_DEFAULT_MODEL;
}

export class GroqClient implements AIClient {
  readonly provider = "groq" as const;
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = GROQ_DEFAULT_MODEL) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model = model;
  }

  async *stream(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk> {
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.slice(0, -1).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const lastUser = messages.at(-1);
    if (lastUser) {
      openaiMessages.push({
        role: "user",
        content: recentContext
          ? `[Recent training data — last 4 weeks]\n${recentContext}\n\n---\n\n${lastUser.content}`
          : lastUser.content,
      });
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      messages: openaiMessages,
      stream: true,
      // Groq requires stream_options to get usage data
      stream_options: { include_usage: true },
    });

    let inputTokens = 0, outputTokens = 0;

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) yield { text, done: false };

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    yield { text: "", done: true, inputTokens, outputTokens };
  }
}
