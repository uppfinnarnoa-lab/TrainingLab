import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { StatsClient } from "./stats-client";
import { StatsErrorBoundary } from "./stats-error-boundary";
import { buildHRZones, buildPaceZones, buildPaceZonesFromLT, estimateLTFromRaces, estimateMaxHR, estimateMaxHRFromThreshold, estimateMaxHRFromRaces, ltBoundaries, computeZoneTime, type ZoneTimeActivity, type HRZones, type StatisticalZoneResult } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve, computeACWR } from "@/lib/fitness/training-load";
import { estimateVO2max, computeRacePredictions, buildTrustedRacePBs, extractTempoRunAnchors, extractIntervalLapCandidates, type KnownPerformance } from "@/lib/fitness/vo2max";
import { loadBestEffortsForRacePredictions } from "@/lib/fitness/cache";
import { loadCachedHRStreams } from "@/lib/strava/stream-backfill";
import { computeHrvBaseline, computeRestingHRBaseline, computeReadinessScore, type HrvBaseline } from "@/lib/garmin/insights";
import {
  computeWeatherStats, computeEasyPaceTrend, computeCadenceScatter,
  type WeatherStats, type WeatherAct, type EasyPacePoint, type EasyPaceAct, type CadenceScatterPoint,
} from "@/lib/fitness/secondary-analytics";
import { subDays, format, startOfWeek, startOfYear } from "date-fns";

