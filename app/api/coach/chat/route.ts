import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { GeminiClient } from "@/lib/ai/gemini";
import { NvidiaClient, resolveNvidiaModel } from "@/lib/ai/nvidia";
import { GroqClient, resolveGroqModel } from "@/lib/ai/groq";
import { buildCoachContext } from "@/lib/ai/context-builder";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { estimateCost } from "@/lib/ai/client";
import { getFallbackClient, isRateLimitError, modelDisplayName, FALLBACK_MODEL } from "@/lib/ai/fallback";
import { safeDecrypt } from "@/lib/encrypt";
import { COACH_TOOLS, toGeminiTools, toOpenAITools, executeCoachTool, WRITE_TOOLS } from "@/lib/ai/tools";
import type { AIClient, AIMessage } from "@/lib/ai/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  conversationId: z.string().cuid().optional(),
  message:        z.string().min(1).max(4000),
  language:       z.enum(["en", "sv"]).optional(),
  approvedEditId: z.string().cuid().optional(), // editId of a pending CoachEdit to approve
  approvedInput:  z.record(z.unknown()).optional(), // tool input for the approved write
  approvedTool:   z.string().optional(),           // tool name for the approved write
});

type ToolEvent = {
  name: string;
  message: string;
  success: boolean;
  pending?: boolean;
  pendingInput?: Record<string, unknown>;
  pendingTool?: string;
  editId?: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const rl = checkRateLimit(`chat:${userId}`, 10, 60);
  if (!rl.allowed) return new Response(
    JSON.stringify({ error: "rate_limited", retryAfter: rl.resetIn }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const { conversationId, message, language: langOverride, approvedEditId, approvedInput, approvedTool } = parsed.data;

  // ── Load AI settings ────────────────────────────────────────────────
  const [aiSettings, user] = await Promise.all([
    prisma.aISettings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const provider   = aiSettings?.provider ?? "gemini";
  const language   = langOverride ?? aiSettings?.coachLanguage ?? "sv";

  const apiKey = provider === "claude"
    ? (safeDecrypt(aiSettings?.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY ?? "")
    : provider === "nvidia"
    ? (safeDecrypt(aiSettings?.nvidiaApiKey) ?? "")
    : provider === "groq"
    ? (safeDecrypt(aiSettings?.groqApiKey) ?? "")
    : (safeDecrypt(aiSettings?.geminiApiKey) ?? process.env.GOOGLE_AI_API_KEY ?? "");

  if (!apiKey) return new Response(
    JSON.stringify({ error: "no_api_key", provider }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );

  // Cross-provider rate-limit fallback target — independent of the active
  // provider's key, so e.g. a Claude or Groq rate limit can still seamlessly
  // fall back to NVIDIA NIM if the user also has an NVIDIA key on file.
  const nvidiaKeyForFallback = provider === "nvidia" ? apiKey : (safeDecrypt(aiSettings?.nvidiaApiKey) ?? null);

  // ── Monthly reset + budget check ────────────────────────────────────
  if (aiSettings) {
    const now = new Date();
    if (aiSettings.spendResetAt && (now.getTime() - aiSettings.spendResetAt.getTime()) > 30 * 24 * 3600_000) {
      await prisma.aISettings.update({ where: { userId }, data: { currentMonthSpendUsd: 0, geminiCurrentMonthSpendUsd: 0, spendResetAt: now } });
      aiSettings.currentMonthSpendUsd = 0;
      aiSettings.geminiCurrentMonthSpendUsd = 0;
    }
    const budget  = provider === "gemini" ? aiSettings.geminiMonthlyBudgetUsd  : (provider === "nvidia" || provider === "groq") ? 0 : aiSettings.monthlyBudgetUsd;
    const current = provider === "gemini" ? aiSettings.geminiCurrentMonthSpendUsd : (provider === "nvidia" || provider === "groq") ? 0 : aiSettings.currentMonthSpendUsd;
    if (budget > 0 && current >= budget) return new Response(
      JSON.stringify({ error: "budget_exceeded", provider, budget, current }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Load or create conversation ─────────────────────────────────────
  let convId = conversationId;
  if (!convId) {
    const datePrefix = new Date().toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
    const conv = await prisma.conversation.create({ data: { userId, title: `${datePrefix} — ${message.slice(0, 50)}` } });
    convId = conv.id;
  } else {
    const conv = await prisma.conversation.findUnique({ where: { id: convId }, select: { userId: true } });
    if (!conv || conv.userId !== userId) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }

  // ── Load history ─────────────────────────────────────────────────────
  const historyRows = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const textMessages: AIMessage[] = historyRows.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // ── Build context ────────────────────────────────────────────────────
  const coachCtx = await buildCoachContext(userId);
  coachCtx.name  = user?.name ?? null;
  const systemPrompt = buildSystemPrompt(coachCtx, language as "en" | "sv");

  // ── Save user message ────────────────────────────────────────────────
  await prisma.message.create({ data: { conversationId: convId, role: "user", content: message } });

  // ── Everything below this point can be slow (LLM round trips, tool calls
  //    against external APIs) — it all runs inside the stream so the client
  //    gets the connection + live status/tool events immediately instead of
  //    waiting in silence for the whole thing to resolve. ───────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        send({ convId });

        // ── Execute pre-approved write tool ─────────────────────────────
        if (approvedTool && approvedInput) {
          send({ status: "tool", tool: approvedTool });
          const result = await executeCoachTool(approvedTool, approvedInput, userId, convId!);
          const ev: ToolEvent = { name: approvedTool, message: result.message, success: result.success, editId: result.editId };
          send({ toolCall: ev });
          textMessages.push({ role: "assistant", content: `[Tool executed: ${approvedTool}] ${result.message}` });
          void approvedEditId; // already used by the UI to mark approved — no DB action needed here
        }

        send({ status: "thinking" });

        let fullResponse = "";
        let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0;
        let hasPending = false;
        let toolsUsed = !!(approvedTool && approvedInput);

        // ── Agentic loop (Claude only — full multi-step with parallel tool calls) ──
        if (provider === "claude") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type Block = Record<string, any>;
          type AnthropicMsg = { role: "user" | "assistant"; content: string | Block[] };

          const anthropicMsgs: AnthropicMsg[] = [
            ...textMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user", content: message },
          ];

          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const anthropic  = new Anthropic({ apiKey });

          for (let iter = 0; iter < 6; iter++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let response: any;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              response = await (anthropic.messages.create as any)({
                model: "claude-sonnet-4-6",
                max_tokens: 2048,
                tools: COACH_TOOLS,
                tool_choice: { type: "auto" },
                system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
                messages: anthropicMsgs,
              });
            } catch (err) {
              console.error("[coach/chat] claude tool-check failed:", err instanceof Error ? err.message : err);
              break; // tool check failed — fall through to stream without fresh data
            }

            if (response.stop_reason !== "tool_use") break;

            // Append full assistant message (required by Anthropic — must include tool_use blocks)
            anthropicMsgs.push({ role: "assistant", content: response.content as Block[] });

            const toolUseBlocks = (response.content as Block[]).filter((b: Block) => b.type === "tool_use") as Block[];

            // If any write tool is requested, pause and ask for approval
            const writeBlock = toolUseBlocks.find(b => WRITE_TOOLS.has(b.name as string));
            if (writeBlock) {
              const ev: ToolEvent = { name: writeBlock.name as string, message: describeAction(writeBlock.name as string, writeBlock.input as Record<string, unknown>), success: true, pending: true, pendingInput: writeBlock.input as Record<string, unknown>, pendingTool: writeBlock.name as string };
              send({ toolCall: ev });
              hasPending = true;
              break;
            }

            // Execute read tools — emit a "tool" status as each one starts, and its result as it finishes
            for (const b of toolUseBlocks) send({ status: "tool", tool: b.name });
            const results = await Promise.all(
              toolUseBlocks.map(b => executeCoachTool(b.name as string, b.input as Record<string, unknown>, userId, convId!))
            );
            for (let i = 0; i < toolUseBlocks.length; i++) {
              send({ toolCall: { name: toolUseBlocks[i].name as string, message: results[i].message, success: results[i].success } });
            }
            toolsUsed = true;
            send({ status: "thinking" });

            // Append tool results as user message
            anthropicMsgs.push({
              role: "user",
              content: toolUseBlocks.map((b, i) => ({
                type: "tool_result",
                tool_use_id: b.id as string,
                content: String(results[i].data ?? results[i].message),
              })) as Block[],
            });
          }

          if (hasPending) {
            send({ done: true, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
            controller.close();
            return;
          }

          // Re-add the user's original message and request a final response
          anthropicMsgs.push({ role: "user", content: toolsUsed
            ? "Using the tool data above, answer my original question fully."
            : message
          });

          const claudeFinalClient: AIClient = {
            provider: "claude",
            async *stream() {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const finalStream = (anthropic.messages.stream as any)({
                model: "claude-sonnet-4-6",
                max_tokens: 4096,
                system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
                messages: toolsUsed ? anthropicMsgs : [
                  ...textMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
                  { role: "user", content: message },
                ],
              });
              let in_ = 0, out_ = 0, cache_ = 0;
              for await (const event of finalStream as AsyncIterable<Block>) {
                if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                  yield { text: event.delta.text as string, done: false };
                }
                if (event.type === "message_delta" && event.usage) {
                  out_ = (event.usage.output_tokens as number) ?? 0;
                }
                if (event.type === "message_start") {
                  const usage = event.message?.usage as Block | undefined;
                  in_    = (usage?.input_tokens as number) ?? 0;
                  cache_ = (usage?.cache_read_input_tokens as number) ?? 0;
                }
              }
              yield { text: "", done: true, inputTokens: in_, outputTokens: out_, cacheReadTokens: cache_ };
            },
          };

          const fallbackClient = getFallbackClient(nvidiaKeyForFallback, "claude");
          const result = await streamWithFallback({
            client: claudeFinalClient, clientModel: "claude-sonnet-4-6", primaryLabel: modelDisplayName("claude"),
            fallbackClient, fallbackModel: FALLBACK_MODEL, fallbackLabel: modelDisplayName("nvidia", FALLBACK_MODEL),
            systemPrompt, messages: [...textMessages, { role: "user", content: message }],
            send, language: language as "en" | "sv",
          });
          fullResponse = result.fullResponse;
          inputTokens = result.inputTokens; outputTokens = result.outputTokens; cacheReadTokens = result.cacheReadTokens;

          await saveAssistantMessage(convId!, fullResponse, userId, result.provider, result.model, inputTokens, outputTokens, cacheReadTokens);
          const cost = estimateCost(result.provider as "claude" | "gemini", inputTokens, outputTokens, cacheReadTokens);
          await updateSpend(userId, result.provider, cost);

          send({ done: true, cost, inputTokens, outputTokens, cacheReadTokens });
          controller.close();
          return;
        }

        // ── Non-Claude providers (single tool call + stream) ─────────────────
        const messages: AIMessage[] = [
          ...textMessages,
          { role: "user", content: message },
        ];

        if (provider === "nvidia" || provider === "groq") {
          try {
            const OpenAI  = (await import("openai")).default;
            const baseURL = provider === "nvidia" ? "https://integrate.api.nvidia.com/v1" : "https://api.groq.com/openai/v1";
            const model   = provider === "nvidia" ? resolveNvidiaModel(aiSettings?.nvidiaModel) : resolveGroqModel(aiSettings?.groqModel);
            const oai     = new OpenAI({ apiKey, baseURL });
            const tc      = await oai.chat.completions.create({
              model, max_tokens: 400, tools: toOpenAITools(), tool_choice: "auto",
              messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role as "user"|"assistant", content: m.content }))],
            });
            const choice = tc.choices[0];
            if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.[0]) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const call = choice.message.tool_calls[0] as any;
              const toolName  = call.function.name as string;
              const toolInput = JSON.parse(call.function.arguments as string) as Record<string, unknown>;
              if (WRITE_TOOLS.has(toolName)) {
                send({ toolCall: { name: toolName, message: describeAction(toolName, toolInput), success: true, pending: true, pendingInput: toolInput, pendingTool: toolName } });
                hasPending = true;
              } else {
                send({ status: "tool", tool: toolName });
                const result = await executeCoachTool(toolName, toolInput, userId, convId!);
                if (result.success) send({ toolCall: { name: toolName, message: result.message, success: true } });
                messages.push({ role: "assistant", content: `[Tool: ${toolName}]\n${String(result.data ?? result.message)}` });
                messages.push({ role: "user", content: "Answer my question using the tool data above." });
                send({ status: "thinking" });
              }
            }
          } catch (err) { console.error("[coach/chat] tool check failed:", err instanceof Error ? err.message : err); }
        } else {
          // Gemini function calling
          try {
            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
              model: "gemini-2.5-flash",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: [{ functionDeclarations: toGeminiTools() }] as any,
              systemInstruction: systemPrompt,
            });
            const gHistory = messages.slice(0, -1).map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
            const chat = model.startChat({ history: gHistory });
            const res  = await chat.sendMessage(messages.at(-1)!.content);
            const fc   = res.response.candidates?.[0]?.content.parts.find(p => "functionCall" in p);
            if (fc && "functionCall" in fc && fc.functionCall) {
              const { name, args } = fc.functionCall;
              const toolInput = args as Record<string, unknown>;
              if (WRITE_TOOLS.has(name)) {
                send({ toolCall: { name, message: describeAction(name, toolInput), success: true, pending: true, pendingInput: toolInput, pendingTool: name } });
                hasPending = true;
              } else {
                send({ status: "tool", tool: name });
                const result = await executeCoachTool(name, toolInput, userId, convId!);
                if (result.success) send({ toolCall: { name, message: result.message, success: true } });
                messages.push({ role: "assistant", content: `[Tool: ${name}]\n${String(result.data ?? result.message)}` });
                messages.push({ role: "user", content: "Answer my question using the tool data above." });
                send({ status: "thinking" });
              }
            }
          } catch (err) { console.error("[coach/chat] tool check failed:", err instanceof Error ? err.message : err); }
        }

        if (hasPending) {
          send({ done: true, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
          controller.close();
          return;
        }

        // ── Stream response for non-Claude providers ─────────────────────────
        const currentModel = provider === "nvidia" ? resolveNvidiaModel(aiSettings?.nvidiaModel)
          : provider === "groq" ? resolveGroqModel(aiSettings?.groqModel)
          : undefined;
        const aiClient = provider === "nvidia"
          ? new NvidiaClient(apiKey, currentModel)
          : provider === "groq"
          ? new GroqClient(apiKey, currentModel)
          : new GeminiClient(apiKey);

        const fallbackClient = getFallbackClient(nvidiaKeyForFallback, provider, currentModel);
        const result = await streamWithFallback({
          client: aiClient, clientModel: currentModel ?? "gemini-2.5-flash", primaryLabel: modelDisplayName(provider, currentModel),
          fallbackClient, fallbackModel: FALLBACK_MODEL, fallbackLabel: modelDisplayName("nvidia", FALLBACK_MODEL),
          systemPrompt, messages, send, language: language as "en" | "sv",
        });
        fullResponse = result.fullResponse;
        inputTokens = result.inputTokens; outputTokens = result.outputTokens; cacheReadTokens = result.cacheReadTokens;

        await saveAssistantMessage(convId!, fullResponse, userId, result.provider, result.model, inputTokens, outputTokens, cacheReadTokens);
        const cost = estimateCost(result.provider as "claude" | "gemini", inputTokens, outputTokens, cacheReadTokens);
        await updateSpend(userId, result.provider, cost);

        send({ done: true, cost, inputTokens, outputTokens, cacheReadTokens });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[coach/chat] stream error:", msg);
        send({ error: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Streams `client`; if it fails with a rate-limit error before any text has
// been sent, transparently retries with `fallbackClient` (if one is
// available) and emits a `notice` event so the chat UI can show the user
// what happened. A partial stream (some text already sent) is never retried
// — there's no clean way to "unsend" text already on the wire.
async function streamWithFallback(opts: {
  client: AIClient; clientModel: string; primaryLabel: string;
  fallbackClient: AIClient | null; fallbackModel: string; fallbackLabel: string;
  systemPrompt: string; messages: AIMessage[];
  send: (obj: Record<string, unknown>) => void;
  language: "en" | "sv";
}): Promise<{ fullResponse: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; provider: string; model: string }> {
  const { client, clientModel, primaryLabel, fallbackClient, fallbackModel, fallbackLabel, systemPrompt, messages, send, language } = opts;
  let fullResponse = "", inputTokens = 0, outputTokens = 0, cacheReadTokens = 0;
  let provider = client.provider as string, model = clientModel;
  try {
    for await (const chunk of client.stream(systemPrompt, messages, "")) {
      if (chunk.done) { inputTokens = chunk.inputTokens ?? 0; outputTokens = chunk.outputTokens ?? 0; cacheReadTokens = chunk.cacheReadTokens ?? 0; }
      else { fullResponse += chunk.text; send({ text: chunk.text }); }
    }
  } catch (err) {
    if (fullResponse || !fallbackClient || !isRateLimitError(err)) throw err;
    console.warn(`[coach/chat] ${primaryLabel} rate-limited — falling back to ${fallbackLabel}`);
    send({ notice: language === "sv"
      ? `Nådde en begränsning hos ${primaryLabel} — svarade istället med ${fallbackLabel} (gratis, NVIDIA NIM) för det här meddelandet.`
      : `Hit a rate limit on ${primaryLabel} — answered with ${fallbackLabel} (free, NVIDIA NIM) instead for this message.` });
    provider = fallbackClient.provider; model = fallbackModel;
    for await (const chunk of fallbackClient.stream(systemPrompt, messages, "")) {
      if (chunk.done) { inputTokens = chunk.inputTokens ?? 0; outputTokens = chunk.outputTokens ?? 0; cacheReadTokens = chunk.cacheReadTokens ?? 0; }
      else { fullResponse += chunk.text; send({ text: chunk.text }); }
    }
  }
  return { fullResponse, inputTokens, outputTokens, cacheReadTokens, provider, model };
}

async function saveAssistantMessage(convId: string, content: string, userId: string, provider: string, modelUsed: string, inputTokens?: number, outputTokens?: number, cacheReadTokens?: number) {
  const cost = estimateCost(provider as "claude" | "gemini", inputTokens ?? 0, outputTokens ?? 0, cacheReadTokens ?? 0);
  await prisma.message.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content,
      tokensUsed: (inputTokens ?? 0) + (outputTokens ?? 0),
      estimatedCostUsd: cost,
      modelUsed,
    },
  });
  void userId;
}

async function updateSpend(userId: string, provider: string, cost: number) {
  if (cost <= 0 || provider === "nvidia" || provider === "groq") return;
  const field = provider === "gemini" ? "geminiCurrentMonthSpendUsd" : "currentMonthSpendUsd";
  await prisma.aISettings.upsert({
    where: { userId },
    create: { userId, [field]: cost },
    update: { [field]: { increment: cost } },
  });
}

function describeAction(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "create_workout":
      return `Add "${input.name}" (${input.sportType}) on ${input.date}${input.targetDistanceKm ? ` · ${input.targetDistanceKm}km` : ""}${input.targetDurationMin ? ` · ${input.targetDurationMin}min` : ""}`;
    case "update_workout":
      return `Update workout ${input.workoutId}${input.name ? ` → "${input.name}"` : ""}${input.date ? ` to ${input.date}` : ""}`;
    case "delete_workout":
      return `Delete workout ${input.workoutId}`;
    case "create_training_block":
      return `Create ${input.blockType} block "${input.name}" (${input.startDate} → ${input.endDate})`;
    case "update_training_block":
      return `Update training block ${input.blockId}`;
    case "log_race_result":
      return `Log ${input.distance} race: ${Math.floor((input.timeSeconds as number)/60)}:${String((input.timeSeconds as number)%60).padStart(2,"0")} on ${input.date}`;
    case "delete_race_result":
      return `Delete race result ${input.raceId}`;
    case "update_activity_notes":
      return `Update notes for activity ${input.activity_id}`;
    case "update_profile":
      return `Update profile: ${Object.entries(input).map(([k,v]) => `${k}=${v}`).join(", ")}`;
    default:
      return `Execute ${toolName}`;
  }
}
