// Automatic PB / near-PB detection — see docs/planning/archive/AUTO_PB_DETECTION_PLAN_2026_06_23.md
import { prisma } from "@/lib/db/prisma";
import type { RaceRecord } from "@prisma/client";
import { matchTrackedDistance } from "./distances";

interface BestEffortRow {
  distance?: number;
  elapsed_time?: number;
}

/**
 * Pure decision: should this result be recorded as a RaceRecord?
 * - No prior record for the distance: only a flagged race seeds the first entry
 *   (avoids creating a whole new tracked distance from a casual training segment).
 * - A prior record exists: record if the new time is within `tolerancePct` of it
 *   (0% = strict PBs only; this also covers a strict new PB, since a faster time
 *   always satisfies `newTime <= currentBest * (1 + tolerancePct / 100)`).
 */
export function shouldRecordResult(opts: {
  newTimeSec: number;
  currentBestSec: number | null;
  tolerancePct: number;
  isRace: boolean;
}): boolean {
  const { newTimeSec, currentBestSec, tolerancePct, isRace } = opts;
  if (currentBestSec === null) return isRace;
  return newTimeSec <= currentBestSec * (1 + tolerancePct / 100);
}

/**
 * Scans one activity's bestEfforts and records any qualifying result, regardless
 * of pbDetectionMode — callers decide whether/when this should run. Idempotent:
 * skips a distance already recorded for this exact activity.
 */
export async function detectPBsForActivity(
  userId: string,
  activityId: string,
  tolerancePct: number,
): Promise<RaceRecord[]> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      stravaId: true, name: true, sportType: true, isRace: true,
      bestEfforts: true, startDateLocal: true,
    },
  });
  if (!activity) return [];
  if (!/run|trail/i.test(activity.sportType)) return [];
  if (!Array.isArray(activity.bestEfforts) || activity.bestEfforts.length === 0) return [];

  const stravaActivityId = activity.stravaId.toString();
  const recordDate = new Date(activity.startDateLocal.toISOString().split("T")[0]);

  const created: RaceRecord[] = [];
  for (const raw of activity.bestEfforts as BestEffortRow[]) {
    if (typeof raw?.distance !== "number" || typeof raw?.elapsed_time !== "number") continue;
    const matched = matchTrackedDistance(raw.distance);
    if (!matched) continue;

    const already = await prisma.raceRecord.findFirst({
      where: { userId, distance: matched.label, stravaActivityId },
      select: { id: true },
    });
    if (already) continue;

    const currentBest = await prisma.raceRecord.findFirst({
      where: { userId, distance: matched.label },
      orderBy: { time: "asc" },
      select: { time: true },
    });

    const record = shouldRecordResult({
      newTimeSec: raw.elapsed_time,
      currentBestSec: currentBest?.time ?? null,
      tolerancePct,
      isRace: activity.isRace,
    });
    if (!record) continue;

    const row = await prisma.raceRecord.create({
      data: {
        userId,
        distance: matched.label,
        distanceM: matched.meters,
        time: Math.round(raw.elapsed_time),
        date: recordDate,
        eventName: activity.name,
        stravaActivityId,
        isManual: false,
      },
    });
    created.push(row);
  }
  return created;
}

/**
 * Live-sync hook — call after a genuinely new Activity is created. Checks
 * pbDetectionMode and the enable-timestamp backfill guard itself, so call
 * sites don't need to duplicate that logic.
 */
export async function detectAndRecordPBs(userId: string, activityId: string): Promise<void> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { pbDetectionMode: true, pbDetectionTolerancePct: true, pbDetectionModeChangedAt: true },
  });
  if (!profile || profile.pbDetectionMode !== "automatic" || !profile.pbDetectionModeChangedAt) return;

  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { startDate: true } });
  if (!activity || activity.startDate < profile.pbDetectionModeChangedAt) return;

  await detectPBsForActivity(userId, activityId, profile.pbDetectionTolerancePct);
}
