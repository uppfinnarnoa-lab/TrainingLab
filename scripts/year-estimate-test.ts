/**
 * Standalone test: run the zone estimator algorithm in various configurations.
 * Edit algorithm variants here — copy confirmed-working version to zones.ts afterwards.
 * Does NOT import from lib/fitness/zones.ts to avoid polluting production.
 */
import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";
import { gradeAdjustedPace } from "../lib/fitness/vo2max";

const prisma = new PrismaClient();

// ── Filters (matching cache.ts olRaceFilterLight exactly) ──────────────────
const olRaceFilter = (name: string, sportType: string, isRace: boolean, averageSpeed: number | null) =>
  !/virtualrun/i.test(sportType) &&
  !/indoor|inomhus/i.test(name) &&
  !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
  (!isRace || (averageSpeed != null && 1000 / averageSpeed < 330));

type LapRow = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };

interface BucketPoint { pace: number; medianHR: number; count: number; totalWeight: number }

interface EstimateResult {
  lt1HR: number; lt2HR: number; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number;
  rSquared: number; bucketCount: number;
}

/**
 * Algorithm variants to test:
 *   useWeightThreshold: true → only use data within ~14 months (weight > 0.01, halfLife=90)
 *                       false → use ALL data (original b41a45e behavior — no threshold)
 *   minCount: minimum laps per bucket (original was 15)
 *   weightedP80: true → weighted percentile (recency/race weights applied to P80)
 *                false → unweighted (count-based) P80
 *   effectiveWeightMin: true → minCount checks sum of weights, not count
 *   lt2HRfloor: if set, only allow bp1 where hrArr[bp1] >= lt2HRfloor (e.g. 0.87 * maxHR)
 *   allowBp1Zero: if true, the bp1 search starts at 0 instead of 1
 */
