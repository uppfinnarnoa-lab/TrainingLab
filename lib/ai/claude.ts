import Anthropic from "@anthropic-ai/sdk";
import type { AIClient, AIMessage, StreamChunk } from "./client";

export class ClaudeClient implements AIClient {
  readonly provider = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *stream(
    systemPrompt: string,
    messages: AIMessage[],
    recentContext: string,
  ): AsyncIterable<StreamChunk> {
    // Inject recent context as a prefixed user message before the last user message
    const augmented: Anthropic.MessageParam[] = messages.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const lastUser = messages.at(-1);
    if (lastUser) {
      augmented.push({
        role: "user",
        content: recentContext
          ? `[Recent training data — last 4 weeks]\n${recentContext}\n\n---\n\n${lastUser.content}`
          : lastUser.content,
      });
    }

    const stream = await this.client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } } as any],
      messages: augmented,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { text: event.delta.text, done: false };
      }
    }

    const final = await stream.finalMessage();
    yield {
      text: "",
      done: true,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      cacheReadTokens: (final.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
    };
  }
}
