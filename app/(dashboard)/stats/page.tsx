import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { StatsClient } from "./stats-client";
import { StatsErrorBoundary } from "./stats-error-boundary";
import { buildHRZones, buildPaceZones, buildPaceZonesFromLT, estimateLTFromRaces, estimateMaxHR, estimateMaxHRFromThreshold, estimateMaxHRFromRaces, ltBoundaries, estimateZonesFromStatisticalAnalysis, type HRZones } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve, computeACWR } from "@/lib/fitness/training-load";
import { estimateVO2max, predictRaceTime, tsbAdjustedRaceTime, riegelPredict, predictionRange, vdotFromRace } from "@/lib/fitness/vo2max";
import { RACE_DISTANCES } from "@/lib/fitness/paces";
import { estimateCriticalSpeed } from "@/lib/fitness/critical-speed";
import { subDays, format, startOfWeek, startOfYear } from "date-fns";

type A = {
  id: string; sportType: string; startDate: Date; name: string;
  distance: number; movingTime: number; totalElevationGain: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; weatherTemp: number | null;
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — cache valid if sync runs hourly

export default async function StatsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const now = new Date();

  // ── Always fetch ────────────────────────────────────────────────────────
  const [profile, fitnessCache, garminRecent, allRacePBs, weatherActs] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(now, 30) } },
      orderBy: { date: "asc" },
    }),
    prisma.raceRecord.findMany({
      where: { userId, date: { gte: subDays(now, 5 * 365) } },
      select: { distanceM: true, time: true, date: true },
      orderBy: { time: "asc" },
    }),
    // Weather profile: all running activities with weather data (no date limit)
    prisma.activity.findMany({
      where: {
        userId,
        sportType: { contains: "run", mode: "insensitive" },
        weatherTemp: { not: null },
        averageSpeed: { not: null },
        distance: { gte: 3000 },  // min 3 km — short efforts are too noisy
        isRace: false,             // exclude races (paced differently)
      },
      select: { averageSpeed: true, weatherTemp: true, weatherWind: true, startDate: true, name: true, sportType: true, averageHeartrate: true },
    }),
  ]);
  const weatherStats = computeWeatherStats(weatherActs as WeatherAct[]);

  const bestPerDist = new Map<number, { distanceM: number; timeSec: number; date: Date }>();
  for (const r of allRacePBs) {
    const d = Math.round(r.distanceM);
    if (!bestPerDist.has(d) || bestPerDist.get(d)!.timeSec > r.time)
      bestPerDist.set(d, { distanceM: r.distanceM, timeSec: r.time, date: r.date });
  }
  const racePBs = [...bestPerDist.values()];

  // Compute CS live from racePBs so it shows immediately without waiting for a sync.
  // The cache value wins if present; fallback to live calculation.
  const liveCsResult = estimateCriticalSpeed([], racePBs);
  const liveCriticalSpeedMs = fitnessCache?.criticalSpeedMs ?? liveCsResult?.csMetersPerSec ?? null;
  // rSquared === 0 means empirical HM/marathon estimate (no regression possible)
  const liveCsRSq = fitnessCache?.criticalSpeedMs != null ? null : (liveCsResult?.rSquared ?? null);

  // ── Overview: always-fresh aggregates (fast queries, no activity rows needed) ──
  const weekStart  = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart  = startOfYear(now);
  const lyWeekStart  = subDays(weekStart, 364);
  const lyMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lyYtdStart   = startOfYear(new Date(now.getFullYear() - 1, 0, 1));
  const lyWeekEnd    = new Date(lyWeekStart.getTime() + (now.getTime() - weekStart.getTime()));
  const lyMonthEnd   = new Date(lyMonthStart.getTime() + (now.getTime() - monthStart.getTime()));
  const lyYtdEnd     = new Date(lyYtdStart.getTime() + (now.getTime() - yearStart.getTime()));

  const RUN_TYPES = { in: ["Run", "TrailRun", "VirtualRun"] };
  const agg = (gte: Date, lte?: Date, runOnly = false) => prisma.activity.aggregate({
    where: {
      userId,
      startDate: { gte, ...(lte ? { lte } : {}) },
      ...(runOnly ? { sportType: RUN_TYPES } : {}),
    },
    _sum: { distance: true, movingTime: true }, _count: true,
  });

  const [
    wkAgg, moAgg, ytdAgg, lyWkAgg, lyMoAgg, lyYtdAgg,
    runWkAgg, runMoAgg, runYtdAgg, runLyWkAgg, runLyMoAgg, runLyYtdAgg,
    totalCount,
  ] = await Promise.all([
    agg(weekStart), agg(monthStart), agg(yearStart),
    agg(lyWeekStart, lyWeekEnd), agg(lyMonthStart, lyMonthEnd), agg(lyYtdStart, lyYtdEnd),
    agg(weekStart, undefined, true), agg(monthStart, undefined, true), agg(yearStart, undefined, true),
    agg(lyWeekStart, lyWeekEnd, true), agg(lyMonthStart, lyMonthEnd, true), agg(lyYtdStart, lyYtdEnd, true),
    prisma.activity.count({ where: { userId } }),
  ]);

  const toSum = (a: typeof wkAgg) => ({
    km: Math.round((a._sum.distance ?? 0) / 1000 * 10) / 10,
    timeSec: a._sum.movingTime ?? 0,
    count: a._count,
  });

  const overview = {
    thisWeek: toSum(wkAgg), thisMonth: toSum(moAgg), ytd: toSum(ytdAgg),
    lyWeek: toSum(lyWkAgg), lyMonth: toSum(lyMoAgg), lyYtd: toSum(lyYtdAgg),
  };
  const overviewRun = {
    thisWeek: toSum(runWkAgg), thisMonth: toSum(runMoAgg), ytd: toSum(runYtdAgg),
    lyWeek: toSum(runLyWkAgg), lyMonth: toSum(runLyMoAgg), lyYtd: toSum(runLyYtdAgg),
  };

  // ── Check if we can use FitnessCache for expensive computations ─────────
  const cacheAge = fitnessCache?.computedAt
    ? now.getTime() - new Date(fitnessCache.computedAt).getTime()
    : Infinity;
  const cacheReady = cacheAge < CACHE_TTL_MS && !!fitnessCache?.weeklyVolumeJson && !!fitnessCache?.extraVizJson;

  // ── HR zones — prefer calibrated zones from cache, fall back to default formula ──
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;
  const maxHR = profile?.maxHeartRate ?? fitnessCache?.maxHR ?? 190;
  const hrZones: HRZones = fitnessCache?.zones
    ? { ...(fitnessCache.zones as HRZones), maxHR, restHR }  // use calibrated zones
    : buildHRZones(maxHR, restHR);  // fallback: default formula

  if (cacheReady && fitnessCache) {
    // ── FAST PATH: read everything from cache ─────────────────────────────
    const weeklyVolumes = (fitnessCache.weeklyVolumeJson ?? {}) as Record<string, Record<string, { km: number; timeSec: number }>>;
    const zoneSeconds   = (fitnessCache.zoneSecondsJson ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }) as Record<string, number>;
    const polarisation  = (fitnessCache.polarisationJson ?? null) as { z1Pct: number; z2Pct: number; z3Pct: number } | null;
    const predictions   = (fitnessCache.predictionsJson ?? []) as { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number }[];
    const todayLoad = {
      atl: fitnessCache.atl ?? 0, ctl: fitnessCache.ctl ?? 0, tsb: fitnessCache.tsb ?? 0,
      tss: 0, date: format(now, "yyyy-MM-dd"),
    };
    const vo2max = {
      value: fitnessCache.vo2max, vdot: fitnessCache.vdot,
      confidence: fitnessCache.confidence as "high" | "medium" | "low",
      method: fitnessCache.method,
    };
    const paceZones = buildPaceZones(fitnessCache.vdot);
    const ltFast = estimateLTFromRaces(racePBs, maxHR, restHR);
    const effectivePaceZones = ltFast.source === "race-pbs" && ltFast.lt1PaceSecPerKm > 0 && ltFast.lt2PaceSecPerKm > 0
      ? buildPaceZonesFromLT(ltFast.lt1PaceSecPerKm, ltFast.lt2PaceSecPerKm)
      : paceZones;
    const acwr = fitnessCache.acwr ?? null;
    const extraViz = (fitnessCache.extraVizJson ?? null) as {
      heatmapData: { week: string; km: number }[];
      monthlyOverlay: { month: string; year: number; km: number }[];
      intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number }[];
      vdotTrend: { month: string; vdot: number }[];
      hrZoneHistory: { month: string; lt1HR: number; lt2HR: number; maxHR: number }[];
      terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
      perfByDistYear: { distance: string; period: string; time: number }[];
    } | null;
    const fastStatZones     = (fitnessCache.statZonesJson     ?? null) as import("@/lib/fitness/zones").StatisticalZoneResult | null;
    const fastStatZonesLaps = (fitnessCache.statZonesLapsJson ?? null) as import("@/lib/fitness/zones").StatisticalZoneResult | null;

    // Build sparklines from cached weekly volumes
    const sparklines = Array.from({ length: 8 }, (_, i) => {
      const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
      const key = format(wkStart, "yyyy-MM-dd");
      return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
    });

    // Fetch last 2 years for load curve; zone/pace/analytics calculations filter internally to 12 weeks
    const recentForCurve = await prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(now, 730) } },
      select: { movingTime: true, averageHeartrate: true, startDate: true, sportType: true, averageSpeed: true,
        distance: true, totalElevationGain: true, isRace: true },
      orderBy: { startDate: "asc" },
    });
    const curveTSSMap = new Map<string, number>();
    for (const a of recentForCurve) {
      const key = format(a.startDate, "yyyy-MM-dd");
      const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
      curveTSSMap.set(key, (curveTSSMap.get(key) ?? 0) + tss);
    }
    const fullCurve = buildLoadCurve(curveTSSMap, subDays(now, 730), now);
    const loadCurve = fullCurve;

    // Recompute zone seconds from calibrated zones (don't trust cached value — may use old zones)
    const fastZoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    const fastLt1 = hrZones.z3[0], fastLt2 = hrZones.z4[0];
    let fpZ1 = 0, fpZ2 = 0, fpZ3 = 0;
    const twelveWeeksAgoFast = subDays(now, 84);
    for (const a of recentForCurve) {
      if (!a.averageHeartrate || a.startDate < twelveWeeksAgoFast) continue;
      const hr = a.averageHeartrate;
      const z = hr < hrZones.z1[1] ? 1 : hr < hrZones.z2[1] ? 2 : hr < hrZones.z3[1] ? 3 : hr < hrZones.z4[1] ? 4 : 5;
      fastZoneSeconds[`z${z}`] += a.movingTime;
      if (hr < fastLt1) fpZ1 += a.movingTime; else if (hr < fastLt2) fpZ2 += a.movingTime; else fpZ3 += a.movingTime;
    }
    const fpTotal = fpZ1 + fpZ2 + fpZ3;
    const fastPolarisation = fpTotal > 0
      ? { z1Pct: Math.round(fpZ1/fpTotal*100), z2Pct: Math.round(fpZ2/fpTotal*100), z3Pct: Math.round(fpZ3/fpTotal*100) }
      : null;

    // Pace zone seconds from calibrated pace zones (index [1] = fast boundary of each zone)
    const fastPaceZoneSeconds: Record<string, number> = { easy: 0, marathon: 0, threshold: 0, interval: 0, repetition: 0 };
    for (const a of recentForCurve) {
      if (!a.averageSpeed || a.startDate < twelveWeeksAgoFast || !/run|trail/i.test(a.sportType ?? "")) continue;
      const pace = 1000 / a.averageSpeed;
      if (pace >= effectivePaceZones.easy[1])           fastPaceZoneSeconds.easy      += a.movingTime;
      else if (pace >= effectivePaceZones.marathon[1])  fastPaceZoneSeconds.marathon   += a.movingTime;
      else if (pace >= effectivePaceZones.threshold[1]) fastPaceZoneSeconds.threshold  += a.movingTime;
      else if (pace >= effectivePaceZones.interval[1])  fastPaceZoneSeconds.interval   += a.movingTime;
      else                                              fastPaceZoneSeconds.repetition += a.movingTime;
    }

    // Per-model predictions from the cached VO2max breakdown
    const cachedBreakdown = (fitnessCache.vo2maxBreakdownJson ?? {}) as Record<string, number>;
    const fastModelVdots: Record<string, number> = {
      "Weighted (default)": vo2max.vdot,
      ...Object.fromEntries(
        Object.entries(cachedBreakdown)
          .filter(([, v]) => v > 30 && v < 90)
          .map(([name, v]) => [name, Math.round(v * 10) / 10])
      ),
    };
    const fastModelPredictions = Object.fromEntries(
      Object.entries(fastModelVdots).map(([model, vdot]) => [
        model,
        RACE_DISTANCES.map(({ label, meters }) => ({ label, meters, peak: predictRaceTime(vdot, meters) })),
      ])
    );

    // Volume-Adjusted Riegel (Alex Gascón model)
    const varAnchorFast = racePBs.reduce<{ timeSec: number; distanceM: number; date: Date } | null>((best, p) => {
      if (!best) return p;
      return vdotFromRace(p.distanceM, p.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? p : best;
    }, null);
    const avgWeeklyRunKmFast = Array.from({ length: 8 }, (_, i) => {
      const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
      const key = format(wkStart, "yyyy-MM-dd");
      return (weeklyVolumes[key]?.["Running"] ?? { km: 0 }).km;
    }).reduce((s, v) => s + v, 0) / 8;
    const varDFast = Math.max(1.05, Math.min(1.18, 1.18 - 0.0015 * avgWeeklyRunKmFast));
    if (varAnchorFast) {
      fastModelVdots["Volume-Adjusted Riegel"] = varDFast;
      fastModelPredictions["Volume-Adjusted Riegel"] = RACE_DISTANCES.map(({ label, meters }) => ({
        label, meters, peak: riegelPredict(varAnchorFast.timeSec, varAnchorFast.distanceM, meters, varDFast),
      }));
    }

    // Compute analytics from recentForCurve (24-week data already fetched)
    const fpLt1HR = hrZones.z3[0];
    const fpAeiWeekMap = new Map<string, { sum: number; n: number }>();
    const fpReWeekMap  = new Map<string, { sum: number; n: number }>();
    const fpPct75HR    = Math.round(maxHR * 0.75);
    let fpStreak = 0;
    type CurveAct = { movingTime: number; averageHeartrate: number | null; startDate: Date; sportType: string | null; averageSpeed: number | null };
    const fpDays = new Set((recentForCurve as CurveAct[]).map(a => format(a.startDate, "yyyy-MM-dd")));
    for (let i = 0; i < 365; i++) {
      if (fpDays.has(format(subDays(now, i), "yyyy-MM-dd"))) fpStreak++;
      else break;
    }
    for (const a of recentForCurve as CurveAct[]) {
      if (!a.averageHeartrate || !a.averageSpeed || !/run|trail/i.test(a.sportType ?? "")) continue;
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      if (a.averageHeartrate < fpLt1HR && a.movingTime >= 900) {
        const aei = (a.averageSpeed * 60) / a.averageHeartrate;
        if (!fpAeiWeekMap.has(wk)) fpAeiWeekMap.set(wk, { sum: 0, n: 0 });
        const e = fpAeiWeekMap.get(wk)!; e.sum += aei; e.n++;
      }
      if (Math.abs(a.averageHeartrate - fpPct75HR) < 5 && a.movingTime >= 900) {
        const pace = 1000 / a.averageSpeed;
        if (!fpReWeekMap.has(wk)) fpReWeekMap.set(wk, { sum: 0, n: 0 });
        const e = fpReWeekMap.get(wk)!; e.sum += pace; e.n++;
      }
    }
    const fpAeiByWeek = [...fpAeiWeekMap.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-16)
      .map(([week,{sum,n}])=>({ week, aei: Math.round(sum/n*100)/100 }));
    const fpReByWeek  = [...fpReWeekMap.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-12)
      .map(([week,{sum,n}])=>({ week, paceSecPerKm: Math.round(sum/n) }));

    const last7d   = format(subDays(now,7), "yyyy-MM-dd");
    const prev14d  = format(subDays(now,14), "yyyy-MM-dd");
    const fp7tss   = [...curveTSSMap.entries()].filter(([d])=>d>=last7d).reduce((s,[,v])=>s+v,0);
    const fpPrev7  = [...curveTSSMap.entries()].filter(([d])=>d>=prev14d&&d<last7d).reduce((s,[,v])=>s+v,0);
    const fpRamp   = fpPrev7 > 0 ? Math.round(((fp7tss-fpPrev7)/fpPrev7)*100) : null;
    const fpInjury = acwr !== null ? Math.min(100, (acwr>1.5?50:acwr>1.3?30:0) + (fpRamp!==null&&fpRamp>20?50:fpRamp!==null&&fpRamp>10?30:0)) : null;

    const fastAnalytics = {
      aeiByWeek: fpAeiByWeek,
      reByWeek: fpReByWeek,
      rampRate: fpRamp,
      injuryRisk: fpInjury,
      activeStreak: fpStreak,
      tempSensitivity: null,
    };

    const fpEasyPaceTrend = computeEasyPaceTrend(recentForCurve as EasyPaceAct[], hrZones.z3[0]);

    return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
      fastZoneSeconds, hrZones, vo2max, effectivePaceZones, predictions, fastPolarisation, acwr,
      fastStatZones, overviewRun, fastAnalytics, fastPaceZoneSeconds, fastModelPredictions, fastModelVdots, extraViz,
      fitnessCache.decouplingLt1HR ?? null, liveCriticalSpeedMs, liveCsRSq,
      profile?.maxHeartRate ?? null, profile?.restingHeartRate ?? null, weatherStats,
      fpEasyPaceTrend, fastStatZonesLaps);
  }

  // ── SLOW PATH: full computation (cache miss or stale) ───────────────────
  // Skip bestEfforts + splitsMetric — large JSON not needed for stats aggregations
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(now, 10 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      id: true, sportType: true, startDate: true, name: true,
      distance: true, movingTime: true, totalElevationGain: true,
      averageHeartrate: true, maxHeartrate: true,
      averageSpeed: true, isRace: true, weatherTemp: true, laps: true,
      // bestEfforts + splitsMetric intentionally omitted — saves 2-5x query time
    },
  });

  const maxHRs = (activities as A[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const raceMaxHRs = (activities as A[])
    .filter(a => a.isRace || /tävl|race|lopp|mila|stafett|sic\b|parkrun/i.test(a.name))
    .flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const observedMax = maxHRs.length > 0 ? Math.max(...maxHRs) : 200;
  const thresholdHRs = (activities as A[])
    .filter(a => a.averageHeartrate && a.averageHeartrate > observedMax * 0.82 && a.sportType.toLowerCase().includes("run"))
    .map(a => a.averageHeartrate!);
  // Priority: user-manual (profile) > calibration result (cache) > estimate from data
  const computedMaxHR = profile?.maxHeartRate
    ?? fitnessCache?.maxHR          // result of last "Estimera zoner" button press
    ?? estimateMaxHRFromRaces(raceMaxHRs)
    ?? estimateMaxHRFromThreshold(thresholdHRs)
    ?? estimateMaxHR(maxHRs);
  // Use calibrated zones from FitnessCache if available (from "Estimera zoner" button)
  // Fall back to default formula only if no calibration has been done
  const computedHrZones: HRZones = fitnessCache?.zones
    ? { ...(fitnessCache.zones as HRZones), maxHR: computedMaxHR, restHR }
    : buildHRZones(computedMaxHR, restHR);

  const slowEightWeeksAgo = subDays(now, 56);
  const slowWkRunKm = new Map<string, number>();
  for (const a of activities as A[]) {
    if (!/run|trail/i.test(a.sportType) || a.startDate < slowEightWeeksAgo) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    slowWkRunKm.set(wk, (slowWkRunKm.get(wk) ?? 0) + a.distance / 1000);
  }
  const slowAvgWeeklyRunKm = [...slowWkRunKm.values()].reduce((s, v) => s + v, 0) / 8;

  const vo2max = estimateVO2max(
    activities.map((a: A) => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, startDate: a.startDate,
    })),
    computedMaxHR, restHR, racePBs, undefined, slowAvgWeeklyRunKm,
  );
  const paceZones = buildPaceZones(vo2max.vdot);
  const ltSlow = estimateLTFromRaces(racePBs, computedMaxHR, restHR);
  const effectivePaceZones = ltSlow.source === "race-pbs" && ltSlow.lt1PaceSecPerKm > 0 && ltSlow.lt2PaceSecPerKm > 0
    ? buildPaceZonesFromLT(ltSlow.lt1PaceSecPerKm, ltSlow.lt2PaceSecPerKm)
    : paceZones;

  const dailyTSSMap = new Map<string, number>();
  for (const a of activities) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR: computedMaxHR, restHR });
    dailyTSSMap.set(key, (dailyTSSMap.get(key) ?? 0) + tss);
  }
  const fullCurve = buildLoadCurve(dailyTSSMap, subDays(now, 730), now);
  const loadCurve = fullCurve;
  const todayLoad = fullCurve.at(-1) ?? { atl: 0, ctl: 0, tsb: 0, tss: 0, date: "" };

  const weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>> = {};
  const twelveWeeksAgo = subDays(now, 84);
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo)) {
    const weekKey = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const sport = normalizeSport(a.sportType);
    if (!weeklyVolumes[weekKey]) weeklyVolumes[weekKey] = {};
    if (!weeklyVolumes[weekKey][sport]) weeklyVolumes[weekKey][sport] = { km: 0, timeSec: 0 };
    weeklyVolumes[weekKey][sport].km += a.distance / 1000;
    weeklyVolumes[weekKey][sport].timeSec += a.movingTime;
  }
  for (const wk of Object.values(weeklyVolumes))
    for (const s of Object.values(wk)) s.km = Math.round(s.km * 10) / 10;

  const zoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo && x.averageHeartrate)) {
    const hr = a.averageHeartrate!;
    const z = hr < computedHrZones.z1[1] ? 1 : hr < computedHrZones.z2[1] ? 2 : hr < computedHrZones.z3[1] ? 3 : hr < computedHrZones.z4[1] ? 4 : 5;
    zoneSeconds[`z${z}`] += a.movingTime;
  }

  // Pace zone seconds (last 12 weeks, running only)
  // Zones are [slow_boundary, fast_boundary] (higher sec/km = slower pace).
  // A run belongs to a zone when its pace >= that zone's fast boundary (index [1]).
  const paceZoneSeconds: Record<string, number> = { easy: 0, marathon: 0, threshold: 0, interval: 0, repetition: 0 };
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo && x.averageSpeed && /run|trail/i.test(x.sportType))) {
    const pace = 1000 / a.averageSpeed!;
    if (pace >= effectivePaceZones.easy[1])           paceZoneSeconds.easy      += a.movingTime;
    else if (pace >= effectivePaceZones.marathon[1])  paceZoneSeconds.marathon   += a.movingTime;
    else if (pace >= effectivePaceZones.threshold[1]) paceZoneSeconds.threshold  += a.movingTime;
    else if (pace >= effectivePaceZones.interval[1])  paceZoneSeconds.interval   += a.movingTime;
    else                                              paceZoneSeconds.repetition += a.movingTime;
  }

  const sparklines = Array.from({ length: 8 }, (_, i) => {
    const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
    const key = format(wkStart, "yyyy-MM-dd");
    return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
  });

  // Distance-specific anchor PB for Riegel predictions:
  // Use closest PB to each target distance — avoids marathon being extrapolated
  // from a 3K PB (which overestimates endurance) or 3K from a marathon (overestimates speed).
  // Riegel exponent varies by distance ratio: larger extrapolations get larger exponent.
  function bestAnchorFor(targetM: number): { timeSec: number; distanceM: number } | null {
    const usable = racePBs.filter(p => p.timeSec > 60 && p.distanceM >= 800);
    if (usable.length === 0) return null;
    // For distances ≤ 5K: prefer PBs ≤ 5K (speed-specific)
    // For distances > 5K: prefer PBs ≥ 5K (endurance-specific)
    const preferred = targetM <= 5000
      ? usable.filter(p => p.distanceM <= 10000)
      : usable.filter(p => p.distanceM >= 5000);
    const pool = preferred.length > 0 ? preferred : usable;
    // Pick the PB closest in distance to target (log scale)
    return pool.reduce((best, p) =>
      Math.abs(Math.log(p.distanceM / targetM)) < Math.abs(Math.log(best.distanceM / targetM)) ? p : best
    );
  }

  // Riegel exponent: longer extrapolations need higher exponent (more fatigue penalty)
  function riegelExponent(fromM: number, toM: number): number {
    const ratio = Math.max(fromM, toM) / Math.min(fromM, toM);
    if (toM >= 42000) return 1.08;   // marathon: extra fatigue/nutrition penalty
    if (ratio > 5)    return 1.07;   // large extrapolation
    return 1.06;                      // standard
  }

  const predictions = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2max.vdot, meters);
    const anchor = bestAnchorFor(meters);
    const riegel = anchor
      ? riegelPredict(anchor.timeSec, anchor.distanceM, meters, riegelExponent(anchor.distanceM, meters))
      : null;
    const range = predictionRange(peak, meters);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, todayLoad.tsb), riegel, rangeLo: range.lo, rangeHi: range.hi };
  });

  // Per-model predictions — lets user see output of each individual model
  const modelVdots: Record<string, number> = {
    "Weighted (default)": vo2max.vdot,
    ...Object.fromEntries(
      Object.entries(vo2max.breakdown ?? {})
        .filter(([, v]) => v > 30 && v < 90)
        .map(([name, v]) => [name, Math.round(v * 10) / 10])
    ),
  };
  const modelPredictions = Object.fromEntries(
    Object.entries(modelVdots).map(([model, vdot]) => [
      model,
      RACE_DISTANCES.map(({ label, meters }) => ({
        label, meters,
        peak: predictRaceTime(vdot, meters),
      })),
    ])
  );

  // Volume-Adjusted Riegel (Alex Gascón model)
  const varAnchor = racePBs.reduce<{ timeSec: number; distanceM: number; date: Date } | null>((best, p) => {
    if (!best) return p;
    return vdotFromRace(p.distanceM, p.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? p : best;
  }, null);
  const eightWeeksAgo = subDays(now, 56);
  const weeklyRunKmMap = new Map<string, number>();
  for (const a of activities as A[]) {
    if (!/run|trail/i.test(a.sportType) || a.startDate < eightWeeksAgo) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    weeklyRunKmMap.set(wk, (weeklyRunKmMap.get(wk) ?? 0) + a.distance / 1000);
  }
  const avgWeeklyRunKm = [...weeklyRunKmMap.values()].reduce((s, v) => s + v, 0) / 8;
  const varD = Math.max(1.05, Math.min(1.18, 1.18 - 0.0015 * avgWeeklyRunKm));
  if (varAnchor) {
    modelVdots["Volume-Adjusted Riegel"] = varD;
    modelPredictions["Volume-Adjusted Riegel"] = RACE_DISTANCES.map(({ label, meters }) => ({
      label, meters, peak: riegelPredict(varAnchor.timeSec, varAnchor.distanceM, meters, varD),
    }));
  }

  const lt = ltBoundaries(computedHrZones);
  let polZ1 = 0, polZ2 = 0, polZ3 = 0;
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo && x.averageHeartrate)) {
    const hr = a.averageHeartrate!;
    if (hr < lt.lt1) polZ1 += a.movingTime;
    else if (hr < lt.lt2) polZ2 += a.movingTime;
    else polZ3 += a.movingTime;
  }
  const polTotal = polZ1 + polZ2 + polZ3;
  const polarisation = polTotal > 0 ? {
    z1Pct: Math.round(polZ1/polTotal*100), z2Pct: Math.round(polZ2/polTotal*100), z3Pct: Math.round(polZ3/polTotal*100),
  } : null;
  const acwr = computeACWR(dailyTSSMap, now);

  // ── ANALYTICS PLAN 1A-1E ─────────────────────────────────────────────

  const lt1HR = computedHrZones.z3[0]; // LT1 = bottom of Z3
  const pct75HR = Math.round(computedMaxHR * 0.75);

  // AEI (Aerobic Efficiency Index): avgSpeed (m/min) ÷ avgHR — easy runs below LT1, by week
  const aeiByWeek: { week: string; aei: number }[] = [];
  {
    const wm = new Map<string, { sum: number; n: number }>();
    for (const a of activities as A[]) {
      if (!a.averageHeartrate || !a.averageSpeed) continue;
      if (!a.sportType.toLowerCase().includes("run")) continue;
      if (a.averageHeartrate >= lt1HR || a.distance < 4000 || a.movingTime < 900) continue;
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const aei = (a.averageSpeed * 60) / a.averageHeartrate;
      if (!wm.has(wk)) wm.set(wk, { sum: 0, n: 0 });
      const e = wm.get(wk)!; e.sum += aei; e.n++;
    }
    for (const [wk, { sum, n }] of [...wm.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-16)) {
      aeiByWeek.push({ week: wk, aei: Math.round(sum / n * 100) / 100 });
    }
  }

  // Running Economy proxy: avg pace (sec/km) at ≈75% maxHR ± 3 bpm, by 6-week windows
  const reByWeek: { week: string; paceSecPerKm: number }[] = [];
  {
    const wm = new Map<string, { sum: number; n: number }>();
    for (const a of activities as A[]) {
      if (!a.averageHeartrate || !a.averageSpeed) continue;
      if (!a.sportType.toLowerCase().includes("run")) continue;
      if (Math.abs(a.averageHeartrate - pct75HR) >= 5) continue; // strict ±5 bpm window around 75% HRmax
      if (a.distance < 4000 || a.movingTime < 900) continue;
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const pace = 1000 / a.averageSpeed;
      if (!wm.has(wk)) wm.set(wk, { sum: 0, n: 0 });
      const e = wm.get(wk)!; e.sum += pace; e.n++;
    }
    for (const [wk, { sum, n }] of [...wm.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)) {
      reByWeek.push({ week: wk, paceSecPerKm: Math.round(sum / n) });
    }
  }

  // Ramp rate: % change in 7-day TSS vs prior 7 days
  const last7dStr  = format(subDays(now, 7), "yyyy-MM-dd");
  const prev14dStr = format(subDays(now, 14), "yyyy-MM-dd");
  const last7dTSS  = [...dailyTSSMap.entries()].filter(([d]) => d >= last7dStr).reduce((s, [, v]) => s + v, 0);
  const prev7dTSS  = [...dailyTSSMap.entries()].filter(([d]) => d >= prev14dStr && d < last7dStr).reduce((s, [, v]) => s + v, 0);
  const rampRate   = prev7dTSS > 0 ? Math.round(((last7dTSS - prev7dTSS) / prev7dTSS) * 100) : null;

  // Injury risk score (0–100): ACWR × 50 + ramp rate × 30 + (no data for HRV from here)
  let injuryRisk: number | null = null;
  if (acwr !== null) {
    const acwrRisk = acwr > 1.5 ? 50 : acwr > 1.3 ? 30 : acwr < 0.8 ? 10 : 0;
    const rampRisk = rampRate !== null && rampRate > 20 ? 50 : rampRate !== null && rampRate > 10 ? 30 : 0;
    injuryRisk = Math.min(100, acwrRisk + rampRisk);
  }

  // Temperature sensitivity: regression of weatherTemp → pace (sec/km) for runs with weather data
  let tempSensitivity: number | null = null; // sec/km per 5°C above 15°C baseline
  {
    const pts = (activities as A[]).filter(a =>
      a.averageSpeed && a.averageSpeed > 0 && /run|trail/i.test(a.sportType) &&
      a.distance >= 4000 && a.averageHeartrate && a.averageHeartrate < lt1HR
    );
    if (pts.length >= 10) {
      const meanTemp = pts.reduce((s, a) => s + (a.weatherTemp ?? 15), 0) / pts.length;
      const meanPace = pts.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / pts.length;
      let num = 0, den = 0;
      for (const a of pts) {
        const dt = (a.weatherTemp ?? 15) - meanTemp;
        const dp = (1000 / a.averageSpeed!) - meanPace;
        num += dt * dp; den += dt * dt;
      }
      if (den > 0.01) {
        const slope = num / den; // sec/km per °C
        tempSensitivity = Math.round(slope * 5 * 10) / 10; // per 5°C
      }
    }
  }

  // Active streak: consecutive days with ≥1 activity up to today
  let activeStreak = 0;
  {
    const days = new Set((activities as A[]).map(a => format(a.startDate, "yyyy-MM-dd")));
    for (let i = 0; i < 365; i++) {
      if (days.has(format(subDays(now, i), "yyyy-MM-dd"))) activeStreak++;
      else break;
    }
  }

  // ── NEW VISUALIZATIONS ────────────────────────────────────────────────

  // Activity heatmap: weekly km for last 3 years (§3A)
  const heatmapData: { week: string; km: number }[] = [];
  {
    const wm = new Map<string, number>();
    for (const a of activities as A[]) {
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      wm.set(wk, (wm.get(wk) ?? 0) + a.distance / 1000);
    }
    const threeYearsAgo = subDays(now, 3 * 365);
    for (const [week, km] of wm) {
      if (new Date(week) >= threeYearsAgo) {
        heatmapData.push({ week, km: Math.round(km * 10) / 10 });
      }
    }
    heatmapData.sort((a, b) => a.week.localeCompare(b.week));
  }

  // 3-year monthly volume overlay (§2A)
  const monthlyOverlay: { month: string; year: number; km: number }[] = [];
  {
    const mm = new Map<string, number>();
    for (const a of activities as A[]) {
      const key = `${a.startDate.getFullYear()}-${format(a.startDate, "MM")}`;
      mm.set(key, (mm.get(key) ?? 0) + a.distance / 1000);
    }
    const yr = now.getFullYear();
    for (let y = yr - 2; y <= yr; y++) {
      for (let m = 1; m <= 12; m++) {
        const mo = String(m).padStart(2, "0");
        const km = mm.get(`${y}-${mo}`) ?? 0;
        monthlyOverlay.push({ month: mo, year: y, km: Math.round(km) });
      }
    }
  }

  // Monthly intensity profile: % easy/tempo/hard by month (§2B)
  const intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number }[] = [];
  {
    const lt1 = computedHrZones.z3[0], lt2 = computedHrZones.z4[0];
    const mm = new Map<string, { easy: number; tempo: number; hard: number }>();
    for (const a of activities as A[]) {
      if (!a.averageHeartrate || a.distance < 2000) continue;
      const key = format(a.startDate, "yyyy-MM");
      if (!mm.has(key)) mm.set(key, { easy: 0, tempo: 0, hard: 0 });
      const e = mm.get(key)!;
      const min = a.movingTime / 60;
      if (a.averageHeartrate < lt1) e.easy += min;
      else if (a.averageHeartrate < lt2) e.tempo += min;
      else e.hard += min;
    }
    for (const [month, d] of [...mm.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-24)) {
      intensityProfile.push({ month, easyMin: Math.round(d.easy), tempoMin: Math.round(d.tempo), hardMin: Math.round(d.hard) });
    }
  }

  // VDOT trend per month: best vdot estimate per 3-month rolling window (§1D)
  const vdotTrend: { month: string; vdot: number }[] = [];
  {
    for (let i = 0; i < 30; i++) {
      const windowEnd = subDays(now, i * 30);
      const windowStart = subDays(windowEnd, 90);
      const windowActs = (activities as A[]).filter(a => a.startDate >= windowStart && a.startDate <= windowEnd);
      if (windowActs.length < 5) continue;
      const v = estimateVO2max(
        windowActs.map(a => ({
          distanceM: a.distance, timeSec: a.movingTime,
          avgHR: a.averageHeartrate, isRace: a.isRace,
          sportType: a.sportType, name: a.name, startDate: a.startDate,
        })),
        computedMaxHR, restHR,
      );
      const month = format(windowEnd, "yyyy-MM");
      if (!vdotTrend.find(x => x.month === month))
        vdotTrend.push({ month, vdot: Math.round(v.vdot * 10) / 10 });
    }
    vdotTrend.sort((a, b) => a.month.localeCompare(b.month));
  }

  // OL terrain factor vs road running (§7A/7B)
  const terrainFactor = (() => {
    const lt1 = computedHrZones.z3[0], lt2 = computedHrZones.z4[0];
    const olRuns = (activities as A[]).filter(a =>
      /orienteer|ol\b|ol-|olpass/i.test(a.sportType) ||
      /\bol\b|\borienteringsl|\bskogsl/i.test(a.name ?? "")
    );
    const roadRuns = (activities as A[]).filter(a =>
      /run|trail/i.test(a.sportType) && a.averageSpeed && a.averageHeartrate &&
      a.averageHeartrate > lt1 * 0.9 && a.averageHeartrate < lt2 &&
      !/orienteer|ol\b/i.test(a.sportType) && !/\bol\b/i.test(a.name ?? "")
    );
    const avgOLPace = olRuns.length >= 5 && olRuns.filter(a=>a.averageSpeed).length >= 5
      ? olRuns.filter(a=>a.averageSpeed).reduce((s, a) => s + 1000/a.averageSpeed!, 0) / olRuns.filter(a=>a.averageSpeed).length
      : null;
    const avgRoadPace = roadRuns.length >= 10 && roadRuns.filter(a=>a.averageSpeed).length >= 10
      ? roadRuns.filter(a=>a.averageSpeed).reduce((s, a) => s + 1000/a.averageSpeed!, 0) / roadRuns.filter(a=>a.averageSpeed).length
      : null;
    if (!avgOLPace || !avgRoadPace) return null;
    return { olPaceSecPerKm: Math.round(avgOLPace), roadPaceSecPerKm: Math.round(avgRoadPace), olSessions: olRuns.length, roadSessions: roadRuns.length };
  })();

  // Best performance per distance by half-year (§1B) — from RaceRecord
  const allTimePBs = await prisma.raceRecord.findMany({
    where: { userId, date: { gte: subDays(now, 5 * 365) } },
    select: { distance: true, time: true, date: true },
  });
  const byDistPeriod = new Map<string, number>();
  for (const pb of allTimePBs) {
    const yr = pb.date.getFullYear();
    const half = pb.date.getMonth() < 6 ? "H1" : "H2";
    const key = `${pb.distance}||${yr}-${half}`;
    if (!byDistPeriod.has(key) || byDistPeriod.get(key)! > pb.time) byDistPeriod.set(key, pb.time);
  }
  const perfByDistYear: { distance: string; period: string; time: number }[] = [];
  for (const [key, time] of byDistPeriod) {
    const [dist, period] = key.split("||");
    perfByDistYear.push({ distance: dist, period, time });
  }
  perfByDistYear.sort((a, b) => a.period.localeCompare(b.period));

  // Statistical zone estimation from all running data (activity-level + lap-level)
  type SlowLapRow = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };
  type SlowAct = A & { laps?: unknown };
  const olRaceFilterSlow = (a: A) =>
    !/virtualrun/i.test(a.sportType) &&
    !/indoor|inomhus/i.test(a.name ?? "") &&
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(a.name ?? "") &&
    (!a.isRace || (a.averageSpeed != null && 1000 / a.averageSpeed < 330));
  const statActRuns = (activities as SlowAct[])
    .filter(a => /run|trail/i.test(a.sportType) && a.averageHeartrate && olRaceFilterSlow(a))
    .map(a => ({ avgHR: a.averageHeartrate!, distanceM: a.distance, movingTimeSec: a.movingTime, totalElevationGain: a.totalElevationGain, startDate: a.startDate, isRace: a.isRace }));
  const statLapRuns = (activities as SlowAct[])
    .filter(a => /run|trail/i.test(a.sportType) && olRaceFilterSlow(a) && Array.isArray(a.laps))
    .flatMap(a => {
      const actMaxHR = (a as A).maxHeartrate ?? 0;
      const isHardActivity = actMaxHR > computedMaxHR * 0.87;
      return (a.laps as SlowLapRow[]).filter(l =>
        l.average_heartrate && l.distance >= 800 && l.moving_time >= 180 &&
        (!isHardActivity || l.average_heartrate > computedMaxHR * 0.80)
      ).map(l => ({
        avgHR: l.average_heartrate!,
        distanceM: l.distance,
        movingTimeSec: l.moving_time,
        totalElevationGain: l.total_elevation_gain ?? 0,
        startDate: (a as A).startDate,
        isRace: (a as A).isRace,
      }));
    });
  const statZones = estimateZonesFromStatisticalAnalysis(
    [...statActRuns, ...statLapRuns],
    computedMaxHR, restHR,
  );
  const statZonesLaps = estimateZonesFromStatisticalAnalysis(
    statLapRuns,
    computedMaxHR, restHR,
  );

  const easyPaceTrend = computeEasyPaceTrend(activities as EasyPaceAct[], computedHrZones.z3[0]);

  const hrZoneHistory: { month: string; lt1HR: number; lt2HR: number; maxHR: number }[] = [];
  for (let i = 9; i >= 0; i--) {
    const windowEnd = subDays(now, i * 90);
    const windowStart = subDays(windowEnd, 180);
    const windowActs = (activities as SlowAct[]).filter(a => a.startDate >= windowStart && a.startDate <= windowEnd);
    const winActRuns = windowActs
      .filter(a => /run|trail/i.test(a.sportType) && a.averageHeartrate && olRaceFilterSlow(a))
      .map(a => ({ avgHR: (a as A).averageHeartrate!, distanceM: a.distance, movingTimeSec: (a as A).movingTime, totalElevationGain: (a as A).totalElevationGain, startDate: a.startDate, isRace: (a as A).isRace }));
    const winLapRuns = windowActs
      .filter(a => /run|trail/i.test(a.sportType) && olRaceFilterSlow(a) && Array.isArray(a.laps))
      .flatMap(a => {
        const actMaxHR = (a as A).maxHeartrate ?? 0;
        const isHardActivity = actMaxHR > computedMaxHR * 0.87;
        return (a.laps as SlowLapRow[]).filter(l =>
          l.average_heartrate && l.distance >= 800 && l.moving_time >= 180 &&
          (!isHardActivity || l.average_heartrate > computedMaxHR * 0.80)
        ).map(l => ({
          avgHR: l.average_heartrate!,
          distanceM: l.distance,
          movingTimeSec: l.moving_time,
          totalElevationGain: l.total_elevation_gain ?? 0,
          startDate: (a as A).startDate,
          isRace: (a as A).isRace,
        }));
      });
    const winResult = estimateZonesFromStatisticalAnalysis([...winActRuns, ...winLapRuns], computedMaxHR, restHR);
    if (!winResult) continue;
    const month = format(windowEnd, "yyyy-MM");
    if (!hrZoneHistory.find(x => x.month === month))
      hrZoneHistory.push({ month, lt1HR: winResult.lt1HR, lt2HR: winResult.lt2HR, maxHR: computedMaxHR });
  }

  // Save extraViz + statZones to cache for fast-path reads (fire-and-forget)
  prisma.fitnessCache.update({
    where: { userId },
    data: {
      extraVizJson:     { heatmapData, monthlyOverlay, intensityProfile, vdotTrend, hrZoneHistory, terrainFactor: terrainFactor ?? null, perfByDistYear } as Prisma.InputJsonValue,
      statZonesJson:    (statZones     ?? null) as unknown as Prisma.InputJsonValue,
      statZonesLapsJson:(statZonesLaps ?? null) as unknown as Prisma.InputJsonValue,
    },
  }).catch((e: unknown) => console.error("[stats] extraViz cache save failed:", e));

  return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
    zoneSeconds, computedHrZones, vo2max, effectivePaceZones, predictions, polarisation, acwr, statZones, overviewRun,
    { aeiByWeek, reByWeek, rampRate, injuryRisk, activeStreak, tempSensitivity }, paceZoneSeconds,
    modelPredictions, modelVdots,
    { heatmapData, monthlyOverlay, intensityProfile, vdotTrend, hrZoneHistory, terrainFactor, perfByDistYear },
    fitnessCache?.decouplingLt1HR ?? null, liveCriticalSpeedMs, liveCsRSq,
    profile?.maxHeartRate ?? null, profile?.restingHeartRate ?? null, weatherStats,
    easyPaceTrend, statZonesLaps);
}

