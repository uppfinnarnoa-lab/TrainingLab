import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { updateEvent, deleteEvent } from "@/lib/google-calendar/sync";

const updateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  name: z.string().min(1).max(120).optional(),
  sportType: z.string().optional(),
  typeId: z.string().cuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  targetDistance: z.number().positive().optional().nullable(),
  targetDuration: z.number().int().positive().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  status: z.enum(["planned", "completed", "missed", "partial"]).optional(),
  missedReason: z.string().optional().nullable(),
  missedNote: z.string().max(500).optional().nullable(),
});

// Prisma returns @db.Date columns as JS Date objects, which JSON-serialize to
// full ISO timestamps. Normalize to YYYY-MM-DD so <input type="date"> and the
// PATCH date regex both accept the value unchanged on a follow-up save.
function serialiseWorkout<T extends { date: Date }>(w: T) {
  return { ...w, date: w.date.toISOString().slice(0, 10) };
}

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

  if (parsed.data.typeId) {
    const type = await prisma.workoutType.findUnique({ where: { id: parsed.data.typeId } });
    if (!type || type.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

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
    include: { template: { include: { sections: { orderBy: { order: "asc" } } } } },
  });

  updateEvent(session.user.id, updated).catch(e => console.error("[google-calendar] updateEvent error:", e));

  return NextResponse.json(serialiseWorkout(updated));
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const workout = await getOwned(id, session.user.id);
  if (!workout) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.plannedWorkout.delete({ where: { id } });

  if (workout.googleEventId) {
    deleteEvent(session.user.id, workout.googleEventId).catch(e => console.error("[google-calendar] deleteEvent error:", e));
  }

  return NextResponse.json({ ok: true });
}
