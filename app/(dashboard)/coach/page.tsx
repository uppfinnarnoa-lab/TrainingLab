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
      take: 30,
      select: {
        id: true, title: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
  ]);

  const targetId = conv ?? conversations[0]?.id;
  const initialMessages = targetId
    ? await prisma.message.findMany({
        where: { conversationId: targetId },
        orderBy: { createdAt: "asc" },
        take: 40,
        select: { id: true, role: true, content: true, estimatedCostUsd: true, tokensUsed: true, modelUsed: true },
      })
    : [];

  const provider = (aiSettings?.provider ?? "gemini") as "claude" | "gemini" | "nvidia" | "groq";
  const hasApiKey = provider === "claude"
    ? !!(aiSettings?.claudeApiKey ?? process.env.ANTHROPIC_API_KEY)
    : provider === "nvidia"
    ? !!aiSettings?.nvidiaApiKey
    : provider === "groq"
    ? !!aiSettings?.groqApiKey
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

  const initialLanguage = (aiSettings?.coachLanguage ?? "sv") as "en" | "sv";

  return (
    // On mobile: keep pt-14 gap (clears the fixed hamburger button), remove side+bottom padding only.
    // On desktop: remove all padding with -m-6 for full bleed.
    <div className="-mx-4 -mb-4 md:-m-6 h-[calc(100vh-56px)] md:h-screen flex flex-col">
      <ChatInterface
        provider={provider}
        hasApiKey={hasApiKey}
        monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
        currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
        initialConversationId={targetId}
        initialMessages={msgs}
        conversations={convList}
        initialLanguage={initialLanguage}
      />
    </div>
  );
}