// Shared render — used by both fast and slow paths
type OverviewData = { thisWeek: { km: number; timeSec: number; count: number }; thisMonth: { km: number; timeSec: number; count: number }; ytd: { km: number; timeSec: number; count: number }; lyWeek: { km: number; timeSec: number; count: number }; lyMonth: { km: number; timeSec: number; count: number }; lyYtd: { km: number; timeSec: number; count: number } };

type Analytics1A = {
  aeiByWeek:       { week: string; aei: number }[];
  reByWeek:        { week: string; paceSecPerKm: number }[];
  rampRate:        number | null;
  injuryRisk:      number | null;
  activeStreak:    number;
  tempSensitivity: number | null; // sec/km per 5°C above 15°C
};

function renderStats(
  totalCount: number,
  overview: OverviewData,
  sparklines: number[],
  weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>>,
  loadCurve: import("@/lib/fitness/training-load").DailyLoad[],
  todayLoad: import("@/lib/fitness/training-load").DailyLoad,
  zoneSeconds: Record<string, number>,
  hrZones: import("@/lib/fitness/zones").HRZones,
  vo2max: import("@/lib/fitness/vo2max").VO2maxEstimate,
  paceZones: import("@/lib/fitness/zones").PaceZones,
  predictions: { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number }[],
  polarisation: { z1Pct: number; z2Pct: number; z3Pct: number } | null,
  acwr: number | null,
  statZones?: import("@/lib/fitness/zones").StatisticalZoneResult | null,
  overviewRun?: OverviewData,
  analytics?: Analytics1A | null,
  paceZoneSeconds?: Record<string, number>,
  modelPredictions?: Record<string, { label: string; meters: number; peak: number }[]>,
  modelVdots?: Record<string, number>,
  extraViz?: {
    heatmapData: { week: string; km: number }[];
    monthlyOverlay: { month: string; year: number; km: number }[];
    intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number }[];
    vdotTrend: { month: string; vdot: number }[];
    hrZoneHistory: { month: string; lt1HR: number; lt2HR: number; maxHR: number }[];
    terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
    perfByDistYear: { distance: string; period: string; time: number }[];
  } | null,
  decouplingLt1HR?: number | null,
  criticalSpeedMs?: number | null,
  criticalSpeedRSq?: number | null,
  manualMaxHR?: number | null,
  manualRestHR?: number | null,
  weatherStats?: WeatherStats,
  easyPaceTrend?: EasyPacePoint[],
  statZonesLaps?: import("@/lib/fitness/zones").StatisticalZoneResult | null,
) {
  return (
    <div className="space-y-2">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Statistics</h1>
        <p className="text-sm text-muted mt-1">{totalCount.toLocaleString()} activities total</p>
      </div>
      <StatsErrorBoundary>
      <StatsClient
        overview={overview}
        sparklines={sparklines}
        weeklyVolumes={weeklyVolumes}
        loadCurve={loadCurve}
        todayLoad={todayLoad}
        zoneSeconds={zoneSeconds}
        hrZones={hrZones}
        ltBounds={ltBoundaries(hrZones)}
        vo2max={vo2max}
        paceZones={paceZones}
        predictions={predictions}
        polarisation={polarisation}
        acwr={acwr}
        statZones={statZones ?? null}
        overviewRun={overviewRun ?? overview}
        analytics={analytics ?? null}
        paceZoneSeconds={paceZoneSeconds ?? {}}
        modelPredictions={modelPredictions ?? {}}
        modelVdots={modelVdots ?? {}}
        extraViz={extraViz ?? null}
        decouplingLt1HR={decouplingLt1HR ?? null}
        criticalSpeedMs={criticalSpeedMs ?? null}
        criticalSpeedRSq={criticalSpeedRSq ?? null}
        manualMaxHR={manualMaxHR ?? null}
        manualRestHR={manualRestHR ?? null}
        weatherStats={weatherStats ?? null}
        easyPaceTrend={easyPaceTrend ?? []}
        statZonesLaps={statZonesLaps ?? null}
      />
      </StatsErrorBoundary>
    </div>
  );
}

