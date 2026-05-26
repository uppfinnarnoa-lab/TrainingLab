import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ClaudeClient } from "@/lib/ai/claude";
import { GeminiClient } from "@/lib/ai/gemini";
import { buildCoachContext, buildRecentActivitiesSummary } from "@/lib/ai/context-builder";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { estimateCost } from "@/lib/ai/client";
import { safeDecrypt } from "@/lib/encrypt";
import { COACH_TOOLS, toGeminiTools, executeCoachTool, WRITE_TOOLS } from "@/lib/ai/tools";
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

  const { conversationId, message, approvedAction } = parsed.data;

  // ── Load AI settings ────────────────────────────────────────────────
  const [aiSettings, user] = await Promise.all([
    prisma.aISettings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const provider = aiSettings?.provider ?? "gemini";
  const apiKey = provider === "claude"
    ? (safeDecrypt(aiSettings?.claudeApiKey) ?? process.env.ANTHROPIC_API_KEY ?? "")
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
    const budget  = provider === "gemini" ? aiSettings.geminiMonthlyBudgetUsd  : aiSettings.monthlyBudgetUsd;
    const current = provider === "gemini" ? aiSettings.geminiCurrentMonthSpendUsd : aiSettings.currentMonthSpendUsd;
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
  const systemPrompt = buildSystemPrompt(coachCtx);

  // ── Save user message ────────────────────────────────────────────────
  await prisma.message.create({
    data: { conversationId: convId, role: "user", content: message },
  });

  // ── Phase 1: Execute pre-approved write action (if user said "yes") ───
  let toolEvent: { name: string; message: string; success: boolean; pending?: boolean; pendingInput?: Record<string, unknown> } | null = null;

  if (approvedAction) {
    const result = await executeCoachTool(approvedAction.toolName, approvedAction.toolInput, userId);
    toolEvent = { name: approvedAction.toolName, message: result.message, success: result.success };
    messages.push({ role: "assistant", content: `[Verktyg utfört: ${approvedAction.toolName}] ${result.message}` });
    messages.push({ role: "user", content: message }); // the "ja/godkänn" message is already there
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
            // Write tool — request user approval, don't execute yet
            toolEvent = { name: toolUse.name, message: describeAction(toolUse.name, toolUse.input), success: true, pending: true, pendingInput: toolUse.input };
            messages.push({ role: "assistant", content: `[Inväntar godkännande: ${toolUse.name}] ${toolEvent.message}` });
          } else {
            // Read tool — execute immediately (no side effects)
            const result = await executeCoachTool(toolUse.name, toolUse.input, userId);
            toolEvent = { name: toolUse.name, message: result.message, success: result.success };
            messages.push({ role: "assistant", content: `[Tool: ${toolUse.name}]\n${result.data}` });
            messages.push({ role: "user", content: "Analysera och svara på min fråga baserat på dessa data." });
          }
        }
      }
    } catch { /* tool check failed — fall through to normal stream */ }
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
          toolEvent = { name: fc.name, message: toolResult.message, success: toolResult.success };
          messages.push({ role: "assistant", content: `[Tool: ${fc.name}]\n${toolResult.data}` });
          messages.push({ role: "user", content: "Analysera och svara på min fråga baserat på dessa data." });
        }
      }
    } catch { /* tool check failed */ }
  }
  } // end if (!approvedAction)

  // ── Phase 2: Stream text response ────────────────────────────────────
  const aiClient = provider === "claude"
    ? new ClaudeClient(apiKey)
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
            modelUsed: provider === "claude" ? "claude-sonnet-4-6" : "gemini-2.5-flash",
          },
        });

        // Update monthly spend for the correct provider
        if (cost > 0) {
          const updateField = provider === "gemini"
            ? { geminiCurrentMonthSpendUsd: { increment: cost } }
            : { currentMonthSpendUsd: { increment: cost } };
          const createField = provider === "gemini"
            ? { geminiCurrentMonthSpendUsd: cost }
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
      return `Lägg till "${input.name}" (${input.sportType}) den ${input.date}${input.targetDistanceKm ? ` · ${input.targetDistanceKm}km` : ""}${input.targetDurationMin ? ` · ${input.targetDurationMin}min` : ""}`;
    case "delete_workout":
      return `Radera pass med ID ${input.workoutId}`;
    case "update_profile":
      return `Uppdatera profil: ${Object.entries(input).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    default:
      return `Utföra ${toolName}`;
  }
}
