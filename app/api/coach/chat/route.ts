import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ClaudeClient } from "@/lib/ai/claude";
import { GeminiClient } from "@/lib/ai/gemini";
import { buildCoachContext, buildRecentActivitiesSummary } from "@/lib/ai/context-builder";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { estimateCost } from "@/lib/ai/client";
import { safeDecrypt } from "@/lib/encrypt";
import type { AIMessage } from "@/lib/ai/client";
import { z } from "zod";

const schema = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().min(1).max(4000),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const { conversationId, message } = parsed.data;

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

  // ── Budget check ────────────────────────────────────────────────────────
  if (aiSettings) {
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

  // ── Stream response ──────────────────────────────────────────────────
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
