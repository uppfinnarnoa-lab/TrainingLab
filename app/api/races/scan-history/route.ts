import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import type { RaceRecord } from "@prisma/client";
import { detectPBsForActivity } from "@/lib/races/pb-detection";

/**
 * Explicit, user-initiated bulk scan of ALL past activities for PBs / near-PB
 * results — deliberately bypasses pbDetectionMode and the enable-timestamp
 * guard that the live sync hook respects, since this is itself the deliberate
 * one-time action that guard exists to protect against running automatically.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { pbDetectionTolerancePct: true },
  });
  const tolerancePct = profile?.pbDetectionTolerancePct ?? 5;

  const activities = await prisma.activity.findMany({
    where: {
      userId,
      OR: [
        { sportType: { contains: "run", mode: "insensitive" } },
        { sportType: { contains: "trail", mode: "insensitive" } },
      ],
    },
    select: { id: true },
    orderBy: { startDate: "asc" }, // oldest first, so each result is compared against the true best-so-far at that point in time
  });

  const records: RaceRecord[] = [];
  for (const a of activities) {
    records.push(...await detectPBsForActivity(userId, a.id, tolerancePct));
  }

  return NextResponse.json({ created: records.length, records });
}