type A = {
  id: string; sportType: string; startDate: Date; startDateLocal: Date; name: string;
  distance: number; movingTime: number; totalElevationGain: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; averageCadence: number | null;
  trainingLoad: number | null;
  isRace: boolean; weatherTemp: number | null;
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — cache valid if sync runs hourly

export default async function StatsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const now = new Date();

  // ── Always fetch ────────────────────────────────────────────────────────
  const [profile, fitnessCache, garminRecent, allRacePBs, weatherActs, sportCategories] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(now, 112) } }, // 16 weeks, matches other trend charts
      orderBy: { date: "asc" },
    }),
    prisma.raceRecord.findMany({
      where: { userId, date: { gte: subDays(now, 5 * 365) } },
      select: { distanceM: true, time: true, date: true, isManual: true, stravaActivityId: true },
      orderBy: { time: "asc" },
    }),
    // Weather profile: last 4 years only — older data reflects a different fitness level
    prisma.activity.findMany({
      where: {
        userId,
        startDate: { gte: subDays(now, 4 * 365) },
        sportType: { contains: "run", mode: "insensitive" },
        weatherTemp: { not: null },
        averageSpeed: { not: null },
        distance: { gte: 3000 },  // min 3 km — short efforts are too noisy
        isRace: false,             // exclude races (paced differently)
      },
      select: { averageSpeed: true, weatherTemp: true, weatherWind: true, weatherPrecip: true, distance: true, startDate: true, name: true, sportType: true, averageHeartrate: true },
    }),
    prisma.sportCategory.findMany({ where: { userId }, select: { name: true, color: true } }),
  ]);
  const sportColors: Record<string, string> = {};
  for (const s of sportCategories) sportColors[s.name.toLowerCase()] = s.color;

  // See lib/fitness/cache.ts::loadRacePBs() for the shared isManual trust rule — both
  // implementations must call the same buildTrustedRacePBs(), see vo2max.ts doc comment on
  // computeRacePredictions() for why this can never be allowed to drift apart.
  const racePBs = buildTrustedRacePBs(allRacePBs.map((r: { distanceM: number; time: number; date: Date; isManual: boolean; stravaActivityId: string | null }) => ({
    distanceM: r.distanceM, timeSec: r.time, date: r.date, isManual: r.isManual, stravaActivityId: r.stravaActivityId,
  })));

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

  const garminWellness: GarminWellnessPoint[] = garminRecent.map((g: {
    date: Date; hrvNightly: number | null; hrvBalance: string | null; sleepScore: number | null;
    sleepDeep: number | null; sleepLight: number | null; sleepRem: number | null; sleepAwake: number | null;
    restingHR: number | null; bodyBattery: number | null; stressAvg: number | null; trainingReadiness: number | null;
  }) => ({
    date:              format(g.date, "yyyy-MM-dd"),
    hrvNightly:        g.hrvNightly,
    hrvBalance:        g.hrvBalance,
    sleepScore:        g.sleepScore,
    sleepDeepH:        g.sleepDeep   != null ? Math.round(g.sleepDeep   / 360) / 10 : null,
    sleepLightH:       g.sleepLight  != null ? Math.round(g.sleepLight  / 360) / 10 : null,
    sleepRemH:         g.sleepRem    != null ? Math.round(g.sleepRem    / 360) / 10 : null,
    sleepAwakeH:       g.sleepAwake  != null ? Math.round(g.sleepAwake  / 360) / 10 : null,
    restingHR:         g.restingHR,
    bodyBattery:       g.bodyBattery,
    stressAvg:         g.stressAvg,
    trainingReadiness: g.trainingReadiness,
  }));

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

  // "Statistical threshold estimation" card — calibration-only snapshot.
  // Written exclusively by updateHRZones() (the calibration button); never recomputed
  // live here. A rolling 90-day recency window drifts on its own as time passes even
  // with zero new activities, so a live recompute on every stale-cache page load would
  // make this card silently diverge from the applied zones below it between calibrations.
  //
  // Reads statZonesJson (computed from activities + laps combined), NOT statZonesLapsJson
  // (laps-only). Those are two different inputs to the same algorithm and can legitimately
  // disagree — laps-only excludes any race/hard-effort activity that wasn't recorded with
  // lap splits, which can make it measurably less reliable. statZonesJson is exactly the
  // dataset that determines the applied zones below when the statistical method wins, so
  // reading it here is what makes "Apply zones" visibly match this card.
  const statZonesLapsCached = (fitnessCache?.statZonesJson ?? null) as import("@/lib/fitness/zones").StatisticalZoneResult | null;

  const weatherStats = computeWeatherStats(weatherActs as WeatherAct[], maxHR);

  // ── tempSensitivity — computed from weatherActs (always fresh) so fast path gets it too ──
  let tempSensitivity: number | null = null;
  {
    const lt1HR = hrZones.z3[0];
    const pts = (weatherActs as WeatherAct[]).filter(a =>
      a.averageSpeed && a.averageSpeed > 0 && a.averageHeartrate &&
      a.averageHeartrate < lt1HR && a.weatherTemp != null && a.distance >= 4000
    );
    if (pts.length >= 10) {
      const meanTemp = pts.reduce((s, a) => s + a.weatherTemp!, 0) / pts.length;
      const meanPace = pts.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / pts.length;
      let num = 0, den = 0;
      for (const a of pts) {
        const dt = a.weatherTemp! - meanTemp;
        const dp = 1000 / a.averageSpeed! - meanPace;
        num += dt * dp; den += dt * dt;
      }
      if (den > 0.01) tempSensitivity = Math.round(num / den * 5 * 10) / 10;
    }
  }

  // ── Garmin HRV baseline + resting HR baseline — always fresh, feeds the readiness score ──
  const hrvBaseline = computeHrvBaseline(garminRecent, now);
  const restHRBaseline = computeRestingHRBaseline(garminRecent, now);

  if (cacheReady && fitnessCache) {
    // ── FAST PATH: read everything from cache ─────────────────────────────
    const weeklyVolumes = (fitnessCache.weeklyVolumeJson ?? {}) as Record<string, Record<string, { km: number; timeSec: number }>>;
    const zoneSeconds   = (fitnessCache.zoneSecondsJson ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }) as Record<string, number>;
    const polarisation  = (fitnessCache.polarisationJson ?? null) as { z1Pct: number; z2Pct: number; z3Pct: number } | null;
    const predictions   = (fitnessCache.predictionsJson ?? []) as { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number; lowConfidenceShort?: boolean; models?: Record<string, number> }[];
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
      heatmapData: { week: string; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
      monthlyOverlay: { month: string; year: number; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
      intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport?: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[];
      vdotTrend: { month: string; vdot: number }[];
      terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
      perfByDistYear: { distance: string; period: string; time: number }[];
      ltPaceTrend: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[];
      easyPaceTrend?: EasyPacePoint[];
    } | null;
    // Build sparklines from cached weekly volumes
    const sparklines = Array.from({ length: 8 }, (_, i) => {
      const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
      const key = format(wkStart, "yyyy-MM-dd");
      return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
    });

    // 3 years: load curve uses only the last 2 years internally; extra year supplies fresh viz data
    const recentForCurve = await prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(now, 3 * 365) } },
      select: { movingTime: true, averageHeartrate: true, startDate: true, startDateLocal: true, sportType: true, averageSpeed: true,
        distance: true, totalElevationGain: true, isRace: true, averageCadence: true, trainingLoad: true, name: true },
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
      tempSensitivity,
    };

    // Read from cache (computed over full 5-year window during sync) — falls back to
    // recentForCurve if the cache was written before easyPaceTrend was added
    const fpEasyPaceTrend = extraViz?.easyPaceTrend?.length
      ? extraViz.easyPaceTrend
      : computeEasyPaceTrend(recentForCurve as EasyPaceAct[], hrZones.z3[0]);

    // ── Cadence/stride vs pace (1A) — fast path ─────────────────────────────
    type CurveActExt = { movingTime: number; averageHeartrate: number | null; startDate: Date; startDateLocal: Date; sportType: string | null; averageSpeed: number | null; averageCadence: number | null; trainingLoad: number | null };
    const fpCadenceScatter = computeCadenceScatter(recentForCurve as CurveActExt[], now);

    // ── Efficiency Factor trend (2A) — fast path ────────────────────────────
    const fpLt1HRForEF = fitnessCache?.decouplingLt1HR ?? (fitnessCache?.maxHR ? fitnessCache.maxHR * 0.76 : null);
    const fpEfWeekMap = new Map<string, { efSum: number; n: number }>();
    for (const act of recentForCurve as CurveActExt[]) {
      if (!act.sportType || !/run/i.test(act.sportType)) continue;
      if (!act.averageHeartrate || !act.averageSpeed) continue;
      if (fpLt1HRForEF && act.averageHeartrate > fpLt1HRForEF) continue;
      if (act.movingTime > 0 && (act.averageSpeed * act.movingTime) < 3000) continue;
      const wk = format(startOfWeek(act.startDateLocal, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const ef = (act.averageSpeed * 60) / act.averageHeartrate;
      if (ef < 0.5 || ef > 5) continue;
      if (!fpEfWeekMap.has(wk)) fpEfWeekMap.set(wk, { efSum: 0, n: 0 });
      const entry = fpEfWeekMap.get(wk)!; entry.efSum += ef; entry.n++;
    }
    const fpEfByWeek = [...fpEfWeekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-16)
      .map(([week, d]) => ({ week, ef: +(d.efSum / d.n).toFixed(3) }));

    // ── Training Monotony + Strain (2C) — fast path ─────────────────────────
    const fpWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const fpWeekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(fpWeekStart); d.setDate(d.getDate() + i);
      return curveTSSMap.get(format(d, "yyyy-MM-dd")) ?? 0;
    });
    const fpWeekTSSTotal = fpWeekDays.reduce((a, b) => a + b, 0);
    const fpWeekMean = fpWeekTSSTotal / 7;
    const fpWeekStddev = Math.sqrt(fpWeekDays.reduce((s, v) => s + (v - fpWeekMean) ** 2, 0) / 7);
    const fpMonotony = fpWeekStddev > 0 ? fpWeekMean / fpWeekStddev : null;
    const fpStrain = fpMonotony !== null ? fpWeekTSSTotal * fpMonotony : null;

    // ── Recovery speed (2F) — fast path ─────────────────────────────────────
    const fpRecoveryDays: number[] = [];
    let fpTroughDay = -1;
    for (let i = 1; i < loadCurve.length; i++) {
      if (fpTroughDay < 0 && loadCurve[i].tsb < -15) { fpTroughDay = i; }
      if (fpTroughDay >= 0 && loadCurve[i].tsb >= 0) {
        fpRecoveryDays.push(i - fpTroughDay);
        fpTroughDay = -1;
      }
    }
    const fpAvgRecoveryDays = fpRecoveryDays.length >= 2
      ? Math.round(fpRecoveryDays.reduce((a, b) => a + b, 0) / fpRecoveryDays.length)
      : null;

    // Always compute fresh heatmap/overlay/intensity from recentForCurve so timeSec and
    // bySport are always present regardless of cache vintage
    type FCurve = { sportType: string; distance: number; movingTime: number; startDate: Date; averageHeartrate: number | null };
    const fpHeatmap     = computeFreshHeatmap(recentForCurve as FCurve[], now);
    const fpOverlay     = computeFreshMonthlyOverlay(recentForCurve as FCurve[], now);
    const fpIntensity   = computeFreshIntensityProfile(recentForCurve as FCurve[], hrZones.z3[0], hrZones.z4[0]);
    const extraVizFresh = extraViz ? { ...extraViz, heatmapData: fpHeatmap, monthlyOverlay: fpOverlay, intensityProfile: fpIntensity } : null;

    return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
      fastZoneSeconds, hrZones, vo2max, effectivePaceZones, predictions, fastPolarisation, acwr,
      overviewRun, fastAnalytics, fastPaceZoneSeconds, extraVizFresh,
      profile?.maxHeartRate ?? null, profile?.restingHeartRate ?? null, weatherStats,
      fpEasyPaceTrend, statZonesLapsCached,
      fpCadenceScatter, fpEfByWeek, fpMonotony, fpStrain, fpAvgRecoveryDays, fpRecoveryDays.length,
      garminWellness, hrvBaseline, restHRBaseline, sportColors);
  }

  // ── SLOW PATH: full computation (cache miss or stale) ───────────────────
  // Skip bestEfforts + splitsMetric — large JSON not needed for stats aggregations
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(now, 10 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      id: true, sportType: true, startDate: true, startDateLocal: true, name: true,
      distance: true, movingTime: true, totalElevationGain: true,
      averageHeartrate: true, maxHeartrate: true,
      averageSpeed: true, averageCadence: true, trainingLoad: true,
      isRace: true, weatherTemp: true, laps: true,
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
  let slowLongestRunM = 0;
  for (const a of activities as A[]) {
    if (!/run|trail/i.test(a.sportType) || a.startDate < slowEightWeeksAgo) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    slowWkRunKm.set(wk, (slowWkRunKm.get(wk) ?? 0) + a.distance / 1000);
    if (a.distance > slowLongestRunM) slowLongestRunM = a.distance;
  }
  const slowAvgWeeklyRunKm = [...slowWkRunKm.values()].reduce((s, v) => s + v, 0) / 8;

  const vo2max = estimateVO2max(
    activities.map((a: A) => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, startDate: a.startDate,
    })),
    computedMaxHR, restHR, racePBs, slowAvgWeeklyRunKm,
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

  // Prefers cached per-second HR streams over lap averages — see computeZoneTime() doc
  // comment in lib/fitness/zones.ts. Read-only: this page load only reads streams already
  // cached by updateVO2maxAndPaces()'s background backfill, never fetches new ones itself.
  const zoneWindowActivities = (activities as A[]).filter(a => a.startDate >= twelveWeeksAgo);
  const zoneStreams = await loadCachedHRStreams(zoneWindowActivities.map(a => a.id));
  const { zoneSeconds, polZ1, polZ2, polZ3 } = computeZoneTime(activities as ZoneTimeActivity[], computedHrZones, twelveWeeksAgo, zoneStreams);

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

  // Shared with both FitnessCache update paths (lib/fitness/cache.ts) — see
  // computeRacePredictions() doc comment for why this must stay a single implementation.
  const bestEffortsForPredictions = await loadBestEffortsForRacePredictions(userId);
  const lt2 = statZonesLapsCached
    ? { paceSecPerKm: statZonesLapsCached.lt2PaceSecPerKm, rSquared: statZonesLapsCached.rSquared }
    : null;
  const runningActsSlow = (activities as (A & { laps?: unknown })[]).filter(a => /run|trail/i.test(a.sportType));
  const lowerTierCandidatesSlow: KnownPerformance[] = [
    ...extractTempoRunAnchors(
      runningActsSlow.map(a => ({ distanceM: a.distance, timeSec: a.movingTime, avgHR: a.averageHeartrate, totalElevationGain: a.totalElevationGain, name: a.name })),
      computedMaxHR,
    ),
    ...extractIntervalLapCandidates(runningActsSlow.map(a => ({ name: a.name, laps: a.laps }))),
  ];
  const { predictions } =
    computeRacePredictions(vo2max.vdot, todayLoad.tsb, racePBs, bestEffortsForPredictions, slowLongestRunM, lt2, lowerTierCandidatesSlow);

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

  // Activity heatmap: weekly km + timeSec + bySport for last 3 years
  const heatmapData: { week: string; km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }[] = [];
  {
    const wm = new Map<string, { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }>();
    const threeYearsAgo = subDays(now, 3 * 365);
    for (const a of activities as A[]) {
      if (a.startDate < threeYearsAgo) continue;
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const e = wm.get(wk) ?? { km: 0, timeSec: 0, bySport: {} };
      e.km += a.distance / 1000; e.timeSec += a.movingTime;
      const sport = normalizeSport(a.sportType);
      if (!e.bySport[sport]) e.bySport[sport] = { km: 0, timeSec: 0 };
      e.bySport[sport].km += a.distance / 1000; e.bySport[sport].timeSec += a.movingTime;
      wm.set(wk, e);
    }
    for (const [week, v] of wm) heatmapData.push({ week, km: Math.round(v.km * 10) / 10, timeSec: Math.round(v.timeSec), bySport: Object.fromEntries(Object.entries(v.bySport).map(([s, d]) => [s, { km: Math.round(d.km * 10) / 10, timeSec: Math.round(d.timeSec) }])) });
    heatmapData.sort((a, b) => a.week.localeCompare(b.week));
  }

  // 3-year monthly volume overlay with timeSec + per-sport breakdown
  const monthlyOverlay: { month: string; year: number; km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }[] = [];
  {
    const mm = new Map<string, { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }>();
    for (const a of activities as A[]) {
      const key = `${a.startDate.getFullYear()}-${format(a.startDate, "MM")}`;
      if (!mm.has(key)) mm.set(key, { km: 0, timeSec: 0, bySport: {} });
      const e = mm.get(key)!;
      e.km += a.distance / 1000; e.timeSec += a.movingTime;
      const sport = normalizeSport(a.sportType);
      if (!e.bySport[sport]) e.bySport[sport] = { km: 0, timeSec: 0 };
      e.bySport[sport].km += a.distance / 1000;
      e.bySport[sport].timeSec += a.movingTime;
    }
    const yr = now.getFullYear();
    for (let y = yr - 2; y <= yr; y++) {
      for (let m = 1; m <= 12; m++) {
        const mo = String(m).padStart(2, "0");
        const v = mm.get(`${y}-${mo}`) ?? { km: 0, timeSec: 0, bySport: {} };
        monthlyOverlay.push({ month: mo, year: y, km: Math.round(v.km), timeSec: Math.round(v.timeSec), bySport: Object.fromEntries(Object.entries(v.bySport).map(([s, d]) => [s, { km: Math.round(d.km), timeSec: Math.round(d.timeSec) }])) });
      }
    }
  }

  // Monthly intensity profile with bySport breakdown
  const intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[] = [];
  {
    const lt1 = computedHrZones.z3[0], lt2 = computedHrZones.z4[0];
    type IB = { easy: number; tempo: number; hard: number };
    const mm = new Map<string, { total: IB; bySport: Record<string, IB> }>();
    for (const a of activities as A[]) {
      if (!a.averageHeartrate || a.distance < 2000) continue;
      const key = format(a.startDate, "yyyy-MM");
      if (!mm.has(key)) mm.set(key, { total: { easy: 0, tempo: 0, hard: 0 }, bySport: {} });
      const e = mm.get(key)!;
      const min = a.movingTime / 60;
      const sport = normalizeSport(a.sportType);
      if (!e.bySport[sport]) e.bySport[sport] = { easy: 0, tempo: 0, hard: 0 };
      const bucket = (b: IB) => {
        if (a.averageHeartrate! < lt1) b.easy += min;
        else if (a.averageHeartrate! < lt2) b.tempo += min;
        else b.hard += min;
      };
      bucket(e.total); bucket(e.bySport[sport]);
    }
    for (const [month, d] of [...mm.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-24)) {
      intensityProfile.push({
        month,
        easyMin: Math.round(d.total.easy), tempoMin: Math.round(d.total.tempo), hardMin: Math.round(d.total.hard),
        bySport: Object.fromEntries(Object.entries(d.bySport).map(([s, b]) => [s, { easyMin: Math.round(b.easy), tempoMin: Math.round(b.tempo), hardMin: Math.round(b.hard) }])),
      });
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
      // racePBs filtered to "known by windowEnd" (no hindsight) — see lib/fitness/cache.ts's
      // identical vdotTrend loop for why this is required, not optional: without racePBs, the
      // race-PB-weighted models never fire, so even the current month disagreed with the live
      // VDOT shown on the Fitness tab.
      const v = estimateVO2max(
        windowActs.map(a => ({
          distanceM: a.distance, timeSec: a.movingTime,
          avgHR: a.averageHeartrate, isRace: a.isRace,
          sportType: a.sportType, name: a.name, startDate: a.startDate,
        })),
        computedMaxHR, restHR, racePBs.filter(pb => pb.date <= windowEnd), slowAvgWeeklyRunKm,
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

  const easyPaceTrend = computeEasyPaceTrend(activities as EasyPaceAct[], computedHrZones.z3[0]);

  // ── Cadence/stride vs pace (1A) — slow path ─────────────────────────────
  const cadenceScatter = computeCadenceScatter(activities as A[], now);

  // ── Efficiency Factor trend (2A) — slow path ────────────────────────────
  const lt1HRForEF = fitnessCache?.decouplingLt1HR ?? (fitnessCache?.maxHR ? fitnessCache.maxHR * 0.76 : null);
  const efWeekMap = new Map<string, { efSum: number; n: number }>();
  for (const act of activities as A[]) {
    if (!/run/i.test(act.sportType)) continue;
    if (!act.averageHeartrate || !act.averageSpeed) continue;
    if (lt1HRForEF && act.averageHeartrate > lt1HRForEF) continue;
    if (act.distance < 3000) continue;
    const wk = format(startOfWeek(act.startDateLocal, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const ef = (act.averageSpeed * 60) / act.averageHeartrate;
    if (ef < 0.5 || ef > 5) continue;
    if (!efWeekMap.has(wk)) efWeekMap.set(wk, { efSum: 0, n: 0 });
    const entry = efWeekMap.get(wk)!; entry.efSum += ef; entry.n++;
  }
  const efByWeek = [...efWeekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-16)
    .map(([week, d]) => ({ week, ef: +(d.efSum / d.n).toFixed(3) }));

  // ── Training Monotony + Strain (2C) — slow path ─────────────────────────
  // dailyTSSMap is already computed above; use trainingLoad field if available, else TSS estimate
  const slowDailyTSSMap = new Map<string, number>();
  for (const act of activities as A[]) {
    const dk = format(act.startDate, "yyyy-MM-dd");
    slowDailyTSSMap.set(dk, (slowDailyTSSMap.get(dk) ?? 0) + (act.trainingLoad ?? 0));
  }
  const slowWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const slowWeekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(slowWeekStart); d.setDate(d.getDate() + i);
    return slowDailyTSSMap.get(format(d, "yyyy-MM-dd")) ?? 0;
  });
  const slowWeekTSSTotal = slowWeekDays.reduce((a, b) => a + b, 0);
  const slowWeekMean = slowWeekTSSTotal / 7;
  const slowWeekStddev = Math.sqrt(slowWeekDays.reduce((s, v) => s + (v - slowWeekMean) ** 2, 0) / 7);
  const monotony = slowWeekStddev > 0 ? slowWeekMean / slowWeekStddev : null;
  const strain = monotony !== null ? slowWeekTSSTotal * monotony : null;

  // ── Recovery speed (2F) — slow path ─────────────────────────────────────
  const recoveryDays: number[] = [];
  let troughDay = -1;
  for (let i = 1; i < loadCurve.length; i++) {
    if (troughDay < 0 && loadCurve[i].tsb < -15) { troughDay = i; }
    if (troughDay >= 0 && loadCurve[i].tsb >= 0) {
      recoveryDays.push(i - troughDay);
      troughDay = -1;
    }
  }
  const avgRecoveryDays = recoveryDays.length >= 2
    ? Math.round(recoveryDays.reduce((a, b) => a + b, 0) / recoveryDays.length)
    : null;

  // Preserve stored ltPaceTrend — it's computed by updateVO2maxAndPaces, not the slow path
  const existingLtPaceTrend = (fitnessCache?.extraVizJson as { ltPaceTrend?: unknown } | null)?.ltPaceTrend ?? [];

  // Save extraViz to cache for fast-path reads (fire-and-forget).
  // statZonesJson/statZonesLapsJson are NOT written here — those are calibration-only
  // (written exclusively by updateHRZones, the "Apply zones" button). Writing a live
  // recompute here was overwriting the calibration snapshot on every stale-cache page
  // load, silently corrupting the "Statistical threshold estimation" card.
  prisma.fitnessCache.update({
    where: { userId },
    data: {
      extraVizJson: { heatmapData, monthlyOverlay, intensityProfile, vdotTrend, terrainFactor: terrainFactor ?? null, perfByDistYear, ltPaceTrend: existingLtPaceTrend, easyPaceTrend } as Prisma.InputJsonValue,
    },
  }).catch((e: unknown) => console.error("[stats] extraViz cache save failed:", e));

  return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
    zoneSeconds, computedHrZones, vo2max, effectivePaceZones, predictions, polarisation, acwr, overviewRun,
    { aeiByWeek, reByWeek, rampRate, injuryRisk, activeStreak, tempSensitivity }, paceZoneSeconds,
    { heatmapData, monthlyOverlay, intensityProfile, vdotTrend, terrainFactor, perfByDistYear, ltPaceTrend: existingLtPaceTrend as { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[] },
    profile?.maxHeartRate ?? null, profile?.restingHeartRate ?? null, weatherStats,
    easyPaceTrend, statZonesLapsCached,
    cadenceScatter, efByWeek, monotony, strain, avgRecoveryDays, recoveryDays.length,
    garminWellness, hrvBaseline, restHRBaseline, sportColors);
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
  predictions: { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number; lowConfidenceShort?: boolean; models?: Record<string, number> }[],
  polarisation: { z1Pct: number; z2Pct: number; z3Pct: number } | null,
  acwr: number | null,
  overviewRun?: OverviewData,
  analytics?: Analytics1A | null,
  paceZoneSeconds?: Record<string, number>,
  extraViz?: {
    heatmapData: { week: string; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
    monthlyOverlay: { month: string; year: number; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
    intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport?: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[];
    vdotTrend: { month: string; vdot: number }[];
    terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
    perfByDistYear: { distance: string; period: string; time: number }[];
    ltPaceTrend?: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[];
  } | null,
  manualMaxHR?: number | null,
  manualRestHR?: number | null,
  weatherStats?: WeatherStats,
  easyPaceTrend?: EasyPacePoint[],
  statZonesLaps?: import("@/lib/fitness/zones").StatisticalZoneResult | null,
  cadenceScatter?: CadenceScatterPoint[],
  efByWeek?: { week: string; ef: number }[],
  monotony?: number | null,
  strain?: number | null,
  avgRecoveryDays?: number | null,
  recoveryDaysCount?: number,
  garminWellness?: GarminWellnessPoint[],
  hrvBaseline?: HrvBaseline,
  restHRBaseline?: { latest: number | null; baseline30dAvg: number | null; deltaBpm: number | null },
  sportColors?: Record<string, string>,
) {
  const latestGarminPoint = garminWellness?.at(-1) ?? null;
  const readiness = computeReadinessScore({
    hrvRolling7dAvg:   hrvBaseline?.rolling7dAvg ?? null,
    hrvBaseline60dAvg: hrvBaseline?.baseline60dAvg ?? null,
    tsb:               todayLoad.tsb,
    sleepScore:        latestGarminPoint?.sleepScore ?? null,
    restHRDeltaBpm:    restHRBaseline?.deltaBpm ?? null,
  }, latestGarminPoint?.trainingReadiness ?? null);

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
        overviewRun={overviewRun ?? overview}
        paceZoneSeconds={paceZoneSeconds ?? {}}
        extraViz={extraViz ?? null}
        manualMaxHR={manualMaxHR ?? null}
        manualRestHR={manualRestHR ?? null}
        statZonesLaps={statZonesLaps ?? null}
        monotony={monotony ?? null}
        strain={strain ?? null}
        avgRecoveryDays={avgRecoveryDays ?? null}
        recoveryDaysCount={recoveryDaysCount ?? 0}
        garminWellness={garminWellness ?? []}
        readiness={readiness}
        hrvBaseline={hrvBaseline ?? null}
        sportColors={sportColors ?? {}}
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


// WeatherBand/WeatherScatterPoint/WeatherStats/WeatherAct/isOL/median/computeWeatherStats and
// EasyPacePoint/EasyPaceAct/computeEasyPaceTrend and CadenceScatterPoint/CadenceAct/
// computeCadenceScatter all moved to lib/fitness/secondary-analytics.ts — shared with the
// Performance Trends page (app/(dashboard)/stats/trends/page.tsx).

export type GarminWellnessPoint = {
  date:              string; // yyyy-MM-dd
  hrvNightly:        number | null;
  hrvBalance:        string | null;
  sleepScore:        number | null;
  sleepDeepH:        number | null;
  sleepLightH:       number | null;
  sleepRemH:         number | null;
  sleepAwakeH:       number | null;
  restingHR:         number | null;
  bodyBattery:       number | null;
  stressAvg:         number | null;
  trainingReadiness: number | null;
};

// Bucket names match the default SportCategory.name values seeded in scripts/seed-user.ts
// exactly, so the color lookup below can match by name without fuzzy matching.
function normalizeSport(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("run") || s.includes("trail")) return "Running";
  if (s.includes("ride") || s.includes("cycl")) return "Cycling";
  if (s.includes("nordicski") || s.includes("backcountry")) return "Nordic Skiing";
  if (s.includes("rollerski")) return "Roller Skiing";
  if (s.includes("orienteer")) return "Orienteering";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "Strength";
  return t;
}

// ── Fresh viz helpers — always computed from recentForCurve in fast path ──────
// These are O(n) aggregations that take <10ms and ensure timeSec + bySport are
// always present regardless of cache vintage.
type VizAct = { sportType: string; distance: number; movingTime: number; startDate: Date; averageHeartrate: number | null };

function computeFreshHeatmap(acts: VizAct[], now: Date) {
  type E = { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> };
  const wm = new Map<string, E>();
  const cutoff = subDays(now, 3 * 365);
  for (const a of acts) {
    if (a.startDate < cutoff) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const e = wm.get(wk) ?? { km: 0, timeSec: 0, bySport: {} };
    e.km += a.distance / 1000; e.timeSec += a.movingTime;
    const sp = normalizeSport(a.sportType);
    if (!e.bySport[sp]) e.bySport[sp] = { km: 0, timeSec: 0 };
    e.bySport[sp].km += a.distance / 1000; e.bySport[sp].timeSec += a.movingTime;
    wm.set(wk, e);
  }
  const result = [...wm.entries()].map(([week, v]) => ({
    week, km: Math.round(v.km * 10) / 10, timeSec: Math.round(v.timeSec),
    bySport: Object.fromEntries(Object.entries(v.bySport).map(([s, d]) => [s, { km: Math.round(d.km * 10) / 10, timeSec: Math.round(d.timeSec) }])),
  }));
  result.sort((a, b) => a.week.localeCompare(b.week));
  return result;
}

function computeFreshMonthlyOverlay(acts: VizAct[], now: Date) {
  type E = { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> };
  const mm = new Map<string, E>();
  for (const a of acts) {
    const key = `${a.startDate.getFullYear()}-${format(a.startDate, "MM")}`;
    if (!mm.has(key)) mm.set(key, { km: 0, timeSec: 0, bySport: {} });
    const e = mm.get(key)!;
    e.km += a.distance / 1000; e.timeSec += a.movingTime;
    const sp = normalizeSport(a.sportType);
    if (!e.bySport[sp]) e.bySport[sp] = { km: 0, timeSec: 0 };
    e.bySport[sp].km += a.distance / 1000; e.bySport[sp].timeSec += a.movingTime;
  }
  const yr = now.getFullYear();
  const result: { month: string; year: number; km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }[] = [];
  for (let y = yr - 2; y <= yr; y++) {
    for (let m = 1; m <= 12; m++) {
      const mo = String(m).padStart(2, "0");
      const v = mm.get(`${y}-${mo}`) ?? { km: 0, timeSec: 0, bySport: {} };
      result.push({ month: mo, year: y, km: Math.round(v.km), timeSec: Math.round(v.timeSec), bySport: Object.fromEntries(Object.entries(v.bySport).map(([s, d]) => [s, { km: Math.round(d.km), timeSec: Math.round(d.timeSec) }])) });
    }
  }
  return result;
}

function computeFreshIntensityProfile(acts: VizAct[], lt1: number, lt2: number) {
  type IB = { easy: number; tempo: number; hard: number };
  const mm = new Map<string, { total: IB; bySport: Record<string, IB> }>();
  for (const a of acts) {
    if (!a.averageHeartrate || a.distance < 2000) continue;
    const key = format(a.startDate, "yyyy-MM");
    if (!mm.has(key)) mm.set(key, { total: { easy: 0, tempo: 0, hard: 0 }, bySport: {} });
    const e = mm.get(key)!;
    const min = a.movingTime / 60;
    const sp = normalizeSport(a.sportType);
    if (!e.bySport[sp]) e.bySport[sp] = { easy: 0, tempo: 0, hard: 0 };
    const add = (b: IB) => { if (a.averageHeartrate! < lt1) b.easy += min; else if (a.averageHeartrate! < lt2) b.tempo += min; else b.hard += min; };
    add(e.total); add(e.bySport[sp]);
  }
  return [...mm.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24).map(([month, d]) => ({
    month,
    easyMin: Math.round(d.total.easy), tempoMin: Math.round(d.total.tempo), hardMin: Math.round(d.total.hard),
    bySport: Object.fromEntries(Object.entries(d.bySport).map(([s, b]) => [s, { easyMin: Math.round(b.easy), tempoMin: Math.round(b.tempo), hardMin: Math.round(b.hard) }])),
  }));
}
