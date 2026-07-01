// lib/ai/gemini-loop.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { WRITE_TOOLS, executeCoachTool, toGeminiTools } from "./tools";
import type { AgentLoopResult } from "./agent-loop";

const MAX_ITERATIONS = 6;

interface GeminiHistoryItem { role: "user" | "model"; parts: { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: { result: string } } }[] }

interface RunOpts {
  apiKey: string;
  systemPrompt: string;
  history: GeminiHistoryItem[];
  latestUserText: string;
  userId: string;
  convId: string;
  describeAction: (toolName: string, input: Record<string, unknown>) => string;
  send: (obj: Record<string, unknown>) => void;
}

export async function runGeminiAgentLoop(opts: RunOpts): Promise<AgentLoopResult> {
  const { apiKey, systemPrompt, userId, convId, describeAction, send } = opts;
  const genAI = new GoogleGenerativeAI(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ functionDeclarations: toGeminiTools() }] as any,
    systemInstruction: systemPrompt,
  });

  const history = [...opts.history];
  let toolsUsed = false;
  let toolContext = "";
  let pendingText = opts.latestUserText;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = model.startChat({ history: history as any });
    const res = await chat.sendMessage(pendingText);
    const parts = res.response.candidates?.[0]?.content.parts ?? [];
    const calls = parts.filter(p => "functionCall" in p && p.functionCall).map(p => p.functionCall!);

    if (calls.length === 0) {
      return { done: true, hasPending: false, finalText: res.response.text(), toolContext, toolsUsed };
    }

    history.push({ role: "user", parts: [{ text: pendingText }] });
    history.push({ role: "model", parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args as Record<string, unknown> } })) });

    const writeCall = calls.find(c => WRITE_TOOLS.has(c.name));
    if (writeCall) {
      return {
        done: false, hasPending: true, finalText: "", toolContext, toolsUsed,
        pendingEvent: {
          name: writeCall.name, message: describeAction(writeCall.name, writeCall.args as Record<string, unknown>),
          success: true, pending: true, pendingInput: writeCall.args as Record<string, unknown>, pendingTool: writeCall.name,
        },
      };
    }

    for (const c of calls) send({ status: "tool", tool: c.name });
    const results = await Promise.all(calls.map(c => executeCoachTool(c.name, c.args as Record<string, unknown>, userId, convId)));
    for (let i = 0; i < calls.length; i++) send({ toolCall: { name: calls[i].name, message: results[i].message, success: results[i].success } });
    toolsUsed = true;
    toolContext += calls.map((c, i) => `[Tool: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n") + "\n\n";
    send({ status: "thinking" });

    history.push({
      role: "user",
      parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: { result: String(results[i].data ?? results[i].message) } } })),
    });
    pendingText = "";
  }

  return { done: false, hasPending: false, finalText: "", toolContext, toolsUsed };
}
