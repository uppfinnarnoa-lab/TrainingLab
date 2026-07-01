// lib/ai/agent-loop.ts
import OpenAI from "openai";
import { WRITE_TOOLS, executeCoachTool, toOpenAITools } from "./tools";
import { parseLeakedKimiToolCalls, stripLeakedKimiTokens, hasLeakedKimiTokens } from "./kimi-fallback";

const MAX_ITERATIONS = 6;
const RETRY_DELAYS_MS = [1000, 3000, 8000];

export interface AgentLoopResult {
  done: boolean;
  hasPending: boolean;
  pendingEvent?: { name: string; message: string; success: true; pending: true; pendingInput: Record<string, unknown>; pendingTool: string };
  finalText: string;
  toolContext: string;
  toolsUsed: boolean;
}

interface RunOpts {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  userId: string;
  convId: string;
  describeAction: (toolName: string, input: Record<string, unknown>) => string;
  send: (obj: Record<string, unknown>) => void;
  useToolRole: boolean;
}

async function createWithRetry(client: OpenAI, params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429 || attempt === RETRY_DELAYS_MS.length) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runOpenAICompatibleAgentLoop(opts: RunOpts): Promise<AgentLoopResult> {
  const { client, model, systemPrompt, userId, convId, describeAction, send, useToolRole } = opts;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.messages,
  ];
  let toolsUsed = false;
  let toolContext = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await createWithRetry(client, {
      model, max_tokens: 1024, tools: toOpenAITools(), tool_choice: "auto", messages,
    });
    const choice = response.choices[0];
    const msg = choice.message;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let calls = (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id as string, name: c.function.name as string, argsRaw: c.function.arguments as string,
    }));

    if (calls.length === 0 && msg.content && hasLeakedKimiTokens(msg.content)) {
      const leaked = parseLeakedKimiToolCalls(msg.content);
      calls = leaked.map((c, i) => ({ id: `leaked_${iter}_${i}`, name: c.name, argsRaw: JSON.stringify(c.args) }));
    }

    if (calls.length === 0) {
      const finalText = msg.content ? stripLeakedKimiTokens(msg.content) : "";
      return { done: true, hasPending: false, finalText, toolContext, toolsUsed };
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    const parsed = calls.map(c => ({ ...c, args: parseToolArgs(c.argsRaw) }));
    const writeCall = parsed.find(c => WRITE_TOOLS.has(c.name) && c.args);
    if (writeCall && writeCall.args) {
      return {
        done: false, hasPending: true, finalText: "", toolContext, toolsUsed,
        pendingEvent: {
          name: writeCall.name, message: describeAction(writeCall.name, writeCall.args),
          success: true, pending: true, pendingInput: writeCall.args, pendingTool: writeCall.name,
        },
      };
    }

    for (const c of parsed) send({ status: "tool", tool: c.name });
    const results = await Promise.all(parsed.map(c =>
      c.args
        ? executeCoachTool(c.name, c.args, userId, convId)
        : Promise.resolve({ success: false, message: "Invalid tool arguments.", data: "error: malformed JSON arguments" })
    ));
    for (let i = 0; i < parsed.length; i++) {
      send({ toolCall: { name: parsed[i].name, message: results[i].message, success: results[i].success } });
    }
    toolsUsed = true;
    toolContext += parsed.map((c, i) => `[Tool: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n") + "\n\n";
    send({ status: "thinking" });

    if (useToolRole) {
      for (let i = 0; i < parsed.length; i++) {
        messages.push({ role: "tool", tool_call_id: parsed[i].id, content: String(results[i].data ?? results[i].message) });
      }
    } else {
      const combined = parsed.map((c, i) => `[Tool result: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n");
      messages.push({ role: "user", content: combined });
    }
  }

  return { done: false, hasPending: false, finalText: "", toolContext, toolsUsed };
}
