import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ChatInterface } from "@/components/coach/ChatInterface";

export default async function CoachPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const aiSettings = await prisma.aISettings.findUnique({ where: { userId } });

  const provider = (aiSettings?.provider ?? "gemini") as "claude" | "gemini";
  const hasApiKey = provider === "claude"
    ? !!(aiSettings?.claudeApiKey ?? process.env.ANTHROPIC_API_KEY)
    : !!(aiSettings?.geminiApiKey ?? process.env.GOOGLE_AI_API_KEY);

  return (
    <div className="-mx-6 -my-6 h-[calc(100vh-64px)] flex flex-col">
      <div className="px-6 pt-5 pb-3 border-b border-border shrink-0">
        <h1 className="text-xl font-semibold text-primary">AI Coach</h1>
        <p className="text-sm text-muted mt-0.5">
          Your personal training assistant — knows your full history, fitness metrics, and plan
        </p>
      </div>
      <ChatInterface
        provider={provider}
        hasApiKey={hasApiKey}
        monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
        currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
      />
    </div>
  );
}
