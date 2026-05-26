import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const workoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(120),
  sportType: z.string().min(1).max(60),
  notes: z.string().max(1000).optional().nullable(),
  targetDistance: z.number().positive().optional().nullable(),
  targetDuration: z.number().int().positive().optional().nullable(),
  targetIntensity: z.string().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  templateId: z.string().cuid().optional().nullable(),
});

// GET: planned workouts for a date range
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  const where: Record<string, unknown> = { userId: session.user.id };
  if (from && dateRe.test(from)) where.date = { gte: new Date(from) };
  if (to && dateRe.test(to)) where.date = { ...((where.date as Record<string, unknown>) ?? {}), lte: new Date(to) };

  const workouts = await prisma.plannedWorkout.findMany({
    where,
    orderBy: { date: "asc" },
    include: { template: { include: { sport: true, sections: { orderBy: { order: "asc" } } } } },
  });

  return NextResponse.json(workouts);
}

// POST: create a planned workout
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = workoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  if (parsed.data.templateId) {
    const tmpl = await prisma.workoutTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!tmpl || tmpl.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const workout = await prisma.plannedWorkout.create({
    data: {
      ...parsed.data,
      date: new Date(parsed.data.date),
      userId: session.user.id,
    },
    include: { template: { include: { sport: true, sections: { orderBy: { order: "asc" } } } } },
  });

  return NextResponse.json(workout, { status: 201 });
}
