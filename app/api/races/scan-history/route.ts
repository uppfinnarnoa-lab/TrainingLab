import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { bulkDetectPBs } from "@/lib/races/pb-detection";

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

  const { created } = await bulkDetectPBs(userId, tolerancePct);
  return NextResponse.json({ created });
}
