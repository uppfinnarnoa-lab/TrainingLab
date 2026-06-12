import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/planner/backfill-running-sports
 *
 * One-time backfill: marks "Running"/"Run" and "Orienteering" sport
 * categories as isRunningRelated, since the weekly km projection now
 * relies on this flag instead of a hardcoded sport-name regex.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const result = await prisma.sportCategory.updateMany({
    where: {
      userId,
      isRunningRelated: false,
      OR: [
        { name: { in: ["Running", "Run"] } },
        { name: { contains: "orienteer", mode: "insensitive" } },
        { name: { contains: "orientering", mode: "insensitive" } },
      ],
    },
    data: { isRunningRelated: true },
  });

  return NextResponse.json({ sportsFixed: result.count });
}
