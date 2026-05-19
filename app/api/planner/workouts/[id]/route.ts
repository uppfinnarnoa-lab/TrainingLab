import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const updateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  name: z.string().min(1).max(120).optional(),
  sportType: z.string().optional(),
  notes: z.string().max(1000).optional().nullable(),
  targetDistance: z.number().positive().optional().nullable(),
  targetDuration: z.number().int().positive().optional().nullable(),
  color: z.string().optional().nullable(),
  status: z.enum(["planned", "completed", "missed", "partial"]).optional(),
  missedReason: z.string().optional().nullable(),
  missedNote: z.string().max(500).optional().nullable(),
});

async function getOwned(id: string, userId: string) {
  const w = await prisma.plannedWorkout.findUnique({ where: { id } });
  if (!w || w.userId !== userId) return null;
  return w;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const workout = await getOwned(id, session.user.id);
  if (!workout) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // Enforce: cannot set status on future workout (compare date strings to avoid timezone issues)
  if (parsed.data.status && parsed.data.status !== "planned") {
    const todayStr = new Date().toISOString().split("T")[0];
    const workoutDateStr = workout.date instanceof Date
      ? workout.date.toISOString().split("T")[0]
      : String(workout.date).slice(0, 10);
    if (workoutDateStr > todayStr) {
      return NextResponse.json({ error: "cannot_mark_future" }, { status: 422 });
    }
  }

  const updated = await prisma.plannedWorkout.update({
    where: { id },
    data: {
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
      markedAt: parsed.data.status ? new Date() : undefined,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const workout = await getOwned(id, session.user.id);
  if (!workout) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.plannedWorkout.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
