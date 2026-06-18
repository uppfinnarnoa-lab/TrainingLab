/**
 * Fitness metrics cache — two separate update paths:
 *
 * AUTO (after every Strava sync):
 *   updateVO2maxAndPaces() — computes and caches everything:
 *   VO2max, VDOT, paces, ATL/CTL/TSB, ACWR, weekly volumes,
 *   zone seconds, polarisation, race predictions, extraViz (VDOT trend,
 *   heatmap, monthly overlay, intensity profile, terrain factor), statZones.
 *   Stats page reads from this cache instead of recomputing on every load.
 *
 * MANUAL (button press only):
 *   updateHRZones() — maxHR, restHR, thresholdHR, HR zones
 *   HR zones should only change when explicitly recalibrated.
 */

import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildHRZonesFromLT, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold, estimateMaxHRFromRaces, estimateLTFromRaces, estimateZonesFromActivities, ensureValidZones, computeZoneTime, type ZoneTimeActivity, MAXHR_ARTIFACT_CAP } from "./zones";
import { estimateVO2max, predictRaceTime, tsbAdjustedRaceTime, riegelPredict, predictionRange, vdotFromRace, personalizedFatigueExponent, type RacePB } from "./vo2max";
import { estimateLT1FromDecoupling } from "./decoupling";
import { estimateCriticalSpeed } from "./critical-speed";
import { computeTSS, buildLoadCurve, computeACWR } from "./training-load";
import { RACE_DISTANCES } from "./paces";
import { subDays, format, startOfWeek } from "date-fns";

type Act = {
  sportType: string; name: string; distance: number; movingTime: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; bestEfforts: unknown;
  startDate: Date; totalElevationGain: number; weatherTemp?: number | null;
};

type ActLight = Omit<Act, "bestEfforts">;

async function loadActivities(userId: string) {
  return prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      sportType: true, name: true, distance: true, movingTime: true,
      averageHeartrate: true, maxHeartrate: true, totalElevationGain: true,
      averageSpeed: true, isRace: true, bestEfforts: true, startDate: true,
      laps: true, weatherTemp: true,
    },
  });
}

