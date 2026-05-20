/**
 * Fitness metrics cache — two separate update paths:
 *
 * AUTO (after every Strava sync):
 *   updateVO2maxAndPaces() — computes and caches everything:
 *   VO2max, VDOT, paces, ATL/CTL/TSB, ACWR, weekly volumes,
 *   zone seconds, polarisation, race predictions.
 *   Stats page reads from this cache instead of recomputing on every load.
 *
 * MANUAL (button press only):
 *   updateHRZones() — maxHR, restHR, thresholdHR, HR zones
 *   HR zones should only change when explicitly recalibrated.
 */

import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildHRZonesFromLT, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold, estimateMaxHRFromRaces, estimateLTFromRaces, estimateZonesFromStatisticalAnalysis, MAXHR_ARTIFACT_CAP } from "./zones";
import { estimateVO2max, buildHRPaceRegressionParams, predictRaceTime, tsbAdjustedRaceTime, riegelPredict, predictionRange, vdotFromRace, gradeAdjustedPace, type RacePB } from "./vo2max";
import { computeTSS, buildLoadCurve, computeACWR } from "./training-load";
import { RACE_DISTANCES } from "./paces";
import { subDays, format, startOfWeek } from "date-fns";

type Act = {
  sportType: string; name: string; distance: number; movingTime: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; bestEfforts: unknown;
  startDate: Date; totalElevationGain: number;
};

async function loadActivities(userId: string) {
  return prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      sportType: true, name: true, distance: true, movingTime: true,
      averageHeartrate: true, maxHeartrate: true, totalElevationGain: true,
      averageSpeed: true, isRace: true, bestEfforts: true, startDate: true,
    },
  });
}

async function loadRacePBs(userId: string): Promise<RacePB[]> {
  const records = await prisma.raceRecord.findMany({
    where: { userId, date: { gte: subDays(new Date(), 5 * 365) } },
    select: { distanceM: true, time: true, date: true },
    orderBy: { time: "asc" },
  });
  const bestPerDist = new Map<number, RacePB>();
  for (const r of records) {
    const d = Math.round(r.distanceM);
    if (!bestPerDist.has(d) || bestPerDist.get(d)!.timeSec > r.time)
      bestPerDist.set(d, { distanceM: r.distanceM, timeSec: r.time, date: r.date });
  }
  return [...bestPerDist.values()];
}

function normalizeActivitySport(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("run") || s.includes("trail")) return "Running";
  if (s.includes("ride") || s.includes("cycl")) return "Cycling";
  if (s.includes("nordicski") || s.includes("backcountry")) return "Skiing";
  if (s.includes("rollerski")) return "Roller Skiing";
  if (s.includes("orienteer")) return "Orienteering";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "Strength";
  return t;
}

