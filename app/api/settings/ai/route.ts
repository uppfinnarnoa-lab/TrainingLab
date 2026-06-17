import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { encryptIfNeeded } from "@/lib/encrypt";
import { z } from "zod";

const schema = z.object({
  provider:               z.enum(["claude", "gemini", "nvidia", "groq"]).optional(),
  claudeApiKey:           z.string().optional(),
  geminiApiKey:           z.string().optional(),
  nvidiaApiKey:           z.string().optional(),
  nvidiaModel:            z.string().optional(),
  groqApiKey:             z.string().optional(),
  groqModel:              z.string().optional(),
  monthlyBudgetUsd:       z.number().min(0).max(1000).optional(),
  geminiMonthlyBudgetUsd: z.number().min(0).max(1000).optional(),
  coachLanguage:          z.enum(["sv", "en"]).optional(),
});

export async function POST(req: NextRequest) {
  return handleUpdate(req);
}

export async function PATCH(req: NextRequest) {
  return handleUpdate(req);
}

async function handleUpdate(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { provider, claudeApiKey, geminiApiKey, nvidiaApiKey, nvidiaModel, groqApiKey, groqModel, monthlyBudgetUsd, geminiMonthlyBudgetUsd, coachLanguage } = parsed.data;

  const data: Record<string, unknown> = {};
  if (provider              !== undefined) data.provider               = provider;
  if (claudeApiKey                       ) data.claudeApiKey            = encryptIfNeeded(claudeApiKey)!;
  if (geminiApiKey                       ) data.geminiApiKey            = encryptIfNeeded(geminiApiKey)!;
  if (nvidiaApiKey                       ) data.nvidiaApiKey            = encryptIfNeeded(nvidiaApiKey)!;
  if (nvidiaModel           !== undefined) data.nvidiaModel             = nvidiaModel;
  if (groqApiKey                         ) data.groqApiKey              = encryptIfNeeded(groqApiKey)!;
  if (groqModel             !== undefined) data.groqModel               = groqModel;
  if (monthlyBudgetUsd      !== undefined) data.monthlyBudgetUsd        = monthlyBudgetUsd;
  if (geminiMonthlyBudgetUsd !== undefined) data.geminiMonthlyBudgetUsd = geminiMonthlyBudgetUsd;
  if (coachLanguage         !== undefined) data.coachLanguage           = coachLanguage;

  await prisma.aISettings.upsert({
    where:  { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}
