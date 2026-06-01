/**
 * Rolling monthly LT/AT estimator investigation script.
 * For each calendar month going back as far as data allows, runs estimateZones
 * on a rolling window ending that month. Tests multiple window sizes and configs
 * to find which combination gives the most stable, physiologically plausible trend.
 *
 * Usage: npx tsx scripts/rolling-lt-test.ts
 * Output: one row per month per config — pipe to a file for analysis.
 */
import { PrismaClient } from "@prisma/client";
import { subDays, format, addDays } from "date-fns";
import { gradeAdjustedPace } from "../lib/fitness/vo2max";

const prisma = new PrismaClient();

// ── OL filter ────────────────────────────────────────────────────────────────
function makeOlRaceFilter(olRacePaceThresholdSecPerKm: number) {
  return (name: string, sportType: string, isRace: boolean, averageSpeed: number | null) =>
    !/virtualrun/i.test(sportType) &&
    !/indoor|inomhus/i.test(name) &&
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
    (!isRace || (averageSpeed != null && 1000 / averageSpeed < olRacePaceThresholdSecPerKm));
}

const WU_CD_RE = /^\s*wu\b|^\s*cd\b|\bwarm.?up\b|\bcool.?down\b|\bnedvarvning\b|\buppvärmning\b/i;

type LapRow = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };
interface BucketPoint { pace: number; medianHR: number; count: number; totalWeight: number }
interface EstimateResult {
  lt1HR: number; lt2HR: number; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number;
  rSquared: number; bucketCount: number; lapCount: number;
}