type OverviewResult = {
  thisWeek: { km: number; timeSec: number; count: number };
  thisMonth: { km: number; timeSec: number; count: number };
  ytd: { km: number; timeSec: number; count: number };
  lyWeek: { km: number; timeSec: number; count: number };
  lyMonth: { km: number; timeSec: number; count: number };
  lyYtd: { km: number; timeSec: number; count: number };
};
function buildOverview(_: OverviewResult): OverviewResult { return _; } // just for type inference


export interface WeatherBand { label: string; count: number; avgPaceSecPerKm: number | null }
export interface WeatherStats { byTemp: WeatherBand[]; byWind: WeatherBand[] }

type WeatherAct = {
  averageSpeed: number | null;
  weatherTemp: number | null;
  weatherWind: number | null;
  startDate: Date;
  name: string;
  sportType: string;
  averageHeartrate: number | null;
};

/**
 * Compute weather-performance statistics while isolating confounders:
 *  - OL (orienteering) excluded — terrain varies wildly, not speed comparable
 *  - Fitness drift removed via rolling 12-week median pace residual
 *  - Only road/trail easy-to-moderate effort runs (not ultra-hard race efforts)
 */
function computeWeatherStats(acts: WeatherAct[]): WeatherStats {
  // Filter out OL sessions and non-running types — same pattern as HR zone estimator
  const isOL = (a: WeatherAct) =>
    /virtualrun/i.test(a.sportType) ||
    /indoor|inomhus/i.test(a.name ?? "") ||
    /orienteer|ol\b|ol-/i.test(a.sportType) ||
    /\bol\b|\borienteringsl|\bskogsl|\bolpass|\bmoc\b|stafett/i.test(a.name ?? "") ||
    /^\s*wu\b|^\s*cd\b|\bwarm.?up\b|\bcool.?down\b|\bnedvarvning\b|\buppvärmning\b/i.test(a.name ?? "");

  const clean = acts.filter(a =>
    a.averageSpeed && a.averageSpeed > 0 &&
    !isOL(a) &&
    /run|trail/i.test(a.sportType)
  );

  if (clean.length < 10) {
    return { byTemp: [], byWind: [] };
  }

  // ── Fitness-drift correction ──────────────────────────────────────────────
  // Compute rolling 12-week median pace. Each run's "adjusted pace" = raw pace
  // minus (rolling median - overall median) so seasonal fitness changes are removed.
  const sorted = [...clean].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const overallPaces = sorted.map(a => 1000 / a.averageSpeed!);
  const overallMedian = median(overallPaces);

  // For each run, find median pace of runs in a ±6-week window
  const adjustedPaces = sorted.map((a, i) => {
    const rawPace = 1000 / a.averageSpeed!;
    const windowStart = a.startDate.getTime() - 42 * 86400_000;
    const windowEnd   = a.startDate.getTime() + 42 * 86400_000;
    const windowPaces = sorted
      .filter(b => b.startDate.getTime() >= windowStart && b.startDate.getTime() <= windowEnd)
      .map(b => 1000 / b.averageSpeed!);
    const windowMed = median(windowPaces);
    // Adjusted pace = raw pace - (local fitness level - overall average)
    return rawPace - (windowMed - overallMedian);
  });

  const TEMP_BANDS = [
    { label: "< 5°C",   test: (t: number) => t < 5 },
    { label: "5–10°C",  test: (t: number) => t >= 5  && t < 10 },
    { label: "10–15°C", test: (t: number) => t >= 10 && t < 15 },
    { label: "15–20°C", test: (t: number) => t >= 15 && t < 20 },
    { label: "> 20°C",  test: (t: number) => t >= 20 },
  ];
  const WIND_BANDS = [
    { label: "Calm (< 10)",      test: (w: number) => w < 10 },
    { label: "Light (10–20)",    test: (w: number) => w >= 10 && w < 20 },
    { label: "Moderate (20–30)", test: (w: number) => w >= 20 && w < 30 },
    { label: "Strong (> 30)",    test: (w: number) => w >= 30 },
  ];

  function computeBands(
    bands: { label: string; test: (v: number) => boolean }[],
    getValue: (a: WeatherAct) => number | null,
    controlFilter?: (a: WeatherAct) => boolean,
  ): WeatherBand[] {
    return bands.map(band => {
      const indices = sorted
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
          const v = getValue(a);
          if (v == null || !band.test(v)) return false;
          if (controlFilter && !controlFilter(a)) return false;
          return true;
        });
      if (indices.length < 3) return { label: band.label, count: 0, avgPaceSecPerKm: null };
      const paces = indices.map(({ i }) => adjustedPaces[i]);
      const avg = paces.reduce((s, p) => s + p, 0) / paces.length;
      return { label: band.label, count: indices.length, avgPaceSecPerKm: Math.round(avg) };
    });
  }

  return {
    // Control for wind when studying temperature: only calm/light-wind runs (< 20 km/h).
    // Removes the seasonal wind-temperature correlation (cold still days vs windy spring fronts).
    byTemp: computeBands(TEMP_BANDS, a => a.weatherTemp,
      a => a.weatherWind == null || a.weatherWind < 20),
    // Control for temperature when studying wind: only moderate-temp runs (0–25°C).
    // Removes extreme-cold/extreme-heat effects that would otherwise dominate the wind signal.
    byWind: computeBands(WIND_BANDS, a => a.weatherWind,
      a => a.weatherTemp != null && a.weatherTemp >= 0 && a.weatherTemp < 25),
  };
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// ── Easy run pace trend ──────────────────────────────────────────────────────

