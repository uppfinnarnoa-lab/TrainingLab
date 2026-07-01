import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { createEvent } from "@/lib/google-calendar/sync";

const workoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(120),
  sportType: z.string().min(1).max(60),
  notes: z.string().max(1000).optional().nullable(),
  targetDistance: z.number().nonnegative().optional().nullable(),
  targetDuration: z.number().int().nonnegative().optional().nullable(),
  targetIntensity: z.string().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  templateId: z.string().cuid().optional().nullable(),
  typeId: z.string().cuid().optional().nullable(),
});

// Prisma returns @db.Date columns as JS Date objects, which JSON-serialize to
// full ISO timestamps. Normalize to YYYY-MM-DD so <input type="date"> and the
// PATCH date regex both accept the value unchanged.
function serialiseWorkout<T extends { date: Date }>(w: T) {
  return { ...w, date: w.date.toISOString().slice(0, 10) };
}

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
    include: { template: { include: { sport: true, sections: { orderBy: { order: "asc" } } } }, type: true },
  });

  return NextResponse.json(workouts.map(serialiseWorkout));
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

  if (parsed.data.typeId) {
    const type = await prisma.workoutType.findUnique({ where: { id: parsed.data.typeId } });
    if (!type || type.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const workout = await prisma.plannedWorkout.create({
    data: {
      ...parsed.data,
      date: new Date(parsed.data.date),
      userId: session.user.id,
    },
    include: { template: { include: { sport: true, sections: { orderBy: { order: "asc" } } } }, type: true },
  });

  createEvent(session.user.id, workout).catch(e => console.error("[google-calendar] createEvent error:", e));

  return NextResponse.json(serialiseWorkout(workout), { status: 201 });
}
