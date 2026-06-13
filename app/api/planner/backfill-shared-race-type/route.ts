import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/planner/backfill-shared-race-type
 *
 * One-time backfill: ensures every sport has a "Race" workout type marked
 * isShared, all using the same name/color/defaultZone. Sports created
 * before the shared-type system have no "Race" type at all; sports created
 * after it have their own independent (now-stale) copy.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const existingRace = await prisma.workoutType.findFirst({
    where: { userId, name: "Race" },
    orderBy: { id: "asc" },
  });
  const canonical = {
    name: existingRace?.name ?? "Race",
    color: existingRace?.color ?? "#FBBF24",
    defaultZone: existingRace?.defaultZone ?? 5,
  };

  const sports = await prisma.sportCategory.findMany({
    where: { userId },
    include: { workoutTypes: { where: { name: "Race" } } },
  });

  let sportsFixed = 0;
  for (const sport of sports) {
    const existing = sport.workoutTypes[0];
    if (existing) {
      await prisma.workoutType.update({
        where: { id: existing.id },
        data: { ...canonical, isShared: true },
      });
    } else {
      await prisma.workoutType.create({
        data: { ...canonical, sportId: sport.id, userId, isShared: true, order: 999 },
      });
    }
    sportsFixed++;
  }

  return NextResponse.json({ sportsFixed });
}