// ── AUTO path: full metrics update (runs after every sync) ─────────────────
export async function updateVO2maxAndPaces(userId: string) {
  const now = new Date();

  const [profile, activities, garminRecent, existingCache, racePBs] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    loadActivities(userId),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(now, 7) } },
      orderBy: { date: "asc" }, select: { restingHR: true },
    }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    loadRacePBs(userId),
  ]);

  const maxHR  = profile?.maxHeartRate    ?? existingCache?.maxHR    ?? 190;
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? existingCache?.restHR ?? 50;

  // ── ATL / CTL / TSB / ACWR — computed first so TSB can feed into VO2max ──
  const dailyTSS = new Map<string, number>();
  for (const a of activities as Act[]) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
    dailyTSS.set(key, (dailyTSS.get(key) ?? 0) + tss);
  }
  const loadCurve = buildLoadCurve(dailyTSS, subDays(now, 365), now);
  const todayLoad = loadCurve.at(-1) ?? { atl: 0, ctl: 0, tsb: 0, tss: 0, date: "" };
  const acwr = computeACWR(dailyTSS, now);

  // ── VO2max & paces — TSB passed so form-adjusted model runs ────────────
  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
      startDate: a.startDate, totalElevationGain: a.totalElevationGain,
    })),
    maxHR, restHR, racePBs, todayLoad.tsb,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);
  const existingZones = (existingCache?.zones as object | null) ?? buildHRZonesJson(185, 45);

  // ── Weekly volumes (last 16 weeks) ─────────────────────────────────────
  const sixteenWeeksAgo = subDays(now, 112);
  const weeklyVolumeJson: Record<string, Record<string, { km: number; timeSec: number }>> = {};
  for (const a of activities as Act[]) {
    if (a.startDate < sixteenWeeksAgo) continue;
    const weekKey = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const sport = normalizeActivitySport(a.sportType);
    if (!weeklyVolumeJson[weekKey]) weeklyVolumeJson[weekKey] = {};
    if (!weeklyVolumeJson[weekKey][sport]) weeklyVolumeJson[weekKey][sport] = { km: 0, timeSec: 0 };
    weeklyVolumeJson[weekKey][sport].km += a.distance / 1000;
    weeklyVolumeJson[weekKey][sport].timeSec += a.movingTime;
  }
  for (const wk of Object.values(weeklyVolumeJson))
    for (const s of Object.values(wk)) s.km = Math.round(s.km * 10) / 10;

  // ── Zone seconds & polarisation (last 12 weeks) ────────────────────────
  type ZoneMap = { z1: [number,number]; z2: [number,number]; z3: [number,number]; z4: [number,number]; z5: [number,number] };
  const hz = existingZones as ZoneMap;
  const twelveWeeksAgo = subDays(now, 84);
  const zoneSecondsJson = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } as Record<string, number>;
  let polZ1 = 0, polZ2 = 0, polZ3 = 0;
  const lt1hr = hz?.z2?.[1] ?? Math.round(maxHR * 0.78);
  const lt2hr = hz?.z4?.[0] ?? Math.round(maxHR * 0.88);

  for (const a of activities as Act[]) {
    if (a.startDate < twelveWeeksAgo || !a.averageHeartrate) continue;
    const hr = a.averageHeartrate;
    const z = hz
      ? (hr < hz.z1[1] ? 1 : hr < hz.z2[1] ? 2 : hr < hz.z3[1] ? 3 : hr < hz.z4[1] ? 4 : 5)
      : (hr < lt1hr ? 1 : hr < lt2hr ? 3 : 5); // simplified fallback
    zoneSecondsJson[`z${z}`] = (zoneSecondsJson[`z${z}`] ?? 0) + a.movingTime;
    if (hr < lt1hr) polZ1 += a.movingTime;
    else if (hr < lt2hr) polZ2 += a.movingTime;
    else polZ3 += a.movingTime;
  }
  const polTotal = polZ1 + polZ2 + polZ3;
  const polarisationJson = polTotal > 0
    ? { z1Pct: Math.round(polZ1/polTotal*100), z2Pct: Math.round(polZ2/polTotal*100), z3Pct: Math.round(polZ3/polTotal*100) }
    : null;

  // ── Race predictions ───────────────────────────────────────────────────
  const anchorPB = racePBs
    .filter(p => p.timeSec > 60 && p.distanceM >= 1500)
    .reduce<RacePB | null>((best, p) => {
      if (!best) return p;
      return vdotFromRace(p.distanceM, p.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? p : best;
    }, null);
  const predictionsJson = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2maxResult.vdot, meters);
    const riegel = anchorPB ? riegelPredict(anchorPB.timeSec, anchorPB.distanceM, meters) : null;
    const range = predictionRange(peak, meters);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, todayLoad.tsb), riegel, rangeLo: range.lo, rangeHi: range.hi };
  });

  // ── Persist to cache ───────────────────────────────────────────────────
  const sharedFields = {
    vo2max:     vo2maxResult.value,
    vdot:       vo2maxResult.vdot,
    confidence: vo2maxResult.confidence,
    method:     vo2maxResult.method,
    paces:      pacesJson(paceZones),
    atl:        todayLoad.atl,
    ctl:        todayLoad.ctl,
    tsb:        todayLoad.tsb,
    acwr:       acwr ?? undefined,
    weeklyVolumeJson,
    zoneSecondsJson,
    polarisationJson: polarisationJson ?? undefined,
    predictionsJson,
  };

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId, maxHR, restHR,
      thresholdHR: existingCache?.thresholdHR ?? Math.round(maxHR * 0.88),
      zones: existingZones,
      ...sharedFields,
    },
    update: sharedFields,
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
  // Clean observed max: remove artifact spikes before using as filter threshold
  // Raw max(maxHRs) can be 220-230 bpm from optical sensor glitches — totally wrong
  const cleanMaxHRs = maxHRs.filter(h => h <= MAXHR_ARTIFACT_CAP);
  const sortedCleanMaxHRs = [...cleanMaxHRs].sort((a, b) => a - b);
  const observedMax = sortedCleanMaxHRs.length > 0
    ? sortedCleanMaxHRs[Math.floor(sortedCleanMaxHRs.length * 0.90)] // 90th percentile of clean values
    : 185;

  const raceMaxHRs = (activities as Act[])
    .filter(a => a.isRace || /tävl|race|lopp|mila|stafett|sic\b|parkrun/i.test(a.name ?? ""))
    .flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);

  const thresholdHRs = (activities as Act[])
    .filter(a => a.averageHeartrate && a.averageHeartrate > observedMax * 0.82
      && a.sportType.toLowerCase().includes("run"))
    .map(a => a.averageHeartrate!);

  // Statistical maxHR from ALL hard runs (bucket approach):
  // Collect clean maxHR values from all runs where effort was hard (avgHR > 80% of clean observedMax).
  // Use 85th percentile — much more data-rich than single-session interval source.
  const hardRunMaxHRs = (activities as Act[])
    .filter(a => a.maxHeartrate && a.averageHeartrate
      && a.averageHeartrate > observedMax * 0.78   // hard effort (near LT1+)
      && /run|trail/i.test(a.sportType)
      && a.maxHeartrate <= MAXHR_ARTIFACT_CAP)
    .map(a => a.maxHeartrate!);
  const hardRunClean = [...hardRunMaxHRs].sort((a,b)=>a-b);
  const statisticalMax = hardRunClean.length >= 5
    ? hardRunClean[Math.floor(hardRunClean.length * 0.85)]  // 85th pct of clean hard-run maxHRs
    : null;

  const maxHR = profile?.maxHeartRate
    ?? estimateMaxHRFromRaces(raceMaxHRs)
    ?? statisticalMax
    ?? estimateMaxHRFromThreshold(thresholdHRs)
    ?? estimateMaxHR(maxHRs);
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;

  const racePBs = await loadRacePBs(userId);

  // HR-pace regression — GAP-corrected, excludes intervals (whole-session avgPace is
  // diluted by recovery jogs making interval sessions appear "high HR + slow pace",
  // which would flatten the slope and push LT2 estimate down)
  const regressionRuns = (activities as Act[])
    .filter(a => a.averageHeartrate && a.distance >= 3000 && a.movingTime > 0
      && /run|trail/i.test(a.sportType)
      && !/intervall|interval|fartlek|tisdagsbana|bana\b/i.test(a.name ?? ""))
    .map(a => {
      const daysAgo = (Date.now() - new Date(a.startDate).getTime()) / (1000 * 60 * 60 * 24);
      const rawPace = a.movingTime / (a.distance / 1000);
      const gap = gradeAdjustedPace(rawPace, a.totalElevationGain ?? 0, a.distance);
      return {
        avgHR: a.averageHeartrate!,
        avgPaceSecPerKm: gap,
        weight: Math.exp(-daysAgo / 180),
      };
    });
  const regression = buildHRPaceRegressionParams(regressionRuns, maxHR);

  // ── Method 1: Race-PB based LT estimation ─────────────────────────────
  const lt = estimateLTFromRaces(racePBs, maxHR, restHR, regression);
  let hrZones = lt.source === "race-pbs"
    ? buildHRZonesFromLT(lt, maxHR, restHR)
    : buildHRZones(maxHR, restHR);

  // ── Method 2: Statistical zone analysis from bucketed training data ───
  // Uses all running activities, finds LT1/LT2 as deflection points in the
  // HR-pace curve. Applied directly when R² ≥ 0.80 (high confidence).
  const statRuns = (activities as Act[])
    .filter(a => a.averageHeartrate && /run|trail/i.test(a.sportType)
      && a.distance >= 4000 && a.movingTime >= 900)
    .map(a => ({
      avgHR: a.averageHeartrate!,
      distanceM: a.distance,
      movingTimeSec: a.movingTime,
      totalElevationGain: a.totalElevationGain ?? 0,
      startDate: a.startDate,
    }));

  const statResult = estimateZonesFromStatisticalAnalysis(statRuns, maxHR, restHR);

  if (statResult && statResult.rSquared >= 0.80) {
    // High-confidence statistical estimate — use directly (it's based on actual training data)
    hrZones = statResult.zones;
    console.log(`[zones] Statistical analysis applied: LT1=${statResult.lt1HR}bpm LT2=${statResult.lt2HR}bpm R²=${statResult.rSquared} (${statResult.bucketCount} buckets)`);
  } else if (statResult) {
    console.log(`[zones] Statistical analysis insufficient: R²=${statResult.rSquared} (${statResult.bucketCount} buckets) — using race-PB method`);
  }

  const thresholdHR = Math.round((hrZones.z4[0] + hrZones.z4[1]) / 2);
  const zonesJson = { z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3, z4: hrZones.z4, z5: hrZones.z5 };

  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
      startDate: a.startDate, totalElevationGain: a.totalElevationGain,
    })),
    maxHR, restHR, racePBs, undefined,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);

  // Recompute zone distribution with the newly calibrated zones so charts update immediately
  const twelveWeeksAgo = subDays(new Date(), 84);
  type ZoneMap2 = { z1:[number,number]; z2:[number,number]; z3:[number,number]; z4:[number,number]; z5:[number,number] };
  const hz2 = zonesJson as ZoneMap2;
  const zoneSecondsJson = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } as Record<string, number>;
  let polZ1 = 0, polZ2 = 0, polZ3 = 0;
  const lt1hr2 = hz2.z2[1], lt2hr2 = hz2.z4[0];
  for (const a of activities as Act[]) {
    if (a.startDate < twelveWeeksAgo || !a.averageHeartrate) continue;
    const hr = a.averageHeartrate;
    const z = hr < hz2.z1[1] ? 1 : hr < hz2.z2[1] ? 2 : hr < hz2.z3[1] ? 3 : hr < hz2.z4[1] ? 4 : 5;
    zoneSecondsJson[`z${z}`] = (zoneSecondsJson[`z${z}`] ?? 0) + a.movingTime;
    if (hr < lt1hr2) polZ1 += a.movingTime;
    else if (hr < lt2hr2) polZ2 += a.movingTime;
    else polZ3 += a.movingTime;
  }
  const polTotal2 = polZ1 + polZ2 + polZ3;
  const polarisationJson = polTotal2 > 0
    ? { z1Pct: Math.round(polZ1/polTotal2*100), z2Pct: Math.round(polZ2/polTotal2*100), z3Pct: Math.round(polZ3/polTotal2*100) }
    : null;

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId, maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones), zoneSecondsJson, polarisationJson: polarisationJson ?? undefined,
    },
    update: { maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones), zoneSecondsJson, polarisationJson: polarisationJson ?? undefined,
    },
  });

  // Only persist to AthleteProfile if the user hasn't manually set these values.
  // Manually entered values always trump computed estimates.
  await prisma.athleteProfile.upsert({
    where: { userId },
    create: { userId, maxHeartRate: maxHR, restingHeartRate: restHR },
    update: {
      // Only overwrite if profile value was null/unset (i.e., came from estimation, not user input)
      ...(profile?.maxHeartRate    ? {} : { maxHeartRate: maxHR }),
      ...(profile?.restingHeartRate ? {} : { restingHeartRate: restHR }),
    },
  });

  return { maxHR, restHR, thresholdHR, zones: zonesJson, vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot };
}

export async function computeAndCacheFitness(userId: string) {
  return updateHRZones(userId);
}

export async function getFitnessCache(userId: string) {
  return prisma.fitnessCache.findUnique({ where: { userId } });
}

function buildHRZonesJson(maxHR: number, restHR: number) {
  const z = buildHRZones(maxHR, restHR);
  return { z1: z.z1, z2: z.z2, z3: z.z3, z4: z.z4, z5: z.z5 };
}

function pacesJson(p: ReturnType<typeof buildPaceZones>) {
  return { easy: p.easy, marathon: p.marathon, threshold: p.threshold, interval: p.interval, repetition: p.repetition };
}
