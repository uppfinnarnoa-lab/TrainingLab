/**
 * Fitness metrics cache — two separate update paths:
 *
 * AUTO (after every Strava sync):
 *   updateVO2maxAndPaces() — VO2max, VDOT, pace zones
 *   These use broad data and update continuously.
 *
 * MANUAL (button press only):
 *   updateHRZones() — maxHR, restHR, thresholdHR, HR zones
 *   HR zones should only change when explicitly recalibrated.
 */

import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold } from "./zones";
import { estimateVO2max } from "./vo2max";
import { subDays } from "date-fns";

type Act = {
  sportType: string; name: string; distance: number; movingTime: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; bestEfforts: unknown;
};

async function loadActivities(userId: string) {
  return prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
    select: {
      sportType: true, name: true, distance: true, movingTime: true,
      averageHeartrate: true, maxHeartrate: true,
      averageSpeed: true, isRace: true, bestEfforts: true,
    },
  });
}

// ── AUTO path: VO2max + paces (runs after every sync) ─────────────────────
export async function updateVO2maxAndPaces(userId: string) {
  const [profile, activities, garminRecent, existingCache] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    loadActivities(userId),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 7) } },
      orderBy: { date: "asc" }, select: { restingHR: true },
    }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
  ]);

  // Use stored HR zones if they exist (don't recompute on auto-update)
  const maxHR   = profile?.maxHeartRate    ?? existingCache?.maxHR    ?? 190;
  const restHR  = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? existingCache?.restHR ?? 50;

  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
    })),
    maxHR, restHR,
  );

  const paceZones = buildPaceZones(vo2maxResult.vdot);

  // Keep existing HR zones if they exist — only update VO2max + paces
  const existingZones = (existingCache?.zones as object | null) ?? buildHRZonesJson(maxHR, restHR);

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId,
      vo2max:     vo2maxResult.value,
      vdot:       vo2maxResult.vdot,
      confidence: vo2maxResult.confidence,
      method:     vo2maxResult.method,
      maxHR, restHR,
      thresholdHR: existingCache?.thresholdHR ?? Math.round(maxHR * 0.88),
      zones: existingZones,
      paces: pacesJson(paceZones),
    },
    update: {
      vo2max:     vo2maxResult.value,
      vdot:       vo2maxResult.vdot,
      confidence: vo2maxResult.confidence,
      method:     vo2maxResult.method,
      // DO NOT update maxHR/restHR/thresholdHR/zones here — only on button press
      paces: pacesJson(paceZones),
    },
  });

  return { vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot };
}

// ── MANUAL path: HR zones (button press only) ─────────────────────────────
export async function updateHRZones(userId: string) {
  const [profile, activities, garminRecent] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    loadActivities(userId),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 7) } },
      orderBy: { date: "asc" }, select: { restingHR: true },
    }),
  ]);

  const maxHRs = (activities as Act[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const observedMax = maxHRs.length > 0 ? Math.max(...maxHRs) : 200;

  // Threshold-based estimation — use HR from hard runs
  const thresholdHRs = (activities as Act[])
    .filter(a => a.averageHeartrate && a.averageHeartrate > observedMax * 0.82
      && a.sportType.toLowerCase().includes("run"))
    .map(a => a.averageHeartrate!);

  const maxHR = profile?.maxHeartRate
    ?? estimateMaxHRFromThreshold(thresholdHRs)
    ?? estimateMaxHR(maxHRs);
  const restHR = profile?.restingHeartRate
    ?? garminRecent.at(-1)?.restingHR
    ?? 50;

  const hrZones = buildHRZones(maxHR, restHR);
  const thresholdHR = Math.round((hrZones.z4[0] + hrZones.z4[1]) / 2);

  const zonesJson = buildHRZonesJson(maxHR, restHR);

  // Also recompute VO2max with the updated maxHR
  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
    })),
    maxHR, restHR,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId, maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones),
    },
    update: { maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones),
    },
  });

  // Persist maxHR + restHR to AthleteProfile so stats page picks them up
  await prisma.athleteProfile.upsert({
    where: { userId },
    create: { userId, maxHeartRate: maxHR, restingHeartRate: restHR },
    update: { maxHeartRate: maxHR, restingHeartRate: restHR },
  });

  return { maxHR, restHR, thresholdHR, zones: zonesJson, vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot };
}

// ── Backwards-compat wrapper (called by calibrate route) ──────────────────
export async function computeAndCacheFitness(userId: string) {
  return updateHRZones(userId);
}

export async function getFitnessCache(userId: string) {
  return prisma.fitnessCache.findUnique({ where: { userId } });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function buildHRZonesJson(maxHR: number, restHR: number) {
  const z = buildHRZones(maxHR, restHR);
  return { z1: z.z1, z2: z.z2, z3: z.z3, z4: z.z4, z5: z.z5 };
}

function pacesJson(p: ReturnType<typeof buildPaceZones>) {
  return { easy: p.easy, marathon: p.marathon, threshold: p.threshold, interval: p.interval, repetition: p.repetition };
}
