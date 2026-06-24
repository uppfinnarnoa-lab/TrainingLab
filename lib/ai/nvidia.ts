import OpenAI from "openai";
import type { AIClient, AIMessage, StreamChunk } from "./client";

export const NVIDIA_MODELS = [
  { id: "moonshotai/kimi-k2.6",                      label: "Kimi K2.6 (recommended — 1T multimodal, 256K context)" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct-hq", label: "Nemotron 70B" },
  { id: "meta/llama-3.3-70b-instruct",               label: "Llama 3.3 70B" },
  { id: "meta/llama-3.1-405b-instruct",              label: "Llama 3.1 405B (slow)" },
  { id: "mistralai/mistral-large-latest",            label: "Mistral Large" },
] as const;

export const NVIDIA_DEFAULT_MODEL = "moonshotai/kimi-k2.6";

// NVIDIA periodically retires model IDs outright (e.g. kimi-k2.5 → 404 as of
// 2026-06, replaced by kimi-k2.6) — fall back to the current default instead
// of calling a dead endpoint with a stale value a user already saved.
export function resolveNvidiaModel(stored?: string | null): string {
  return NVIDIA_MODELS.some(m => m.id === stored) ? (stored as string) : NVIDIA_DEFAULT_MODEL;
}

export class NvidiaClient implements AIClient {
  readonly provider = "nvidia" as const;
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = NVIDIA_DEFAULT_MODEL) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://integrate.api.nvidia.com/v1",
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
