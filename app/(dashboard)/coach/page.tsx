import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ChatInterface } from "@/components/coach/ChatInterface";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { conv } = await searchParams;

  const [aiSettings, conversations] = await Promise.all([
    prisma.aISettings.findUnique({ where: { userId } }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    }),
  ]);

  // Load conversation: explicit ?conv=ID or most recent
  const targetId = conv ?? conversations[0]?.id;
  const initialMessages = targetId
    ? await prisma.message.findMany({
        where: { conversationId: targetId },
        orderBy: { createdAt: "asc" },
        take: 40,
        select: { id: true, role: true, content: true, estimatedCostUsd: true, tokensUsed: true, modelUsed: true },
      })
    : [];

  const provider = (aiSettings?.provider ?? "gemini") as "claude" | "gemini";
  const hasApiKey = provider === "claude"
    ? !!(aiSettings?.claudeApiKey ?? process.env.ANTHROPIC_API_KEY)
    : !!(aiSettings?.geminiApiKey ?? process.env.GOOGLE_AI_API_KEY);

  type Conv = { id: string; title: string | null; updatedAt: Date; _count: { messages: number } };
  const convList = (conversations as Conv[]).map(c => ({
    id: c.id,
    title: c.title ?? "Untitled",
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
  }));

  const msgs = initialMessages.map((m: typeof initialMessages[number]) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    cost: m.estimatedCostUsd ?? undefined,
    tokens: m.tokensUsed ?? undefined,
    modelUsed: m.modelUsed ?? undefined,
  }));

  return (
    <div className="-mx-6 -my-6 h-[calc(100vh-64px)] flex">
      <ChatInterface
        provider={provider}
        hasApiKey={hasApiKey}
        monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
        currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
        initialConversationId={targetId}
        initialMessages={msgs}
        conversations={convList}
      />
    </div>
  );
}
