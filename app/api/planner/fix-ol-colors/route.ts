import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/planner/fix-ol-colors
 *
 * Clears stale stored colors for Orienteering planned workouts so they fall
 * back to the dynamic workoutColor() computation in WorkoutPill.
 * Preserves race yellow (#FBBF24) and already-correct teal (#14B8A6).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // Find OL/Orienteering sport names for this user
  const olSports = await prisma.sportCategory.findMany({
    where: {
      userId,
      OR: [
        { name: { contains: "orienteer", mode: "insensitive" } },
        { name: { contains: "orientering", mode: "insensitive" } },
        { name: { equals: "ol", mode: "insensitive" } },
      ],
    },
    select: { name: true },
  });

  if (olSports.length === 0) return NextResponse.json({ workoutsFixed: 0 });

  const olNames = olSports.map((s: { name: string }) => s.name);

  // Clear wrong colors — preserve null (already dynamic), correct teal, and race yellow
  const result = await prisma.plannedWorkout.updateMany({
    where: {
      userId,
      sportType: { in: olNames },
      NOT: [{ color: null }, { color: "#14B8A6" }, { color: "#FBBF24" }],
    },
    data: { color: null },
  });

  return NextResponse.json({ workoutsFixed: result.count });
}