function estimateZones(
  runs: Array<{ avgHR: number; distanceM: number; movingTimeSec: number; totalElevationGain: number;
                weatherTemp?: number | null; startDate?: Date; isRace?: boolean }>,
  maxHR: number,
  restHR: number,
  opts: {
    windowDays: number;
    minCount: number;
    asOf?: Date;
    halfLifeDays?: number;
    minEffWeight?: number;
    dataDrivenBounds?: boolean;
    verbose?: boolean;
  } = { windowDays: 90, minCount: 8 },
): EstimateResult | null {
  const refTime = (opts.asOf ?? new Date()).getTime();
  const recentCount = runs.filter(r => r.startDate && (refTime - r.startDate.getTime()) / 86400000 < 90).length;
  const halfLife = opts.halfLifeDays ?? (recentCount >= 40 ? 90 : 180);
  const minEffWeight = opts.minEffWeight ?? 8;
  const V = opts.verbose;

  const allValid = runs
    .filter(r =>
      r.avgHR > maxHR * 0.52 && r.avgHR < maxHR * 0.96 &&
      r.distanceM >= 800 && r.movingTimeSec >= 180 &&
      r.totalElevationGain / r.distanceM < 0.12
    )
    .flatMap(r => {
      const rawPace = r.movingTimeSec / (r.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, r.totalElevationGain, r.distanceM);
      const temp = r.weatherTemp ?? 15;
      if (temp > 30 || gap <= 200) return [];
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate ? (refTime - r.startDate.getTime()) / 86400000 : halfLife;
      const recency = Math.exp(-daysAgo / halfLife);
      const raceBoost = r.isRace ? 3.0 : 1.0;
      return [{ gap, hr: r.avgHR, weight: tempWeight * recency * raceBoost }];
    });

  const sortedRawGaps = allValid.map(p => p.gap).sort((a, b) => a - b);
  const gapPct = (p: number) =>
    sortedRawGaps[Math.max(0, Math.min(sortedRawGaps.length - 1, Math.floor(sortedRawGaps.length * p)))];
  const gapP60 = gapPct(0.60);
  const gapP85 = gapPct(0.85);

  const points = allValid.filter(p => opts.dataDrivenBounds ? p.gap > 200 : p.gap < 391);
  if (V) console.log(`  halfLife=${halfLife}  recentCount=${recentCount}  allValid=${allValid.length}  points=${points.length}`);
  if (points.length < 40) { if (V) console.log(`  [NULL] points < 40 (${points.length})`); return null; }

  const binWidth = 15;
  const bucketMap = new Map<number, Array<{ hr: number; w: number }>>();
  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => pts.reduce((s, p) => s + p.w, 0) >= minEffWeight)
    .map(([pace, pts]) => {
      const totalW = pts.reduce((s, p) => s + p.w, 0);
      const sortedByHR = [...pts].sort((a, b) => a.hr - b.hr);
      let cumW = 0, pct80HR = sortedByHR[sortedByHR.length - 1].hr;
      for (const pt of sortedByHR) { cumW += pt.w; if (cumW >= totalW * 0.80) { pct80HR = pt.hr; break; } }
      return { pace, medianHR: pct80HR, count: pts.length, totalWeight: totalW };
    })
    .sort((a, b) => a.pace - b.pace);

  if (V) {
    console.log(`  buckets pre-PAV (${buckets.length}):  [raw hinkMap had ${bucketMap.size} keys, ${bucketMap.size - buckets.length} dropped by minEffWeight=${minEffWeight}]`);
    for (const b of buckets) console.log(`    ${fmt(b.pace)}/km  HR=${b.medianHR.toFixed(1)}  n=${b.count}  w=${b.totalWeight.toFixed(1)}`);
  }

  const out = buckets.map(b => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].medianHR < out[i + 1].medianHR) {
        const tc = out[i].count + out[i + 1].count;
        const tw = out[i].totalWeight + out[i + 1].totalWeight;
        out.splice(i, 2, {
          pace:        (out[i].pace     * out[i].totalWeight + out[i + 1].pace     * out[i + 1].totalWeight) / tw,
          medianHR:    (out[i].medianHR * out[i].totalWeight + out[i + 1].medianHR * out[i + 1].totalWeight) / tw,
          count: tc, totalWeight: tw,
        });
        changed = true; break;
      }
    }
  }
  if (V) {
    console.log(`  buckets post-PAV (${out.length}):`);
    for (const b of out) console.log(`    ${fmt(b.pace)}/km  HR=${b.medianHR.toFixed(1)}  n=${b.count}  w=${b.totalWeight.toFixed(1)}`);
  }
  if (out.length < 6) { if (V) console.log(`  [NULL] buckets post-PAV < 6 (${out.length})`); return null; }

  const nb = out.length;
  const paceArr = out.map(b => b.pace);
  const hrArr   = out.map(b => b.medianHR);
  const bw      = out.map(b => 1 / Math.sqrt(b.count));

  function segErr(from: number, to: number): number {
    if (to - from < 2) return 0;
    const xs = paceArr.slice(from, to + 1), ys = hrArr.slice(from, to + 1), ws = bw.slice(from, to + 1);
    const tw = ws.reduce((s, w) => s + w, 0);
    const mx = xs.reduce((s, x, i) => s + x * ws[i], 0) / tw;
    const my = ys.reduce((s, y, i) => s + y * ws[i], 0) / tw;
    const sxy = xs.reduce((s, x, i) => s + ws[i] * (x - mx) * (ys[i] - my), 0);
    const sxx = xs.reduce((s, x, i) => s + ws[i] * (x - mx) ** 2, 0);
    if (sxx === 0) return 0;
    const slope = sxy / sxx;
    return ys.reduce((s, y, i) => s + ws[i] * (y - (my + slope * (xs[i] - mx))) ** 2, 0);
  }

  const slopes = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i + 1]) / (paceArr[i + 1] - p));
  const slopeMax = Math.max(...slopes);
  let bp1 = 1;
  // Start search at i=1: prevents placing LT2 at the fastest bucket (bp1=0),
  // which causes LT1 to fall too close in HR space when fast-pace data is sparse.
  for (let i = 1; i < slopes.length - 2; i++) {
    if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
  }

  let bestErr = Infinity, bp2 = Math.min(bp1 + 2, nb - 2);
  for (let j = bp1 + 1; j < nb - 1; j++) {
    const err = segErr(0, bp1) + segErr(bp1, j) + segErr(j, nb - 1);
    if (err < bestErr) { bestErr = err; bp2 = j; }
  }

  const tbw = bw.reduce((s, w) => s + w, 0);
  const meanHR  = hrArr.reduce((s, v, i) => s + v * bw[i], 0) / tbw;
  const totalVar = hrArr.reduce((s, v, i) => s + bw[i] * (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestErr / totalVar) * 100) / 100);
  if (V) console.log(`  slopes: [${slopes.map(s => s.toFixed(3)).join(", ")}]  slopeMax=${slopeMax.toFixed(3)}  bp1=${bp1}(${fmt(paceArr[bp1])})  bp2=${bp2}(${fmt(paceArr[bp2])})  R²=${rSquared}`);
  if (rSquared < 0.62) { if (V) console.log(`  [NULL] R²=${rSquared} < 0.62`); return null; }

  const lt2PaceSecPerKm = paceArr[bp1];
  const lt2HR = Math.round(hrArr[bp1]);
  const lt1PaceTarget = lt2PaceSecPerKm / 0.844;
  const lt1BucketIdx = paceArr.findIndex(p => p >= lt1PaceTarget);
  let lt1HR: number, lt1PaceSecPerKm: number;
  if (lt1BucketIdx === -1) {
    lt1HR = Math.round(hrArr[bp2]); lt1PaceSecPerKm = Math.round(paceArr[bp2]);
  } else if (lt1BucketIdx === 0) {
    lt1HR = Math.round(hrArr[0]); lt1PaceSecPerKm = Math.round(lt1PaceTarget);
  } else {
    const t = (lt1PaceTarget - paceArr[lt1BucketIdx - 1]) / (paceArr[lt1BucketIdx] - paceArr[lt1BucketIdx - 1]);
    lt1HR = Math.round(hrArr[lt1BucketIdx - 1] + t * (hrArr[lt1BucketIdx] - hrArr[lt1BucketIdx - 1]));
    lt1PaceSecPerKm = Math.round(lt1PaceTarget);
  }

  if (lt1HR >= lt2HR - 5)                              { if (V) console.log(`  [NULL] lt1HR(${lt1HR}) >= lt2HR(${lt2HR})-5`); return null; }
  if (lt2HR >= maxHR * 0.98)                           { if (V) console.log(`  [NULL] lt2HR(${lt2HR}) >= maxHR*0.98`); return null; }
  if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70)   { if (V) console.log(`  [NULL] HR range: lt1HR=${lt1HR} lt2HR=${lt2HR}`); return null; }
  if (lt2PaceSecPerKm >= lt1PaceSecPerKm)              { if (V) console.log(`  [NULL] lt2Pace >= lt1Pace`); return null; }

  if (opts.dataDrivenBounds) {
    if (lt2PaceSecPerKm > gapP60) { if (V) console.log(`  [NULL] lt2Pace(${fmt(lt2PaceSecPerKm)}) > P60(${fmt(gapP60)})`); return null; }
    if (lt1PaceSecPerKm > gapP85) { if (V) console.log(`  [NULL] lt1Pace(${fmt(lt1PaceSecPerKm)}) > P85(${fmt(gapP85)})`); return null; }
  } else {
    if (lt1PaceSecPerKm < 240 || lt1PaceSecPerKm > 380) { if (V) console.log(`  [NULL] lt1Pace(${fmt(lt1PaceSecPerKm)}) outside [4:00–6:20]`); return null; }
    if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) { if (V) console.log(`  [NULL] lt2Pace(${fmt(lt2PaceSecPerKm)}) outside [3:20–7:00]`); return null; }
  }

  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length, lapCount: runs.length };
}