// Light version — omits bestEfforts JSON (can be MB of data per user).
// Use when only HR/pace/volume computation is needed and best-effort splits are irrelevant.
async function loadActivitiesLight(userId: string) {
  return prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      sportType: true, name: true, distance: true, movingTime: true,
      averageHeartrate: true, maxHeartrate: true, totalElevationGain: true,
      averageSpeed: true, isRace: true, startDate: true,
      laps: true, weatherTemp: true,
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

type LTPacePointSmooth = { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number };

function smoothLTTrend(points: LTPacePointSmooth[]): LTPacePointSmooth[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));

  const monthDiff = (a: string, b: string) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return Math.abs((by - ay) * 12 + (bm - am));
  };

  // Pass 1: remove isolated single-month spikes. No longer requires an exact 1-month
  // gap on both sides — some months legitimately return null now (breakpoint detection
  // found the data too ambiguous to trust), so a point's nearest surviving neighbors
  // are often calendar-gapped. Instead: when the two nearest available neighbors closely
  // AGREE with each other (within 15s, regardless of how far apart in time), and the
  // current point disagrees with both by more than 15s, the current point is the more
  // likely outlier — a median-filter-style check, not a fixed-gap one.
  // lt2 is the primary statistically-detected breakpoint; lt1 is derived from it
  // (VT1/VT2 pace ratio). Checking each independently let one get "corrected" while
  // the other didn't, decoupling them from their physiological ratio (e.g. a real case:
  // lt2 flagged and smoothed from 232s to 263s while lt1 stayed at 275s — a 275/263
  // ratio nowhere near the ~1.185 the algorithm itself assumes). When lt2 is flagged,
  // rescale lt1 by its original ratio to lt2 instead of checking it independently.
  const pass1: LTPacePointSmooth[] = sorted.map((p, i) => {
    if (i === 0 || i === sorted.length - 1) return p;
    const prev = sorted[i - 1], next = sorted[i + 1];
    const lt2NeighborsAgree = Math.abs(prev.lt2PaceSecPerKm - next.lt2PaceSecPerKm) <= 15;
    const lt2Spike = lt2NeighborsAgree &&
      (p.lt2PaceSecPerKm <= Math.min(prev.lt2PaceSecPerKm, next.lt2PaceSecPerKm) - 15 ||
       p.lt2PaceSecPerKm >= Math.max(prev.lt2PaceSecPerKm, next.lt2PaceSecPerKm) + 15);
    if (!lt2Spike) return p;
    const smoothedLt2 = Math.round((prev.lt2PaceSecPerKm + next.lt2PaceSecPerKm) / 2);
    const ratio = p.lt1PaceSecPerKm / p.lt2PaceSecPerKm;
    return { ...p, lt2PaceSecPerKm: smoothedLt2, lt1PaceSecPerKm: Math.round(smoothedLt2 * ratio) };
  });

  // Pass 2: cap month-over-month change at 20s per elapsed month in EITHER direction
  // (physiological rate limit), scaled by the actual gap since consecutive entries are
  // no longer guaranteed to be 1 calendar month apart. Originally only capped
  // improvement — degradation had no limit at all, so a single bad current-month
  // estimate (the trailing point, which pass 1 can never smooth since it has no "next"
  // neighbor to compare against) could show an implausible jump slower with nothing to
  // catch it.
  const clamp = (curr: number, prev: number, maxChange: number) =>
    curr < prev - maxChange ? prev - maxChange : curr > prev + maxChange ? prev + maxChange : curr;
  const pass2: LTPacePointSmooth[] = [pass1[0]];
  for (let i = 1; i < pass1.length; i++) {
    const prev = pass2[i - 1], curr = pass1[i];
    const maxChange = 20 * monthDiff(prev.month, curr.month);
    pass2.push({
      ...curr,
      lt2PaceSecPerKm: clamp(curr.lt2PaceSecPerKm, prev.lt2PaceSecPerKm, maxChange),
      lt1PaceSecPerKm: clamp(curr.lt1PaceSecPerKm, prev.lt1PaceSecPerKm, maxChange),
    });
  }
  return pass2;
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

  // ── VO2max & paces — TSB + weekly volume passed for full model set ───────
  const cacheEightWeeksAgo = subDays(now, 56);
  const cacheWkRunKm = new Map<string, number>();
  for (const a of activities as Act[]) {
    if (!/run|trail/i.test(a.sportType) || a.startDate < cacheEightWeeksAgo) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    cacheWkRunKm.set(wk, (cacheWkRunKm.get(wk) ?? 0) + a.distance / 1000);
  }
  const cacheAvgWeeklyRunKm = [...cacheWkRunKm.values()].reduce((s, v) => s + v, 0) / 8;

  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
      startDate: a.startDate, totalElevationGain: a.totalElevationGain,
    })),
    maxHR, restHR, racePBs, todayLoad.tsb, cacheAvgWeeklyRunKm,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);
  const existingZones = (existingCache?.zones as object | null) ?? buildHRZonesJson(maxHR, restHR);

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

  // ── Zone seconds & polarisation (last 12 weeks) ─────────────────────────
  // Lap-aware: a mixed-effort session (warmup/hard/cooldown) gets its time split across
  // the zones actually experienced, instead of bucketed wholesale by the blended average.
  type ZoneMap = { z1: [number,number]; z2: [number,number]; z3: [number,number]; z4: [number,number]; z5: [number,number] };
  const hz = existingZones as ZoneMap;
  const twelveWeeksAgo = subDays(now, 84);
  const { zoneSeconds: zoneSecondsJson, polZ1, polZ2, polZ3 } = computeZoneTime(activities as ZoneTimeActivity[], hz, twelveWeeksAgo);
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

  // Personalized fatigue exponent from log-log regression on best efforts across all runs.
  // Falls back to standard Riegel 1.06 if insufficient data.
  const allBestEfforts = (activities as Act[])
    .filter(a => /run|trail/i.test(a.sportType) && Array.isArray(a.bestEfforts))
    .flatMap(a => a.bestEfforts as Array<{ distance: number; elapsed_time: number }>);
  const personalK = personalizedFatigueExponent(allBestEfforts);
  const riegelExponent = personalK !== null ? (1 - personalK) : 1.06;

  // ── Critical Speed from best efforts + race PBs (LT2 proxy) ─────────
  const csResult = estimateCriticalSpeed(allBestEfforts, racePBs);

  // ── Aerobic decoupling LT1 (parallel estimate) ────────────────────────
  // Separate query — avoids loading large splitsMetric JSON for all activities.
  const decouplingRuns = await prisma.activity.findMany({
    where: { userId, splitDetailFetched: true, movingTime: { gte: 2700 }, distance: { gte: 7000 } },
    select: { splitsMetric: true, movingTime: true, distance: true, totalElevationGain: true, weatherTemp: true, startDate: true },
  });
  const decouplingResult = estimateLT1FromDecoupling(decouplingRuns, maxHR);

  const predictionsJson = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2maxResult.vdot, meters);
    const riegel = anchorPB ? riegelPredict(anchorPB.timeSec, anchorPB.distanceM, meters, riegelExponent) : null;
    const range = predictionRange(peak, meters);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, todayLoad.tsb), riegel, rangeLo: range.lo, rangeHi: range.hi };
  });

  // ── Extra visualizations — derived from activity data, updated every sync ──
  type ZM = { z3: [number, number]; z4: [number, number] };
  const ezHz = existingZones as ZM | null;
  const evLt1 = ezHz?.z3?.[0] ?? Math.round(maxHR * 0.78);
  const evLt2 = ezHz?.z4?.[0] ?? Math.round(maxHR * 0.88);

  const heatmapData: { week: string; km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }[] = [];
  {
    const wm = new Map<string, { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }>();
    const threeYearsAgo = subDays(now, 3 * 365);
    for (const a of activities as Act[]) {
      if (a.startDate < threeYearsAgo) continue;
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const e = wm.get(wk) ?? { km: 0, timeSec: 0, bySport: {} };
      e.km += a.distance / 1000; e.timeSec += a.movingTime;
      const sport = normalizeActivitySport(a.sportType);
      if (!e.bySport[sport]) e.bySport[sport] = { km: 0, timeSec: 0 };
      e.bySport[sport].km += a.distance / 1000; e.bySport[sport].timeSec += a.movingTime;
      wm.set(wk, e);
    }
    for (const [week, v] of wm) heatmapData.push({ week, km: Math.round(v.km * 10) / 10, timeSec: Math.round(v.timeSec), bySport: Object.fromEntries(Object.entries(v.bySport).map(([s, d]) => [s, { km: Math.round(d.km * 10) / 10, timeSec: Math.round(d.timeSec) }])) });
    heatmapData.sort((a, b) => a.week.localeCompare(b.week));
  }

  const monthlyOverlay: { month: string; year: number; km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }[] = [];
  {
    const mm = new Map<string, { km: number; timeSec: number; bySport: Record<string, { km: number; timeSec: number }> }>();
    for (const a of activities as Act[]) {
      const key = `${a.startDate.getFullYear()}-${format(a.startDate, "MM")}`;
      if (!mm.has(key)) mm.set(key, { km: 0, timeSec: 0, bySport: {} });
      const e = mm.get(key)!;
      e.km += a.distance / 1000; e.timeSec += a.movingTime;
      const sport = normalizeActivitySport(a.sportType);
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

  type IntensityBucket = { easy: number; tempo: number; hard: number };
  const intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[] = [];
  {
    const mm = new Map<string, { total: IntensityBucket; bySport: Record<string, IntensityBucket> }>();
    for (const a of activities as Act[]) {
      if (!a.averageHeartrate || a.distance < 2000) continue;
      const key = format(a.startDate, "yyyy-MM");
      if (!mm.has(key)) mm.set(key, { total: { easy: 0, tempo: 0, hard: 0 }, bySport: {} });
      const e = mm.get(key)!;
      const min = a.movingTime / 60;
      const sport = normalizeActivitySport(a.sportType);
      if (!e.bySport[sport]) e.bySport[sport] = { easy: 0, tempo: 0, hard: 0 };
      const bucket = (b: IntensityBucket) => {
        if (a.averageHeartrate! < evLt1) b.easy += min;
        else if (a.averageHeartrate! < evLt2) b.tempo += min;
        else b.hard += min;
      };
      bucket(e.total); bucket(e.bySport[sport]);
    }
    for (const [month, d] of [...mm.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24)) {
      intensityProfile.push({
        month,
        easyMin: Math.round(d.total.easy), tempoMin: Math.round(d.total.tempo), hardMin: Math.round(d.total.hard),
        bySport: Object.fromEntries(Object.entries(d.bySport).map(([s, b]) => [s, { easyMin: Math.round(b.easy), tempoMin: Math.round(b.tempo), hardMin: Math.round(b.hard) }])),
      });
    }
  }

  const vdotTrend: { month: string; vdot: number }[] = [];
  {
    for (let i = 0; i < 30; i++) {
      const windowEnd = subDays(now, i * 30);
      const windowStart = subDays(windowEnd, 90);
      const windowActs = (activities as Act[]).filter(a => a.startDate >= windowStart && a.startDate <= windowEnd);
      if (windowActs.length < 5) continue;
      const v = estimateVO2max(
        windowActs.map(a => ({ distanceM: a.distance, timeSec: a.movingTime, avgHR: a.averageHeartrate, isRace: a.isRace, sportType: a.sportType, name: a.name, startDate: a.startDate })),
        maxHR, restHR,
      );
      const month = format(windowEnd, "yyyy-MM");
      if (!vdotTrend.find(x => x.month === month)) vdotTrend.push({ month, vdot: Math.round(v.vdot * 10) / 10 });
    }
    vdotTrend.sort((a, b) => a.month.localeCompare(b.month));
  }

  const terrainFactor = (() => {
    const olRuns = (activities as Act[]).filter(a =>
      /orienteer|ol\b|ol-|olpass/i.test(a.sportType) || /\bol\b|\borienteringsl|\bskogsl/i.test(a.name ?? "")
    );
    const roadRuns = (activities as Act[]).filter(a =>
      /run|trail/i.test(a.sportType) && a.averageSpeed && a.averageHeartrate &&
      a.averageHeartrate > evLt1 * 0.9 && a.averageHeartrate < evLt2 &&
      !/orienteer|ol\b/i.test(a.sportType) && !/\bol\b/i.test(a.name ?? "")
    );
    const olWithSpeed = olRuns.filter(a => a.averageSpeed);
    const roadWithSpeed = roadRuns.filter(a => a.averageSpeed);
    if (olWithSpeed.length < 5 || roadWithSpeed.length < 10) return null;
    return {
      olPaceSecPerKm: Math.round(olWithSpeed.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / olWithSpeed.length),
      roadPaceSecPerKm: Math.round(roadWithSpeed.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / roadWithSpeed.length),
      olSessions: olRuns.length,
      roadSessions: roadRuns.length,
    };
  })();

  // ── LT/AT pace trend (Option B: statistical, incremental) ──────────────────
  // Historical months: computed once and stored — history never changes.
  // Current month: always recomputed on each sync.
  type LTPacePoint = { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number };
  const ltPaceTrend: LTPacePoint[] = [];
  {
    const currentMonth = format(now, "yyyy-MM");
    const existingLtTrend = ((existingCache?.extraVizJson as { ltPaceTrend?: LTPacePoint[] } | null)?.ltPaceTrend ?? []);
    const historical = existingLtTrend.filter(p => p.month < currentMonth);
    const historicalKeys = new Set(historical.map(p => p.month));
    ltPaceTrend.push(...historical);

    type TrendAct = Act & { laps?: unknown };

    // Per-window: same shared estimateZonesFromActivities() pipeline updateHRZones() uses for
    // the live calibration, just anchored to a historical asOf date — guarantees the trend's
    // current-month point can never diverge from what "Apply zones" would actually produce.
    for (let i = 0; i < 30; i++) {
      const windowEnd = subDays(now, i * 30);
      const month = format(windowEnd, "yyyy-MM");
      // Skip historical months already stored — only compute missing + always recompute current month
      if (month < currentMonth && historicalKeys.has(month)) continue;

      const actsUpToWindow = (activities as TrendAct[]).filter(a => a.startDate <= windowEnd);
      const result = estimateZonesFromActivities(actsUpToWindow, maxHR, restHR, windowEnd);
      if (result && !ltPaceTrend.find(p => p.month === month)) {
        ltPaceTrend.push({ month, lt1PaceSecPerKm: result.lt1PaceSecPerKm, lt2PaceSecPerKm: result.lt2PaceSecPerKm, r2: result.rSquared });
      }
    }
    ltPaceTrend.sort((a, b) => a.month.localeCompare(b.month));

    // Smooth: remove single-month isolated spikes (±15s from both neighbors)
    // then cap month-over-month improvement at 20s (physiological rate limit)
    const smoothed = smoothLTTrend(ltPaceTrend);
    ltPaceTrend.length = 0;
    ltPaceTrend.push(...smoothed);
  }

  // ── Easy pace trend (all 5 years — cached so fast path gets full history) ──
  type EasyPacePoint = { month: string; medianGap: number; avgHR: number; count: number };
  const easyPaceTrend: EasyPacePoint[] = [];
  {
    const lt1HR = hz?.z3?.[0] ?? Math.round(maxHR * 0.83);
    const byMonth = new Map<string, Array<{ gap: number; hr: number }>>();
    for (const a of activities) {
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
    for (const [month, pts] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (pts.length < 3) continue;
      const sorted = [...pts].sort((a, b) => a.gap - b.gap);
      const mid = Math.floor(sorted.length / 2);
      const medianGap = sorted.length % 2 === 0
        ? (sorted[mid - 1].gap + sorted[mid].gap) / 2
        : sorted[mid].gap;
      easyPaceTrend.push({
        month,
        medianGap: Math.round(medianGap),
        avgHR: Math.round(pts.reduce((s, p) => s + p.hr, 0) / pts.length),
        count: pts.length,
      });
    }
  }

  const extraVizJson = { heatmapData, monthlyOverlay, intensityProfile, vdotTrend, terrainFactor: terrainFactor ?? null, perfByDistYear: [], ltPaceTrend, easyPaceTrend };

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
    vo2maxBreakdownJson: vo2maxResult.breakdown ?? {},
    decouplingLt1HR:   decouplingResult?.lt1HR    ?? undefined,
    decouplingRunsUsed: decouplingResult?.runsUsed ?? undefined,
    criticalSpeedMs:   csResult?.csMetersPerSec   ?? undefined,
    wPrimeMeters:      csResult?.wPrimeMeters      ?? undefined,
    extraVizJson:       extraVizJson as object,
    // statZonesJson / statZonesLapsJson intentionally omitted — zone estimation results
    // are only written by updateHRZones (calibration button). Auto-sync must not
    // overwrite them because the estimate is sensitive to newly backfilled laps and
    // drifts unexpectedly between explicit calibrations.
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
  const [profile, activities, garminRecent, existingCacheForZones] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    loadActivitiesLight(userId),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 7) } },
      orderBy: { date: "asc" }, select: { restingHR: true },
    }),
    prisma.fitnessCache.findUnique({ where: { userId }, select: { restHR: true, tsb: true } }),
  ]);

  const acts = activities as ActLight[];
  const artifactCap = profile?.maxHRArtifactCap ?? MAXHR_ARTIFACT_CAP;
  const maxHRs = acts.flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  // Clean observed max: remove artifact spikes before using as filter threshold
  // Raw max(maxHRs) can be 220-230 bpm from optical sensor glitches — totally wrong
  const cleanMaxHRs = maxHRs.filter(h => h <= artifactCap);
  const sortedCleanMaxHRs = [...cleanMaxHRs].sort((a, b) => a - b);
  const observedMax = sortedCleanMaxHRs.length > 0
    ? sortedCleanMaxHRs[Math.floor(sortedCleanMaxHRs.length * 0.80)] // 80th percentile of clean values
    : 183;

  const raceMaxHRs = acts
    .filter(a => a.isRace || /tävl|race|lopp|mila|stafett|sic\b|parkrun/i.test(a.name ?? ""))
    .flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);

  const thresholdHRs = acts
    .filter(a => a.averageHeartrate && a.averageHeartrate > observedMax * 0.82
      && a.sportType.toLowerCase().includes("run"))
    .map(a => a.averageHeartrate!);

  // Statistical maxHR from ALL hard runs (bucket approach):
  // Collect clean maxHR values from all runs where effort was hard (avgHR > 80% of clean observedMax).
  // Use 85th percentile — much more data-rich than single-session interval source.
  const hardRunMaxHRs = acts
    .filter(a => a.maxHeartrate && a.averageHeartrate
      && a.averageHeartrate > observedMax * 0.78   // hard effort (near LT1+)
      && /run|trail/i.test(a.sportType)
      && a.maxHeartrate <= artifactCap)
    .map(a => a.maxHeartrate!);
  const hardRunClean = [...hardRunMaxHRs].sort((a,b)=>a-b);
  const statisticalMax = hardRunClean.length >= 5
    ? hardRunClean[Math.floor(hardRunClean.length * 0.80)]  // 80th pct — well-trained athletes rarely hit true max
    : null;

  // Priority for BUTTON-PRESS estimation:
  // 1. profile.maxHeartRate — ONLY if user MANUALLY entered it in Settings
  //    (We track this by never writing to profile from this function)
  // 2. Estimate from data — races, statistical, threshold, percentile
  // restHR: profile (manual) > Garmin sensor > previous cache value > 50
  const maxHR = profile?.maxHeartRate    // manual override wins always
    ?? estimateMaxHRFromRaces(raceMaxHRs, artifactCap)
    ?? statisticalMax
    ?? estimateMaxHRFromThreshold(thresholdHRs)
    ?? estimateMaxHR(maxHRs, artifactCap);
  const restHR = profile?.restingHeartRate   // manual override wins
    ?? garminRecent.at(-1)?.restingHR
    ?? existingCacheForZones?.restHR          // previous calibration (not from profile!)
    ?? 50;

  const racePBs = await loadRacePBs(userId);

  // ── Method 1: Race-PB based LT estimation ─────────────────────────────
  const lt = estimateLTFromRaces(racePBs, maxHR, restHR);
  let hrZones = lt.source === "race-pbs"
    ? buildHRZonesFromLT(lt, maxHR, restHR)
    : buildHRZones(maxHR, restHR);

  // ── Method 2: Statistical zone analysis from bucketed training data ───
  // Same shared estimateZonesFromActivities() pipeline as updateVO2maxAndPaces()'s rolling
  // trend — see that function's call site and zones.ts's doc comment for why (they must
  // never diverge: this is what "Apply zones" actually applies).
  const statResult = estimateZonesFromActivities(
    (acts as (ActLight & { laps?: unknown })[]).filter(a => /run|trail/i.test(a.sportType)),
    maxHR, restHR,
  );
  let zonesMethod: "statistical" | "race-pbs" | "fallback" | "manual" = "fallback";
  let rSquared: number | undefined;
  // Default to formula-based zones (standard percentages) when statistical is unavailable
  hrZones = buildHRZones(maxHR, restHR);
  let calibLT1HR: number = hrZones.z2[1];
  let calibLT2HR: number = hrZones.z4[0];

  if (statResult && statResult.rSquared >= 0.80) {
    hrZones = statResult.zones;
    zonesMethod = "statistical";
    rSquared = statResult.rSquared;
    calibLT1HR = statResult.lt1HR;
    calibLT2HR = statResult.lt2HR;
    console.log(`[zones] Statistical analysis applied: LT1=${statResult.lt1HR}bpm LT2=${statResult.lt2HR}bpm R²=${statResult.rSquared} (${statResult.bucketCount} buckets)`);
  } else {
    if (statResult) rSquared = statResult.rSquared;
    console.log(`[zones] Statistical analysis insufficient (R²=${statResult?.rSquared ?? "n/a"}) — using formula defaults`);
  }

  // Manual LT1/LT2 override — wins over all estimation if both are set.
  // Never written by estimation; only set by the user in Settings.
  const manualLT1 = profile?.manualLT1HR;
  const manualLT2 = profile?.manualLT2HR;
  if (manualLT1 && manualLT2 && manualLT1 < manualLT2 && manualLT2 < maxHR) {
    const overrideZones = buildHRZonesFromLT(
      { lt1HR: manualLT1, lt2HR: manualLT2, lt1PaceSecPerKm: 0, lt2PaceSecPerKm: 0, source: "race-pbs" },
      maxHR, restHR,
    );
    if (ensureValidZones(overrideZones)) {
      hrZones = overrideZones;
      zonesMethod = "manual";
      calibLT1HR = manualLT1;
      calibLT2HR = manualLT2;
      console.log(`[zones] Manual LT override applied: LT1=${manualLT1}bpm LT2=${manualLT2}bpm`);
    }
  }

  // Final guard: if estimation produced non-monotonic zones, fall back to fixed percentages
  if (!ensureValidZones(hrZones)) {
    console.warn("[zones] Estimated zones failed validation — falling back to buildHRZones()");
    hrZones = buildHRZones(maxHR, restHR);
  }

  const thresholdHR = Math.round((hrZones.z4[0] + hrZones.z4[1]) / 2);
  const zonesJson = { z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3, z4: hrZones.z4, z5: hrZones.z5 };

  const zonesEightWeeksAgo = subDays(new Date(), 56);
  const zonesWkRunKm = new Map<string, number>();
  for (const a of acts) {
    if (!/run|trail/i.test(a.sportType) || a.startDate < zonesEightWeeksAgo) continue;
    const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    zonesWkRunKm.set(wk, (zonesWkRunKm.get(wk) ?? 0) + a.distance / 1000);
  }
  const zonesAvgWeeklyRunKm = [...zonesWkRunKm.values()].reduce((s, v) => s + v, 0) / 8;

  const vo2maxResult = estimateVO2max(
    acts.map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name,
      startDate: a.startDate, totalElevationGain: a.totalElevationGain,
    })),
    maxHR, restHR, racePBs, undefined, zonesAvgWeeklyRunKm,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);

  const anchorPB = racePBs
    .filter(p => p.timeSec > 60 && p.distanceM >= 1500)
    .reduce<RacePB | null>((best, p) => {
      if (!best) return p;
      return vdotFromRace(p.distanceM, p.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? p : best;
    }, null);
  const cachedTsb = existingCacheForZones?.tsb ?? 0;
  const predictionsJson = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2maxResult.vdot, meters);
    const riegel = anchorPB ? riegelPredict(anchorPB.timeSec, anchorPB.distanceM, meters) : null;
    const range = predictionRange(peak, meters);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, cachedTsb), riegel, rangeLo: range.lo, rangeHi: range.hi };
  });

  // Recompute zone distribution with the newly calibrated zones so charts update immediately.
  // Lap-aware: see computeZoneTime() doc comment.
  const twelveWeeksAgo = subDays(new Date(), 84);
  type ZoneMap2 = { z1:[number,number]; z2:[number,number]; z3:[number,number]; z4:[number,number]; z5:[number,number] };
  const hz2 = zonesJson as ZoneMap2;
  const { zoneSeconds: zoneSecondsJson, polZ1, polZ2, polZ3 } = computeZoneTime(acts as ZoneTimeActivity[], hz2, twelveWeeksAgo);
  const polTotal2 = polZ1 + polZ2 + polZ3;
  const polarisationJson = polTotal2 > 0
    ? { z1Pct: Math.round(polZ1/polTotal2*100), z2Pct: Math.round(polZ2/polTotal2*100), z3Pct: Math.round(polZ3/polTotal2*100) }
    : null;

  // statZonesJson must be written on BOTH create and update — omitting it from create left
  // the "Statistical threshold estimation" card with no value at all after the very first
  // calibration on a fresh/cleared cache row.
  // statZonesLapsJson is vestigial (laps-only result, no longer read anywhere — the card
  // reads statZonesJson) but kept null rather than dropping the column outright.
  const statZonesFields = {
    statZonesJson: (statResult ?? null) as object | null,
    statZonesLapsJson: null,
  };

  await prisma.fitnessCache.upsert({
    where: { userId },
    create: {
      userId, maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones), zoneSecondsJson, polarisationJson: polarisationJson ?? undefined,
      predictionsJson, vo2maxBreakdownJson: vo2maxResult.breakdown ?? {},
      ...statZonesFields,
    },
    update: { maxHR, restHR, thresholdHR, zones: zonesJson,
      vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot,
      confidence: vo2maxResult.confidence, method: vo2maxResult.method,
      paces: pacesJson(paceZones), zoneSecondsJson, polarisationJson: polarisationJson ?? undefined,
      predictionsJson, vo2maxBreakdownJson: vo2maxResult.breakdown ?? {},
      ...statZonesFields,
    },
  });

  // IMPORTANT: We do NOT write to AthleteProfile here.
  // AthleteProfile.maxHeartRate and restingHeartRate are ONLY set by the user in Settings.
  // Writing here would lock in a stale estimate that prevents future recalibration.
  // The calibration result is stored exclusively in FitnessCache.

  return { maxHR, restHR, thresholdHR, zones: zonesJson, vo2max: vo2maxResult.value, vdot: vo2maxResult.vdot, rSquared, zonesMethod, lt1HR: calibLT1HR, lt2HR: calibLT2HR };
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