function estimateZones(
  runs: Array<{ avgHR: number; distanceM: number; movingTimeSec: number; totalElevationGain: number;
                weatherTemp?: number | null; startDate?: Date; isRace?: boolean }>,
  maxHR: number,
  restHR: number,
  opts: {
    useWeightThreshold: boolean; minCount: number; asOf?: Date; verbose?: boolean;
    weightedP80?: boolean; effectiveWeightMin?: boolean; lt2HRfloor?: number; allowBp1Zero?: boolean;
    useSlopeDetection?: boolean;
  } = { useWeightThreshold: false, minCount: 15 },
): EstimateResult | null {
  const refTime = (opts.asOf ?? new Date()).getTime();

  const recentCount = runs.filter(r => r.startDate && (refTime - r.startDate.getTime()) / 86400000 < 90).length;
  const halfLife = recentCount >= 40 ? 90 : 180;

  const points = runs
    .filter(r =>
      r.avgHR > maxHR * 0.52 && r.avgHR < maxHR * 0.96 &&
      r.distanceM >= 800 && r.movingTimeSec >= 180 &&
      r.totalElevationGain / r.distanceM < 0.12
    )
    .map(r => {
      const rawPace = r.movingTimeSec / (r.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, r.totalElevationGain, r.distanceM);
      const temp = r.weatherTemp ?? 15;
      if (temp > 30) return null;
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate ? (refTime - r.startDate.getTime()) / 86400000 : halfLife;
      const recency = Math.exp(-daysAgo / halfLife);
      const raceBoost = r.isRace ? 3.0 : 1.0;
      const weight = tempWeight * recency * raceBoost;
      return { gap, hr: r.avgHR, weight };
    })
    .filter((p): p is NonNullable<typeof p> => {
      if (!p || p.gap <= 200 || p.gap >= 391) return false;
      if (opts.useWeightThreshold && p.weight <= 0.01) return false;
      return true;
    });

  if (points.length < 40) return null;

  const binWidth = 15;
  const bucketMap = new Map<number, Array<{ hr: number; w: number }>>();
  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => {
      if (opts.effectiveWeightMin) return pts.reduce((s, p) => s + p.w, 0) >= opts.minCount;
      return pts.length >= opts.minCount;
    })
    .map(([pace, pts]) => {
      const totalW = pts.reduce((s, p) => s + p.w, 0);
      let pct80HR: number;
      if (opts.weightedP80) {
        // Weighted P80: accumulate weight until 80% covered
        const sortedByHR = [...pts].sort((a, b) => a.hr - b.hr);
        let cumW = 0;
        pct80HR = sortedByHR[sortedByHR.length - 1].hr;
        for (const pt of sortedByHR) { cumW += pt.w; if (cumW >= totalW * 0.80) { pct80HR = pt.hr; break; } }
      } else {
        const sortedHR = pts.map(p => p.hr).sort((a, b) => a - b);
        pct80HR = sortedHR[Math.min(Math.floor(sortedHR.length * 0.80), sortedHR.length - 1)];
      }
      return { pace, medianHR: pct80HR, count: pts.length, totalWeight: totalW };
    })
    .sort((a, b) => a.pace - b.pace);

  if (opts.verbose) {
    console.log(`  Points: ${points.length}  halfLife: ${halfLife}  recentCount: ${recentCount}`);
    console.log(`  Raw buckets (pace/HR/count) — before PAV:`);
    for (const b of buckets) console.log(`    ${fmt(b.pace)}/km  HR=${b.medianHR}  n=${b.count}`);
  }

  // Pool-adjacent-violators for monotonicity
  const out = buckets.map(b => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].medianHR < out[i + 1].medianHR) {
        const tc = out[i].count + out[i + 1].count;
        const tw = out[i].totalWeight + out[i + 1].totalWeight;
        out.splice(i, 2, {
          pace: (out[i].pace * out[i].count + out[i + 1].pace * out[i + 1].count) / tc,
          medianHR: (out[i].medianHR * out[i].count + out[i + 1].medianHR * out[i + 1].count) / tc,
          count: tc,
          totalWeight: tw,
        });
        changed = true; break;
      }
    }
  }
  if (opts.verbose) {
    console.log(`  After PAV (${out.length} buckets):`);
    for (const b of out) console.log(`    ${fmt(b.pace)}/km  HR=${b.medianHR.toFixed(1)}  n=${b.count}`);
  }
  if (out.length < 6) return null;

  const nb = out.length;
  const paceArr = out.map(b => b.pace);
  const hrArr = out.map(b => b.medianHR);
  // Original: count-based reciprocal weights (1/sqrt(count))
  const bucketWeights = out.map(b => 1 / Math.sqrt(b.count));

  function segErr(from: number, to: number): number {
    if (to - from < 2) return 0;
    const xs = paceArr.slice(from, to + 1), ys = hrArr.slice(from, to + 1), ws = bucketWeights.slice(from, to + 1);
    const totalW = ws.reduce((s, w) => s + w, 0);
    const mx = xs.reduce((s, x, i) => s + x * ws[i], 0) / totalW;
    const my = ys.reduce((s, y, i) => s + y * ws[i], 0) / totalW;
    const sxy = xs.reduce((s, x, i) => s + ws[i] * (x - mx) * (ys[i] - my), 0);
    const sxx = xs.reduce((s, x, i) => s + ws[i] * (x - mx) ** 2, 0);
    if (sxx === 0) return 0;
    const b = sxy / sxx;
    return ys.reduce((s, y, i) => s + ws[i] * (y - (my + b * (xs[i] - mx))) ** 2, 0);
  }

  // ── Slope-based LT2 detection ─────────────────────────────────────────
  // Scan from the fastest bucket. Find the first transition where the
  // HR-pace slope makes a significant jump (plateau → descent). "Significant"
  // = slope exceeds 20% of the steepest slope anywhere in the curve.
  // This is fully data-driven: the threshold scales with the curve's own
  // steepness, no absolute HR value or maxHR% is referenced.
  let bp1 = 1;
  if (opts.useSlopeDetection) {
    const slopes = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i+1]) / (paceArr[i+1] - p));
    const slopeMax = Math.max(...slopes);
    const slopeThreshold = 0.20 * slopeMax;
    bp1 = 1; // fallback: use 2nd bucket
    for (let i = 0; i < slopes.length - 2; i++) {
      if (slopes[i] > slopeThreshold) { bp1 = i; break; }
    }
    if (opts.verbose) console.log(`  Slope detection: slopeMax=${slopeMax.toFixed(4)}  threshold=${slopeThreshold.toFixed(4)}  bp1=${bp1} (${fmt(paceArr[bp1])})`);
  }

  // ── bp2 via regression (for LT1 fallback and R²) ──────────────────────
  const bp1Start = opts.useSlopeDetection ? bp1 : (opts.allowBp1Zero ? 0 : 1);
  const lt2Floor = opts.lt2HRfloor ?? 0;
  let bestErr = Infinity, bp2 = Math.min(bp1 + 2, nb - 2);
  if (opts.useSlopeDetection) {
    // bp1 fixed; find best bp2 only
    for (let j = bp1 + 1; j < nb - 1; j++) {
      const err = segErr(0, bp1) + segErr(bp1, j) + segErr(j, nb - 1);
      if (err < bestErr) { bestErr = err; bp2 = j; }
    }
  } else {
    for (let i = bp1Start; i < nb - 2; i++) {
      if (hrArr[i] < lt2Floor) continue;
      for (let j = i + 1; j < nb - 1; j++) {
        const err = segErr(0, i) + segErr(i, j) + segErr(j, nb - 1);
        if (err < bestErr) { bestErr = err; bp1 = i; bp2 = j; }
      }
    }
  }

  const totalBW = bucketWeights.reduce((s, w) => s + w, 0);
  const meanHR = hrArr.reduce((s, v, i) => s + v * bucketWeights[i], 0) / totalBW;
  const totalVar = hrArr.reduce((s, v, i) => s + bucketWeights[i] * (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestErr / totalVar) * 100) / 100);
  if (opts.verbose) {
    console.log(`  bp1=${bp1} (${fmt(paceArr[bp1])})  bp2=${bp2} (${fmt(paceArr[bp2])})  R²=${rSquared}`);
  }
  if (rSquared < 0.62) return null;

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

  if (lt1HR >= lt2HR - 8) return null;
  if (lt2HR >= maxHR * 0.98) return null;
  if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70) return null;
  if (lt1PaceSecPerKm < 240 || lt1PaceSecPerKm > 380) return null;
  if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) return null;
  if (lt2PaceSecPerKm >= lt1PaceSecPerKm) return null;

  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length };
}