function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`; }

type ActFull = {
  name: string; sportType: string; startDate: Date; laps: unknown;
  isRace: boolean | null; averageSpeed: number | null; weatherTemp?: number | null;
};

function buildLaps(acts: ActFull[], olFilter: ReturnType<typeof makeOlRaceFilter>) {
  return acts
    .filter(a =>
      olFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) &&
      !WU_CD_RE.test(a.name) &&
      Array.isArray(a.laps)
    )
    .flatMap(a =>
      (a.laps as LapRow[])
        .filter(l => l.average_heartrate && l.distance >= 800 && l.moving_time >= 180)
        .map(l => ({
          avgHR: l.average_heartrate!, distanceM: l.distance, movingTimeSec: l.moving_time,
          totalElevationGain: l.total_elevation_gain ?? 0, startDate: a.startDate,
          isRace: a.isRace ?? false, weatherTemp: (a as ActFull).weatherTemp ?? null,
        }))
    );
}

function bootstrapOlThreshold(acts: ActFull[], maxHR: number, restHR: number, asOf?: Date): number {
  const nameOnly = makeOlRaceFilter(Infinity);
  const phase1Laps = buildLaps(acts, nameOnly);
  const prelim = estimateZones(phase1Laps, maxHR, restHR, {
    windowDays: 90, minCount: 8, asOf,
  });
  if (!prelim) return 330;
  return Math.round(prelim.lt1PaceSecPerKm * 1.15);
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user");
  const cache = await prisma.fitnessCache.findUnique({ where: { userId: user.id }, select: { maxHR: true, restHR: true } });
  const maxHR = cache?.maxHR ?? 184;
  const restHR = cache?.restHR ?? 43;
  console.log(`maxHR=${maxHR}  restHR=${restHR}`);

  // Load ALL activities with laps for the maximum possible history
  const allActs = await prisma.activity.findMany({
    where: { userId: user.id, sportType: { contains: "run", mode: "insensitive" } },
    select: { name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true, weatherTemp: true },
    orderBy: { startDate: "asc" },
  }) as ActFull[];

  console.log(`Total activities: ${allActs.length}\n`);

  // ── Window configurations to compare ─────────────────────────────────────
  // windowDays: null = all history up to windowEnd (same as live estimator, just asOf-shifted)
  const CONFIGS: Array<{ label: string; windowDays: number | null; halfLifeDays?: number; minCount: number; minEffWeight?: number }> = [
    { label: "ALL  HL-auto", windowDays: null, minCount: 8 },             // ← proposed new prod config
    { label: "ALL  HL365  ", windowDays: null, halfLifeDays: 365, minEffWeight: 4, minCount: 8 },  // historical exploration
    { label: "W90  HL-auto", windowDays:  90,  minCount: 8 },
    { label: "W180 HL-auto", windowDays: 180,  minCount: 8 },
  ];

  // ── Monthly rolling windows ───────────────────────────────────────────────
  const now = new Date();
  const firstLapDate = allActs[0]?.startDate ?? subDays(now, 365);
  const windowEnds: Date[] = [];
  let d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d >= addDays(firstLapDate, 90)) {
    windowEnds.unshift(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }

  console.log(`Monthly windows: ${windowEnds.length}  (${format(windowEnds[0], "yyyy-MM")} → ${format(windowEnds.at(-1)!, "yyyy-MM")})\n`);

  await diagnose(allActs, maxHR, restHR);

  // ── Collect ALL HL-auto results for smoothing comparison ─────────────────
  console.log(`${"Month".padEnd(8)}  ${"Config".padEnd(14)}  LT2          LT1          R²     Laps   OL_thr`);
  console.log("-".repeat(80));

  type TrendPoint = { month: string; lt2Sec: number; lt1Sec: number };
  const allHlResults: TrendPoint[] = [];

  for (const windowEnd of windowEnds) {
    const month = format(windowEnd, "yyyy-MM");
    let any = false;

    // Per-window OL bootstrap: threshold is computed from acts up to windowEnd
    // with asOf=windowEnd, so historical windows get historically-appropriate thresholds.
    const actsUpToWindow = allActs.filter(a => a.startDate <= windowEnd);
    const windowOlThreshold = bootstrapOlThreshold(actsUpToWindow, maxHR, restHR, windowEnd);
    const windowOlFilter = makeOlRaceFilter(windowOlThreshold);
    const windowAllLaps = buildLaps(actsUpToWindow, windowOlFilter);

    for (const cfg of CONFIGS) {
      const windowLaps = cfg.windowDays === null
        ? windowAllLaps
        : windowAllLaps.filter(l => l.startDate >= subDays(windowEnd, cfg.windowDays!));
      if (windowLaps.length < 40) continue;

      const result = estimateZones(windowLaps, maxHR, restHR, {
        windowDays: cfg.windowDays ?? 9999,
        halfLifeDays: cfg.halfLifeDays,
        minCount: cfg.minCount,
        minEffWeight: cfg.minEffWeight,
        asOf: windowEnd,
      });

      if (result) {
        any = true;
        console.log(
          `${month}    ${cfg.label}  LT2=${fmt(result.lt2PaceSecPerKm)}/km  LT1=${fmt(result.lt1PaceSecPerKm)}/km  R²=${result.rSquared.toFixed(2)}  n=${windowLaps.length}  ol=${fmt(windowOlThreshold)}`
        );
        if (cfg.label === "ALL  HL-auto") {
          allHlResults.push({ month, lt2Sec: result.lt2PaceSecPerKm, lt1Sec: result.lt1PaceSecPerKm });
        }
      } else if (any) {
        // Only print null lines for months where at least one config already succeeded
        console.log(`${month}    ${cfg.label}  — (null)`);
      }
    }
    if (any) console.log();
  }

  // ── Smoothing comparison ─────────────────────────────────────────────────
  const smoothed = smoothTrend(allHlResults);
  console.log("\n\n═══ ALL HL-auto: raw vs smoothed ═══\n");
  console.log(`${"Month".padEnd(8)}  ${"Raw LT2".padEnd(10)}  ${"Sm LT2".padEnd(8)}  ${"Raw LT1".padEnd(10)}  ${"Sm LT1".padEnd(8)}  Notes`);
  console.log("-".repeat(72));
  for (let i = 0; i < allHlResults.length; i++) {
    const r = allHlResults[i];
    const s = smoothed[i];
    const d2 = Math.round(r.lt2Sec - s.lt2Sec);
    const d1 = Math.round(r.lt1Sec - s.lt1Sec);
    const notes = [
      d2 !== 0 ? `LT2${d2 > 0 ? "+" : ""}${d2}s` : "",
      d1 !== 0 ? `LT1${d1 > 0 ? "+" : ""}${d1}s` : "",
    ].filter(Boolean).join("  ");
    console.log(`${r.month}    ${fmt(r.lt2Sec)}/km    ${fmt(s.lt2Sec)}/km  ${fmt(r.lt1Sec)}/km    ${fmt(s.lt1Sec)}/km  ${notes}`);
  }
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function smoothTrend(points: Array<{ month: string; lt2Sec: number; lt1Sec: number }>) {
  if (points.length < 2) return points;
  const result = points.map(p => ({ ...p }));

  // Pass 1: remove isolated outliers — a point ≥15s different from BOTH neighbors,
  // but only when both neighbors are exactly 1 month away (no gap).
  const OUTLIER_THRESHOLD = 15;
  for (let i = 1; i < result.length - 1; i++) {
    if (monthDiff(result[i - 1].month, result[i].month) !== 1) continue;
    if (monthDiff(result[i].month, result[i + 1].month) !== 1) continue;
    for (const key of ["lt2Sec", "lt1Sec"] as const) {
      const prev = result[i - 1][key];
      const curr = result[i][key];
      const next = result[i + 1][key];
      const isFasterThanBoth = curr <= prev - OUTLIER_THRESHOLD && curr <= next - OUTLIER_THRESHOLD;
      const isSlowerThanBoth = curr >= prev + OUTLIER_THRESHOLD && curr >= next + OUTLIER_THRESHOLD;
      if (isFasterThanBoth || isSlowerThanBoth) {
        (result[i] as unknown as Record<string, number>)[key] = (prev + next) / 2;
      }
    }
  }

  // Pass 2: cap rate of change — no more than 20s/km improvement per month.
  // Only applied between consecutive months (gap = 1). Larger gaps allow any improvement.
  const MAX_IMPROVEMENT_PER_MONTH = 20;
  for (let i = 1; i < result.length; i++) {
    if (monthDiff(result[i - 1].month, result[i].month) !== 1) continue;
    if (result[i].lt2Sec < result[i - 1].lt2Sec - MAX_IMPROVEMENT_PER_MONTH) {
      const cap = result[i - 1].lt2Sec - MAX_IMPROVEMENT_PER_MONTH;
      const lt1Cap = result[i - 1].lt1Sec - MAX_IMPROVEMENT_PER_MONTH * (result[i].lt1Sec / result[i].lt2Sec);
      result[i] = { ...result[i], lt2Sec: cap, lt1Sec: lt1Cap };
    }
  }

  return result;
}

async function diagnose(allActs: ActFull[], maxHR: number, restHR: number) {
  const diagMonths = ["2020-08", "2021-02"];
  console.log("\n\n═══ DIAGNOSTICS for historical months ═══\n");
  for (const monthStr of diagMonths) {
    const windowEnd = new Date(monthStr + "-01");
    const actsUpTo = allActs.filter(a => a.startDate <= windowEnd);
    const olThreshold = bootstrapOlThreshold(actsUpTo, maxHR, restHR, windowEnd);
    const olFilter = makeOlRaceFilter(olThreshold);
    const windowLaps = buildLaps(actsUpTo, olFilter);
    const actsInWindow = actsUpTo.filter(a => olFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) && !WU_CD_RE.test(a.name));
    console.log(`── ${monthStr}  (${actsUpTo.length} acts, ${actsInWindow.length} eligible acts, ${windowLaps.length} laps, OL threshold: ${fmt(olThreshold)}/km) ──`);
    console.log(`   ALL HL-auto:`);
    estimateZones(windowLaps, maxHR, restHR, { windowDays: 9999, minCount: 8, asOf: windowEnd, verbose: true });
    console.log(`   ALL HL365 minEW=4:`);
    estimateZones(windowLaps, maxHR, restHR, { windowDays: 9999, halfLifeDays: 365, minEffWeight: 4, minCount: 8, asOf: windowEnd, verbose: true });
    console.log();
  }
}

main().finally(() => prisma.$disconnect());
