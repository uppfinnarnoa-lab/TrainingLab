import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { StatsClient } from "./stats-client";
import { buildHRZones, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold, estimateMaxHRFromRaces, ltBoundaries, estimateZonesFromStatisticalAnalysis } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve, computeACWR } from "@/lib/fitness/training-load";
import { estimateVO2max, predictRaceTime, tsbAdjustedRaceTime, riegelPredict, predictionRange, vdotFromRace } from "@/lib/fitness/vo2max";
import { RACE_DISTANCES } from "@/lib/fitness/paces";
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
  const [profile, fitnessCache, garminRecent, allRacePBs] = await Promise.all([
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
  ]);

  const bestPerDist = new Map<number, { distanceM: number; timeSec: number; date: Date }>();
  for (const r of allRacePBs) {
    const d = Math.round(r.distanceM);
    if (!bestPerDist.has(d) || bestPerDist.get(d)!.timeSec > r.time)
      bestPerDist.set(d, { distanceM: r.distanceM, timeSec: r.time, date: r.date });
  }
  const racePBs = [...bestPerDist.values()];

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
  const cacheReady = cacheAge < CACHE_TTL_MS && !!fitnessCache?.weeklyVolumeJson;

  // ── HR zones (always from cache/profile — not expensive) ────────────────
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;
  const maxHR = profile?.maxHeartRate ?? fitnessCache?.maxHR ?? 190;
  const hrZones = buildHRZones(maxHR, restHR);

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
    const acwr = fitnessCache.acwr ?? null;

    // Build sparklines from cached weekly volumes
    const sparklines = Array.from({ length: 8 }, (_, i) => {
      const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
      const key = format(wkStart, "yyyy-MM-dd");
      return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
    });

    // Build load curve: fetch last 24 weeks of activities (small query, no JSON blobs)
    // 24w = 8w CTL warm-up + 16w display window
    const recentForCurve = await prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(now, 168) } },
      select: { movingTime: true, averageHeartrate: true, startDate: true },
      orderBy: { startDate: "asc" },
    });
    const curveTSSMap = new Map<string, number>();
    for (const a of recentForCurve) {
      const key = format(a.startDate, "yyyy-MM-dd");
      const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
      curveTSSMap.set(key, (curveTSSMap.get(key) ?? 0) + tss);
    }
    const fullCurve = buildLoadCurve(curveTSSMap, subDays(now, 168), now);
    const loadCurve = fullCurve.slice(-112); // last 16 weeks for display

    return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
      zoneSeconds, hrZones, vo2max, paceZones, predictions, polarisation, acwr, null, overviewRun);
  }

  // ── SLOW PATH: full computation (cache miss or stale) ───────────────────
  // Skip bestEfforts + splitsMetric — large JSON not needed for stats aggregations
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(now, 5 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      id: true, sportType: true, startDate: true, name: true,
      distance: true, movingTime: true, totalElevationGain: true,
      averageHeartrate: true, maxHeartrate: true,
      averageSpeed: true, isRace: true, weatherTemp: true,
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
  const computedMaxHR = profile?.maxHeartRate
    ?? estimateMaxHRFromRaces(raceMaxHRs)
    ?? estimateMaxHRFromThreshold(thresholdHRs)
    ?? estimateMaxHR(maxHRs);
  const computedHrZones = buildHRZones(computedMaxHR, restHR);

  const vo2max = estimateVO2max(
    activities.map((a: A) => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, startDate: a.startDate,
    })),
    computedMaxHR, restHR, racePBs,
  );
  const paceZones = buildPaceZones(vo2max.vdot);

  const dailyTSSMap = new Map<string, number>();
  for (const a of activities) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR: computedMaxHR, restHR });
    dailyTSSMap.set(key, (dailyTSSMap.get(key) ?? 0) + tss);
  }
  const fullCurve = buildLoadCurve(dailyTSSMap, subDays(now, 365), now);
  const loadCurve = fullCurve.slice(-112);
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

  const sparklines = Array.from({ length: 8 }, (_, i) => {
    const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
    const key = format(wkStart, "yyyy-MM-dd");
    return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
  });

  const anchorPB = racePBs
    .filter(p => p.timeSec > 60 && p.distanceM >= 1500)
    .reduce<{ distanceM: number; timeSec: number } | null>((best, p) =>
      !best || vdotFromRace(p.distanceM, p.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? p : best, null);

  const predictions = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2max.vdot, meters);
    const riegel = anchorPB ? riegelPredict(anchorPB.timeSec, anchorPB.distanceM, meters) : null;
    const range = predictionRange(peak, meters);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, todayLoad.tsb), riegel, rangeLo: range.lo, rangeHi: range.hi };
  });

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
      if (Math.abs(a.averageHeartrate - pct75HR) > 5) continue; // ±5 bpm window around 75% HRmax
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
    const rampRisk = rampRate !== null && rampRate > 10 ? 30 : rampRate !== null && rampRate > 20 ? 50 : 0;
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

  // Statistical zone estimation from all running data
  const statZones = estimateZonesFromStatisticalAnalysis(
    activities.filter((a: A) => /run|trail/i.test(a.sportType) && a.averageHeartrate).map((a: A) => ({
      avgHR: a.averageHeartrate!,
      distanceM: a.distance,
      movingTimeSec: a.movingTime,
      totalElevationGain: a.totalElevationGain,
      startDate: a.startDate,
    })),
    computedMaxHR, restHR,
  );

  return renderStats(totalCount, overview, sparklines, weeklyVolumes, loadCurve, todayLoad,
    zoneSeconds, computedHrZones, vo2max, paceZones, predictions, polarisation, acwr, statZones, overviewRun,
    { aeiByWeek, reByWeek, rampRate, injuryRisk, activeStreak, tempSensitivity });
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
) {
  return (
    <div className="space-y-2">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Statistics</h1>
        <p className="text-sm text-muted mt-1">{totalCount.toLocaleString()} activities total</p>
      </div>
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
      />
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
