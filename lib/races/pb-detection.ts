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
 * - No MANUAL record for the distance yet: only a flagged race may record at all,
 *   improvement or not. A single auto-detected race-flagged entry isn't a reliable
 *   enough anchor on its own (it may just be one segment of a much longer race) —
 *   without this gate, a chain of noisy training splits each slightly faster than
 *   the last can flood a distance with "new PBs" that aren't real (see
 *   docs/planning/Planerattköra/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md §4).
 * - Once a manual baseline exists: record if the new time is within `tolerancePct`
 *   of it (0% = strict PBs only), but cap non-improving near-PB matches to the last
 *   365 days — a genuine new all-time best is always recorded regardless of age.
 */
export function shouldRecordResult(opts: {
  newTimeSec: number;
  currentBestSec: number | null;
  tolerancePct: number;
  isRace: boolean;
  withinLastYear: boolean;
  distanceHasManualBaseline: boolean;
}): boolean {
  const { newTimeSec, currentBestSec, tolerancePct, isRace, withinLastYear, distanceHasManualBaseline } = opts;
  if (currentBestSec === null) return isRace;
  if (!distanceHasManualBaseline && !isRace) return false;
  if (newTimeSec < currentBestSec) return true;
  return withinLastYear && newTimeSec <= currentBestSec * (1 + tolerancePct / 100);
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

    const distanceRecords = await prisma.raceRecord.findMany({
      where: { userId, distance: matched.label },
      select: { time: true, isManual: true },
    });
    const currentBestSec = distanceRecords.length > 0
      ? Math.min(...distanceRecords.map((r: { time: number }) => r.time))
      : null;
    const distanceHasManualBaseline = distanceRecords.some((r: { isManual: boolean }) => r.isManual);
    const withinLastYear = Date.now() - recordDate.getTime() <= 365 * 24 * 60 * 60 * 1000;

    const record = shouldRecordResult({
      newTimeSec: raw.elapsed_time,
      currentBestSec,
      tolerancePct,
      isRace: activity.isRace,
      withinLastYear,
      distanceHasManualBaseline,
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
