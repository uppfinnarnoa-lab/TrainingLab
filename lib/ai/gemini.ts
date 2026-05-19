import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIClient, AIMessage, StreamChunk } from "./client";

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
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: systemPrompt,
    });

    // Build history for Gemini (all but last message)
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    const lastUser = messages.at(-1);
    const userText = lastUser
      ? (recentContext
        ? `[Recent training data — last 4 weeks]\n${recentContext}\n\n---\n\n${lastUser.content}`
        : lastUser.content)
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