export type EasyPacePoint = { month: string; medianGap: number; avgHR: number; count: number };

type EasyPaceAct = {
  sportType: string; startDate: Date; distance: number; movingTime: number;
  totalElevationGain: number; averageHeartrate: number | null; isRace: boolean;
};

function computeEasyPaceTrend(acts: EasyPaceAct[], lt1HR: number): EasyPacePoint[] {
  const byMonth = new Map<string, Array<{ gap: number; hr: number }>>();
  for (const a of acts) {
    if (!a.averageHeartrate || a.isRace) continue;
    if (!/run|trail/i.test(a.sportType)) continue;
    if (a.averageHeartrate >= lt1HR) continue;
    if (a.distance < 6000 || a.movingTime < 1200) continue;
    const rawPace = a.movingTime / (a.distance / 1000);
    const grade = Math.min(0.15, Math.max(0, a.totalElevationGain / a.distance));
    const gap = rawPace / (1 + grade * 0.033);
    const month = format(a.startDate, "yyyy-MM");
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push({ gap, hr: a.averageHeartrate });
  }
  const result: EasyPacePoint[] = [];
  for (const [month, pts] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (pts.length < 3) continue;
    const sorted = [...pts].sort((a, b) => a.gap - b.gap);
    const mid = Math.floor(sorted.length / 2);
    const medianGap = sorted.length % 2 === 0
      ? (sorted[mid - 1].gap + sorted[mid].gap) / 2
      : sorted[mid].gap;
    result.push({
      month,
      medianGap: Math.round(medianGap),
      avgHR: Math.round(pts.reduce((s, p) => s + p.hr, 0) / pts.length),
      count: pts.length,
    });
  }
  return result;
}

function normalizeSport(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("run") || s.includes("trail")) return "Running";
  if (s.includes("ride") || s.includes("cycl")) return "Cycling";
  if (s.includes("nordicski") || s.includes("backcountry")) return "Skiing";
  if (s.includes("rollerski")) return "Roller Skiing";
  if (s.includes("orienteer")) return "Orienteering";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "Strength";
  return t;
}
