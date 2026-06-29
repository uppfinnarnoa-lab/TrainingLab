import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/planner/backfill-workout-colors
 *
 * One-time fix: WorkoutTemplate/PlannedWorkout color used to be computed from the
 * static workoutColor() regex at creation time instead of the real, user-editable
 * SportCategory/WorkoutType.color — so changing a color in Settings never affected
 * already-created rows. Recomputes color from the real type/sport relations for
 * every existing row so the fix takes effect immediately, not just for new ones.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [templates, workouts, sports] = await Promise.all([
    prisma.workoutTemplate.findMany({ where: { userId }, include: { sport: true, type: true } }),
    prisma.plannedWorkout.findMany({
      where: { userId },
      include: { type: true, template: { include: { sport: true, type: true } } },
    }),
    prisma.sportCategory.findMany({ where: { userId }, select: { name: true, color: true } }),
  ]);
  const sportColorByName: Record<string, string> = {};
  for (const s of sports) sportColorByName[s.name.toLowerCase()] = s.color;

  let templatesFixed = 0;
  for (const t of templates) {
    const correct = t.type?.color ?? t.sport.color;
    if (t.color !== correct) {
      await prisma.workoutTemplate.update({ where: { id: t.id }, data: { color: correct } });
      templatesFixed++;
    }
  }

  let workoutsFixed = 0;
  for (const w of workouts) {
    const correct = w.type?.color
      ?? w.template?.type?.color
      ?? w.template?.sport?.color
      ?? sportColorByName[w.sportType.toLowerCase()]
      ?? null;
    if (correct && w.color !== correct) {
      await prisma.plannedWorkout.update({ where: { id: w.id }, data: { color: correct } });
      workoutsFixed++;
    }
  }

  return NextResponse.json({ templatesFixed, workoutsFixed });
}
