// Fitness metrics cache — stores computed VO2max, zones, paces in DB.
// Recomputed after each Strava sync or when user triggers recalibration.

import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold } from "./zones";
import { estimateVO2max } from "./vo2max";
import { subDays } from "date-fns";

type Act = {
  sportType: string; name: string; distance: number; movingTime: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; bestEfforts: unknown;
};

export async function computeAndCacheFitness(userId: string) {
  const [profile, activities, garminRecent] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
      select: {
        sportType: true, name: true, distance: true, movingTime: true,
        averageHeartrate: true, maxHeartrate: true,
        averageSpeed: true, isRace: true, bestEfforts: true,
      },
    }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 7) } },
      orderBy: { date: "asc" },
      select: { restingHR: true },
    }),
  ]);

  const maxHRs = (activities as Act[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const observedMax = maxHRs.length > 0 ? Math.max(...maxHRs) : 200;
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

  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
    })),
    maxHR, restHR,
  );

  const hrZones = buildHRZones(maxHR, restHR);
  const paceZones = buildPaceZones(vo2maxResult.vdot);

  // Threshold HR ≈ Z4 midpoint
  const thresholdHR = Math.round((hrZones.z4[0] + hrZones.z4[1]) / 2);

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId,
      vo2max:     vo2maxResult.value,
      vdot:       vo2maxResult.vdot,
      confidence: vo2maxResult.confidence,
      method:     vo2maxResult.method,
      maxHR, restHR, thresholdHR,
      zones: {
        z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3,
        z4: hrZones.z4, z5: hrZones.z5,
      },
      paces: {
        easy:       paceZones.easy,
        marathon:   paceZones.marathon,
        threshold:  paceZones.threshold,
        interval:   paceZones.interval,
        repetition: paceZones.repetition,
      },
    },
    update: {
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      maxHR, restHR, thresholdHR,
      zones: {
        z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3,
        z4: hrZones.z4, z5: hrZones.z5,
      },
      paces: {
        easy: paceZones.easy, marathon: paceZones.marathon,
        threshold: paceZones.threshold, interval: paceZones.interval,
        repetition: paceZones.repetition,
      },
    },
  });

  return { vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot, maxHR, restHR };
}

export async function getFitnessCache(userId: string) {
  return prisma.fitnessCache.findUnique({ where: { userId } });
}
