import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const goalSchema = z.object({
  sport:  z.string().default(""), // "" = all sports combined
  metric: z.enum(["distance", "time"]),
  period: z.enum(["week", "month", "year"]),
  target: z.number().positive(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const goals = await prisma.trainingGoal.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { sport, metric, period, target } = parsed.data;
  const goal = await prisma.trainingGoal.upsert({
    where: { userId_sport_metric_period: { userId: session.user.id, sport, metric, period } },
    create: { userId: session.user.id, sport, metric, period, target },
    update: { target },
  });
  return NextResponse.json(goal);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await prisma.trainingGoal.deleteMany({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