function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`; }

function printResult(label: string, result: EstimateResult | null, lapCount: number) {
  if (!result) {
    console.log(`${label}: insufficient data  (${lapCount} laps)`);
  } else {
    console.log(
      `${label}: LT1=${result.lt1HR}bpm @ ${fmt(result.lt1PaceSecPerKm)}  |  ` +
      `LT2=${result.lt2HR}bpm @ ${fmt(result.lt2PaceSecPerKm)}  |  ` +
      `R²=${result.rSquared.toFixed(3)}  |  ${result.bucketCount} buckets  |  ${lapCount} laps`
    );
  }
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user");
  const cache = await prisma.fitnessCache.findUnique({
    where: { userId: user.id },
    select: { maxHR: true, restHR: true },
  });
  const maxHR = cache?.maxHR ?? 184;
  const restHR = cache?.restHR ?? 45;
  console.log(`maxHR=${maxHR}  restHR=${restHR}\n`);

  // ── Per-year tests (asOf = year end, matching cache.ts olRaceFilter) ────
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2018 }, (_, i) => 2019 + i);

  for (const year of years) {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = year < currentYear ? new Date(`${year}-12-31T23:59:59Z`) : new Date();
    const asOf = end;

    const acts = await prisma.activity.findMany({
      where: { userId: user.id, startDate: { gte: start, lte: end }, sportType: { contains: "run", mode: "insensitive" } },
      select: { name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true, weatherTemp: true },
    });
    type Act = typeof acts[number];

    const laps = (acts as Act[])
      .filter(a => olRaceFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) && Array.isArray(a.laps))
      .flatMap(a =>
        (a.laps as LapRow[]).filter(l => l.average_heartrate && l.distance >= 800 && l.moving_time >= 180).map(l => ({
          avgHR: l.average_heartrate!, distanceM: l.distance, movingTimeSec: l.moving_time,
          totalElevationGain: l.total_elevation_gain ?? 0, startDate: a.startDate,
          isRace: a.isRace ?? false, weatherTemp: a.weatherTemp,
        }))
      );

    const verbose = year === 2025 || year === 2026;
    if (verbose) console.log(`\n── Verbose: ${year} (original) ──`);
    const result = estimateZones(laps, maxHR, restHR, { useWeightThreshold: true, minCount: 15, asOf, verbose });
    printResult(`${year} orig  `, result, laps.length);

    // Config K: slope detection (no HR floor)
    if (verbose) console.log(`\n── Verbose: ${year} (Config K: slope detection) ──`);
    const resultK = estimateZones(laps, maxHR, restHR, {
      useWeightThreshold: true, weightedP80: true, effectiveWeightMin: true, minCount: 8,
      useSlopeDetection: true, asOf, verbose });
    printResult(`${year} cfgK  `, resultK, laps.length);
  }

  // ── LIVE: exactly matching cache.ts updateHRZones → statZonesLapsJson ──
  console.log("\n── LIVE (5-year window, laps-only = statZonesLapsJson) ──");
  const fiveYearsAgo = subDays(new Date(), 5 * 365);

  const liveActs = await prisma.activity.findMany({
    where: { userId: user.id, startDate: { gte: fiveYearsAgo }, sportType: { contains: "run", mode: "insensitive" } },
    select: { name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true },
  });
  type LiveAct = typeof liveActs[number];

  const liveLaps = (liveActs as LiveAct[])
    .filter(a => olRaceFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) && Array.isArray(a.laps))
    .flatMap(a =>
      (a.laps as LapRow[]).filter(l => l.average_heartrate && l.distance >= 800 && l.moving_time >= 180).map(l => ({
        avgHR: l.average_heartrate!, distanceM: l.distance, movingTimeSec: l.moving_time,
        totalElevationGain: l.total_elevation_gain ?? 0, startDate: a.startDate,
        isRace: a.isRace ?? false, weatherTemp: undefined as null | undefined,
      }))
    );

  console.log(`Total laps: ${liveLaps.length}`);

  // Original algorithm (unweighted P80, no threshold)
  console.log("\n── Verbose: LIVE original ──");
  const resA = estimateZones(liveLaps, maxHR, restHR, { useWeightThreshold: false, minCount: 15, verbose: true });
  printResult("  original (no-threshold, unweighted P80, minCount=15)", resA, liveLaps.length);

  // Config K: slope-based LT2 detection (no hardcoded HR floor)
  console.log("\n── Verbose: LIVE Config K (slope detection, no HR floor) ──");
  const resK = estimateZones(liveLaps, maxHR, restHR, {
    useWeightThreshold: true, weightedP80: true, effectiveWeightMin: true, minCount: 8,
    useSlopeDetection: true, verbose: true });
  printResult("  Config K (threshold, weighted P80, slope detection)", resK, liveLaps.length);
}

main().finally(() => prisma.$disconnect());
