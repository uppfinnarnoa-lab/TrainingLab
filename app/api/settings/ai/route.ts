import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const schema = z.object({
  provider: z.enum(["claude", "gemini"]),
  claudeApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
  monthlyBudgetUsd: z.number().min(0).max(1000),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { provider, claudeApiKey, geminiApiKey, monthlyBudgetUsd } = parsed.data;

  await prisma.aISettings.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      provider,
      ...(claudeApiKey ? { claudeApiKey } : {}),
      ...(geminiApiKey ? { geminiApiKey } : {}),
      monthlyBudgetUsd,
    },
    update: {
      provider,
      ...(claudeApiKey ? { claudeApiKey } : {}),
      ...(geminiApiKey ? { geminiApiKey } : {}),
      monthlyBudgetUsd,
    },
  });

  return NextResponse.json({ ok: true });
}
