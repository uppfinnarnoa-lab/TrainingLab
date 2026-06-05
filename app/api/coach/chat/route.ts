import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ClaudeClient } from "@/lib/ai/claude";
import { GeminiClient } from "@/lib/ai/gemini";
import { NvidiaClient, NVIDIA_DEFAULT_MODEL } from "@/lib/ai/nvidia";
import { GroqClient, GROQ_DEFAULT_MODEL } from "@/lib/ai/groq";
import { buildCoachContext, buildRecentActivitiesSummary } from "@/lib/ai/context-builder";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { estimateCost } from "@/lib/ai/client";
import { safeDecrypt } from "@/lib/encrypt";
import { COACH_TOOLS, toGeminiTools, toOpenAITools, executeCoachTool, WRITE_TOOLS } from "@/lib/ai/tools";
import type { AIMessage } from "@/lib/ai/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const TOOL_NAMES = [
  "create_workout", "get_upcoming_plan", "delete_workout", "update_profile",
  "search_activities", "get_activities_in_range", "analyze_full_history",
  "get_fitness_summary", "get_race_history", "get_readiness",
  "get_training_blocks", "get_activity_detail",
] as const;

const schema = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().min(1).max(4000),
  language: z.enum(["en", "sv"]).optional(),
  approvedAction: z.object({
    toolName: z.enum(TOOL_NAMES),
    toolInput: z.record(z.unknown()),
  }).optional(),
});

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

  const { conversationId, message, language, approvedAction } = parsed.data;

  // ── Load AI settings ────────────────────────────────────────────────
  const [aiSettings, user] = await Promise.all([
    prisma.aISettings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const provider = aiSettings?.provider ?? "gemini";
  const apiKey = provider === "claude"
    ? (safeDecrypt(aiSettings?.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY ?? "")
    : provider === "nvidia"
    ? (safeDecrypt(aiSettings?.nvidiaApiKey) ?? "")
    : provider === "groq"
    ? (safeDecrypt(aiSettings?.groqApiKey) ?? "")
    : (safeDecrypt(aiSettings?.geminiApiKey) ?? process.env.GOOGLE_AI_API_KEY ?? "");

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "no_api_key", provider }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Monthly reset + budget check ───────────────────────────────────────
  if (aiSettings) {
    const now = new Date();
    if (aiSettings.spendResetAt && (now.getTime() - aiSettings.spendResetAt.getTime()) > 30 * 24 * 3600_000) {
      await prisma.aISettings.update({
        where: { userId },
        data: { currentMonthSpendUsd: 0, geminiCurrentMonthSpendUsd: 0, spendResetAt: now },
      });
      aiSettings.currentMonthSpendUsd = 0;
      aiSettings.geminiCurrentMonthSpendUsd = 0;
    }
    const budget  = provider === "gemini" ? aiSettings.geminiMonthlyBudgetUsd  : (provider === "nvidia" || provider === "groq") ? 0 : aiSettings.monthlyBudgetUsd;
    const current = provider === "gemini" ? aiSettings.geminiCurrentMonthSpendUsd : (provider === "nvidia" || provider === "groq") ? 0 : aiSettings.currentMonthSpendUsd;
    if (budget > 0 && current >= budget) {
      return new Response(
        JSON.stringify({ error: "budget_exceeded", provider, budget, current }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // ── Load or create conversation ─────────────────────────────────────
  let convId = conversationId;
  if (!convId) {
    const datePrefix = new Date().toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
    const conv = await prisma.conversation.create({
      data: { userId, title: `${datePrefix} — ${message.slice(0, 50)}` },
    });
    convId = conv.id;
  } else {
    // Verify the conversation belongs to this user before appending
    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      select: { userId: true },
    });
    if (!conv || conv.userId !== userId) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }
  }

  // ── Load history ────────────────────────────────────────────────────
  const history = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    take: 20, // last 20 messages for context window
  });

  const messages: AIMessage[] = [
    ...history.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: message },
  ];

  // ── Build context ────────────────────────────────────────────────────
  // Gemini free tier has strict token limits — use smaller context window
  const recentDays = provider === "gemini" ? 14 : 28;
  const [coachCtx, recentActivities] = await Promise.all([
    buildCoachContext(userId),
    buildRecentActivitiesSummary(userId, recentDays),
  ]);
  coachCtx.name = user?.name ?? null;
  const systemPrompt = buildSystemPrompt(coachCtx, language ?? "en");

  // ── Save user message ────────────────────────────────────────────────
  await prisma.message.create({
    data: { conversationId: convId, role: "user", content: message },
  });

  // ── Phase 1: Execute pre-approved write action (if user said "yes") ───
  let toolEvent: { name: string; message: string; success: boolean; pending?: boolean; pendingInput?: Record<string, unknown> } | null = null;

  if (approvedAction) {
    const result = await executeCoachTool(approvedAction.toolName, approvedAction.toolInput, userId);
    toolEvent = { name: approvedAction.toolName, message: result.message, success: result.success };
    messages.push({ role: "assistant", content: `[Tool executed: ${approvedAction.toolName}] ${result.message}` });
    messages.push({ role: "user", content: message }); // the "yes/approve" message is already there
  }

  // ── Phase 2: Check for tool use (non-streaming) ──────────────────────
  // WRITE tools require user approval — emit pendingAction event instead of executing.
  // READ tools execute immediately (no side effects).
  if (!approvedAction) {
  if (provider === "claude") {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey });
      const toolCheck = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: COACH_TOOLS as any,
        tool_choice: { type: "auto" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } } as any],
        messages: messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      });
      if (toolCheck.stop_reason === "tool_use") {
        const toolUse = toolCheck.content.find(b => b.type === "tool_use") as { type: "tool_use"; name: string; input: Record<string, unknown> } | undefined;
        if (toolUse) {
          if (WRITE_TOOLS.has(toolUse.name)) {
            toolEvent = { name: toolUse.name, message: describeAction(toolUse.name, toolUse.input), success: true, pending: true, pendingInput: toolUse.input };
            messages.push({ role: "assistant", content: `[Awaiting approval: ${toolUse.name}] ${toolEvent.message}` });
          } else {
            const result = await executeCoachTool(toolUse.name, toolUse.input, userId);
            if (result.success) toolEvent = { name: toolUse.name, message: result.message, success: true };
            messages.push({ role: "assistant", content: `[Tool: ${toolUse.name}]\n${result.data}` });
            messages.push({ role: "user", content: result.success
              ? "Analyze and answer my question based on this data."
              : "Tool failed. Respond based on your existing context without assuming you have fresh data." });
          }
        }
      }
    } catch { /* tool check failed — fall through to normal stream */ }
  } else if (provider === "nvidia") {
    try {
      const OpenAI = (await import("openai")).default;
      const oaiClient = new OpenAI({ apiKey, baseURL: "https://integrate.api.nvidia.com/v1" });
      const nvidiaModel = aiSettings?.nvidiaModel ?? NVIDIA_DEFAULT_MODEL;
      const toolCheck = await oaiClient.chat.completions.create({
        model: nvidiaModel,
        max_tokens: 400,
        tools: toOpenAITools(),
        tool_choice: "auto",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
      });
      const choice = toolCheck.choices[0];
      if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.[0]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = choice.message.tool_calls[0] as any;
        const toolName = tc.function.name as string;
        const toolInput = JSON.parse(tc.function.arguments as string) as Record<string, unknown>;
        if (WRITE_TOOLS.has(toolName)) {
          toolEvent = { name: toolName, message: describeAction(toolName, toolInput), success: true, pending: true, pendingInput: toolInput };
          messages.push({ role: "assistant", content: `[Inväntar godkännande: ${toolName}] ${toolEvent.message}` });
        } else {
          const result = await executeCoachTool(toolName, toolInput, userId);
          if (result.success) toolEvent = { name: toolName, message: result.message, success: true };
          messages.push({ role: "assistant", content: `[Tool: ${toolName}]\n${result.data}` });
          messages.push({ role: "user", content: result.success
            ? "Analyze and answer my question based on this data."
            : "Tool failed. Respond based on your existing context without assuming you have fresh data." });
        }
      }
    } catch { /* tool check failed */ }
  } else if (provider === "groq") {
    try {
      const OpenAI = (await import("openai")).default;
      const oaiClient = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
      const groqModel = aiSettings?.groqModel ?? GROQ_DEFAULT_MODEL;
      const toolCheck = await oaiClient.chat.completions.create({
        model: groqModel,
        max_tokens: 400,
        tools: toOpenAITools(),
        tool_choice: "auto",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
      });
      const choice = toolCheck.choices[0];
      if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.[0]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = choice.message.tool_calls[0] as any;
        const toolName = tc.function.name as string;
        const toolInput = JSON.parse(tc.function.arguments as string) as Record<string, unknown>;
        if (WRITE_TOOLS.has(toolName)) {
          toolEvent = { name: toolName, message: describeAction(toolName, toolInput), success: true, pending: true, pendingInput: toolInput };
          messages.push({ role: "assistant", content: `[Inväntar godkännande: ${toolName}] ${toolEvent.message}` });
        } else {
          const result = await executeCoachTool(toolName, toolInput, userId);
          if (result.success) toolEvent = { name: toolName, message: result.message, success: true };
          messages.push({ role: "assistant", content: `[Tool: ${toolName}]\n${result.data}` });
          messages.push({ role: "user", content: result.success
            ? "Analyze and answer my question based on this data."
            : "Tool failed. Respond based on your existing context without assuming you have fresh data." });
        }
      }
    } catch { /* tool check failed */ }
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
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const chat = model.startChat({ history });
      const lastUser = messages.at(-1)!;
      const userText = recentActivities
        ? `[Recent training data]\n${recentActivities}\n\n---\n\n${lastUser.content}`
        : lastUser.content;
      const result = await chat.sendMessage(userText);
      const fcPart = result.response.candidates?.[0]?.content.parts.find(p => "functionCall" in p);
      if (fcPart && "functionCall" in fcPart && fcPart.functionCall) {
        const fc = fcPart.functionCall;
        if (WRITE_TOOLS.has(fc.name)) {
          toolEvent = { name: fc.name, message: describeAction(fc.name, fc.args as Record<string, unknown>), success: true, pending: true, pendingInput: fc.args as Record<string, unknown> };
          messages.push({ role: "assistant", content: `[Inväntar godkännande: ${fc.name}] ${toolEvent.message}` });
        } else {
          const toolResult = await executeCoachTool(fc.name, fc.args as Record<string, unknown>, userId);
          if (toolResult.success) toolEvent = { name: fc.name, message: toolResult.message, success: true };
          messages.push({ role: "assistant", content: `[Tool: ${fc.name}]\n${toolResult.data}` });
          messages.push({ role: "user", content: toolResult.success
            ? "Analyze and answer my question based on this data."
            : "Tool failed. Respond based on your existing context without assuming you have fresh data." });
        }
      }
    } catch { /* tool check failed */ }
  }
  } // end if (!approvedAction)

  // ── Phase 2: Stream text response ────────────────────────────────────
  const aiClient = provider === "claude"
    ? new ClaudeClient(apiKey)
    : provider === "nvidia"
    ? new NvidiaClient(apiKey, aiSettings?.nvidiaModel ?? NVIDIA_DEFAULT_MODEL)
    : provider === "groq"
    ? new GroqClient(apiKey, aiSettings?.groqModel ?? GROQ_DEFAULT_MODEL)
    : new GeminiClient(apiKey);

  const encoder = new TextEncoder();
  let fullResponse = "";
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send conversationId first so client can track it
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ convId })}\n\n`));

        // Emit tool event (completed action or pending approval request)
        if (toolEvent) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            toolCall: {
              name: toolEvent.name,
              message: toolEvent.message,
              success: toolEvent.success,
              pending: toolEvent.pending ?? false,
              pendingInput: toolEvent.pendingInput ?? null,
            }
          })}\n\n`));
        }

        for await (const chunk of aiClient.stream(systemPrompt, messages, recentActivities)) {
          if (chunk.done) {
            inputTokens = chunk.inputTokens ?? 0;
            outputTokens = chunk.outputTokens ?? 0;
            cacheReadTokens = chunk.cacheReadTokens ?? 0;
          } else {
            fullResponse += chunk.text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`));
          }
        }

        // Save assistant message + cost
        const cost = estimateCost(provider as "claude" | "gemini", inputTokens, outputTokens, cacheReadTokens);
        await prisma.message.create({
          data: {
            conversationId: convId!,
            role: "assistant",
            content: fullResponse,
            tokensUsed: inputTokens + outputTokens,
            estimatedCostUsd: cost,
            modelUsed: provider === "claude" ? "claude-sonnet-4-6" : provider === "nvidia" ? (aiSettings?.nvidiaModel ?? NVIDIA_DEFAULT_MODEL) : provider === "groq" ? (aiSettings?.groqModel ?? GROQ_DEFAULT_MODEL) : "gemini-2.5-flash",
          },
        });

        // Update monthly spend for the correct provider
        if (cost > 0) {
          const updateField = provider === "gemini"
            ? { geminiCurrentMonthSpendUsd: { increment: cost } }
            : (provider === "nvidia" || provider === "groq")
            ? {}  // free tier — no spend tracking needed
            : { currentMonthSpendUsd: { increment: cost } };
          const createField = provider === "gemini"
            ? { geminiCurrentMonthSpendUsd: cost }
            : (provider === "nvidia" || provider === "groq")
            ? {}
            : { currentMonthSpendUsd: cost };
          await prisma.aISettings.upsert({
            where: { userId },
            create: { userId, ...createField },
            update: updateField,
          });
        }

        // Send done event with cost info
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true, cost, inputTokens, outputTokens, cacheReadTokens,
        })}\n\n`));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[coach/chat] stream error:", msg);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function describeAction(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "create_workout":
      return `Add "${input.name}" (${input.sportType}) on ${input.date}${input.targetDistanceKm ? ` · ${input.targetDistanceKm}km` : ""}${input.targetDurationMin ? ` · ${input.targetDurationMin}min` : ""}`;
    case "delete_workout":
      return `Delete workout with ID ${input.workoutId}`;
    case "update_profile":
      return `Update profile: ${Object.entries(input).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    default:
      return `Perform ${toolName}`;
  }
}
