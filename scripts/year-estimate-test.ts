/**
 * Standalone test: run the zone estimator algorithm in various configurations.
 * Edit algorithm variants here — copy confirmed-working version to zones.ts afterwards.
 * Does NOT import from lib/fitness/zones.ts to avoid polluting production.
 */
import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";
import { gradeAdjustedPace } from "../lib/fitness/vo2max";

const prisma = new PrismaClient();

// ── OL filter factory ──────────────────────────────────────────────────────
// Name-based rules are universal. Pace threshold is data-driven (see bootstrap below).
// Pass Infinity to disable the pace check (name-only mode, used for phase-1 bootstrap).
function makeOlRaceFilter(olRacePaceThresholdSecPerKm: number) {
  return (name: string, sportType: string, isRace: boolean, averageSpeed: number | null) =>
    !/virtualrun/i.test(sportType) &&
    !/indoor|inomhus/i.test(name) &&
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
    (!isRace || (averageSpeed != null && 1000 / averageSpeed < olRacePaceThresholdSecPerKm));
}

type LapRow = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };

interface BucketPoint { pace: number; medianHR: number; count: number; totalWeight: number }

interface EstimateResult {
  lt1HR: number; lt2HR: number; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number;
  rSquared: number; bucketCount: number;
}

function estimateZones(
  runs: Array<{ avgHR: number; distanceM: number; movingTimeSec: number; totalElevationGain: number;
                weatherTemp?: number | null; startDate?: Date; isRace?: boolean }>,
  maxHR: number,
  restHR: number,
  opts: {
    useWeightThreshold: boolean;
    minCount: number;
    asOf?: Date;
    verbose?: boolean;
    weightedP80?: boolean;
    effectiveWeightMin?: boolean;
    useSlopeDetection?: boolean;
    // When true: pace sanity bounds are derived from this dataset's own pace distribution
    // instead of hardcoded values. Also removes the hardcoded gap upper bound (391 s/km).
    dataDrivenPaceBounds?: boolean;
  } = { useWeightThreshold: false, minCount: 15 },
): EstimateResult | null {
  const refTime = (opts.asOf ?? new Date()).getTime();

  const recentCount = runs.filter(r => r.startDate && (refTime - r.startDate.getTime()) / 86400000 < 90).length;
  const halfLife = recentCount >= 40 ? 90 : 180;

  // ── First pass: all valid raw points (HR, lap size, grade filtered — no gap upper bound) ─
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
      // 200 s/km = 3:20/km — physical floor, no human sustains this for 800m+ laps
      if (temp > 30 || gap <= 200) return [];
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate ? (refTime - r.startDate.getTime()) / 86400000 : halfLife;
      const recency = Math.exp(-daysAgo / halfLife);
      const raceBoost = r.isRace ? 3.0 : 1.0;
      return [{ gap, hr: r.avgHR, weight: tempWeight * recency * raceBoost }];
    });

  // ── Compute pace percentiles from all raw valid points ─────────────────────
  // Used for data-driven sanity checks.
  const sortedRawGaps = allValid.map(p => p.gap).sort((a, b) => a - b);
  const gapPct = (p: number) =>
    sortedRawGaps[Math.max(0, Math.min(sortedRawGaps.length - 1, Math.floor(sortedRawGaps.length * p)))];
  // P60 ≈ LT2 upper sanity bound: threshold is a "fast" pace (faster than 60% of training laps)
  // P85 ≈ LT1 upper sanity bound: aerobic threshold (faster than 85% of training laps)
  const gapP60 = gapPct(0.60);
  const gapP85 = gapPct(0.85);

  // ── Apply weight threshold; optionally keep all paces (data-driven mode removes 391 cap) ─
  const points = allValid.filter(p => {
    if (!opts.dataDrivenPaceBounds && p.gap >= 391) return false;
    if (opts.useWeightThreshold && p.weight <= 0.01) return false;
    return true;
  });

  if (points.length < 40) return null;

  if (opts.verbose) {
    console.log(`  Points: ${points.length}  halfLife: ${halfLife}  recentCount: ${recentCount}`);
    if (opts.dataDrivenPaceBounds)
      console.log(`  Pace percentiles: P60=${fmt(gapP60)}/km  P85=${fmt(gapP85)}/km`);
  }

  // ── Buckets ────────────────────────────────────────────────────────────────
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
    console.log(`  Raw buckets (pace/HR/count) — before PAV:`);
    for (const b of buckets) console.log(`    ${fmt(b.pace)}/km  HR=${b.medianHR}  n=${b.count}`);
  }

  // ── Pool-adjacent-violators ────────────────────────────────────────────────
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
          count: tc, totalWeight: tw,
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

  // ── Slope-based LT2 detection ──────────────────────────────────────────────
  let bp1 = 1;
  if (opts.useSlopeDetection) {
    const slopes = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i + 1]) / (paceArr[i + 1] - p));
    const slopeMax = Math.max(...slopes);
    for (let i = 0; i < slopes.length - 2; i++) {
      if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
    }
    if (opts.verbose) {
      const slopes2 = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i + 1]) / (paceArr[i + 1] - p));
      const slopeMax2 = Math.max(...slopes2);
      console.log(`  Slope detection: slopeMax=${slopeMax2.toFixed(4)}  threshold=${(0.20 * slopeMax2).toFixed(4)}  bp1=${bp1} (${fmt(paceArr[bp1])})`);
    }
  }

  // ── bp2 via regression ─────────────────────────────────────────────────────
  let bestErr = Infinity, bp2 = Math.min(bp1 + 2, nb - 2);
  if (opts.useSlopeDetection) {
    for (let j = bp1 + 1; j < nb - 1; j++) {
      const err = segErr(0, bp1) + segErr(bp1, j) + segErr(j, nb - 1);
      if (err < bestErr) { bestErr = err; bp2 = j; }
    }
  } else {
    for (let i = 1; i < nb - 2; i++) {
      for (let j = i + 1; j < nb - 1; j++) {
        const err = segErr(0, i) + segErr(i, j) + segErr(j, nb - 1);
        if (err < bestErr) { bestErr = err; bp1 = i; bp2 = j; }
      }
    }
  }

  const tbw = bw.reduce((s, w) => s + w, 0);
  const meanHR  = hrArr.reduce((s, v, i) => s + v * bw[i], 0) / tbw;
  const totalVar = hrArr.reduce((s, v, i) => s + bw[i] * (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestErr / totalVar) * 100) / 100);
  if (opts.verbose) console.log(`  bp1=${bp1} (${fmt(paceArr[bp1])})  bp2=${bp2} (${fmt(paceArr[bp2])})  R²=${rSquared}`);
  if (rSquared < 0.62) return null;

  // ── LT2 and LT1 ───────────────────────────────────────────────────────────
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

  // ── Sanity checks ─────────────────────────────────────────────────────────
  // Universal (apply equally to all humans):
  if (lt1HR >= lt2HR - 8) return null;
  if (lt2HR >= maxHR * 0.98) return null;
  if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70) return null;
  if (lt2PaceSecPerKm >= lt1PaceSecPerKm) return null;

  // Pace sanity: data-driven vs hardcoded
  if (opts.dataDrivenPaceBounds) {
    if (opts.verbose) console.log(`  Pace sanity: lt2=${fmt(lt2PaceSecPerKm)} ≤ P60=${fmt(gapP60)};  lt1=${fmt(lt1PaceSecPerKm)} ≤ P85=${fmt(gapP85)}`);
    if (lt2PaceSecPerKm > gapP60) return null;
    if (lt1PaceSecPerKm > gapP85) return null;
  } else {
    if (lt1PaceSecPerKm < 240 || lt1PaceSecPerKm > 380) return null;
    if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) return null;
  }

  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length };
}

function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`; }

function printResult(label: string, result: EstimateResult | null, lapCount: number, olThreshold?: number) {
  const olStr = olThreshold != null ? `  OL<${fmt(olThreshold)}` : "";
  if (!result) {
    console.log(`${label}: insufficient data  (${lapCount} laps${olStr})`);
  } else {
    console.log(
      `${label}: LT1=${result.lt1HR}bpm @ ${fmt(result.lt1PaceSecPerKm)}  |  ` +
      `LT2=${result.lt2HR}bpm @ ${fmt(result.lt2PaceSecPerKm)}  |  ` +
      `R²=${result.rSquared.toFixed(3)}  |  ${result.bucketCount} buckets  |  ${lapCount} laps${olStr}`
    );
  }
}

// ── Build laps from activities ─────────────────────────────────────────────
type ActFull = {
  name: string; sportType: string; startDate: Date; laps: unknown;
  isRace: boolean | null; averageSpeed: number | null;
  weatherTemp?: number | null;
};

function buildLaps(acts: ActFull[], olFilter: ReturnType<typeof makeOlRaceFilter>) {
  return acts
    .filter(a => olFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) && Array.isArray(a.laps))
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

// ── Bootstrap OL race pace threshold from data ────────────────────────────
// Phase 1: run with name-only OL filter to get preliminary LT1.
// Phase 2: threshold = LT1 × 1.15 = upper boundary of easy training pace.
// A race slower than easy-training pace is terrain/navigation limited, not fitness limited.
// Falls back to 330 s/km (5:30/km) if phase-1 produces no estimate.
function bootstrapOlThreshold(
  acts: ActFull[],
  maxHR: number,
  restHR: number,
  asOf?: Date,
): number {
  const nameOnly = makeOlRaceFilter(Infinity);
  const phase1Laps = buildLaps(acts, nameOnly);
  const prelim = estimateZones(phase1Laps, maxHR, restHR, {
    useWeightThreshold: true, weightedP80: true, effectiveWeightMin: true, minCount: 8,
    useSlopeDetection: true, asOf,
  });
  if (!prelim) return 330;
  // 1.15× LT1 pace (sec/km) = upper bound of easy running zone for this athlete
  return Math.round(prelim.lt1PaceSecPerKm * 1.15);
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user");
  const cache = await prisma.fitnessCache.findUnique({ where: { userId: user.id }, select: { maxHR: true, restHR: true } });
  const maxHR = cache?.maxHR ?? 184;
  const restHR = cache?.restHR ?? 45;
  console.log(`maxHR=${maxHR}  restHR=${restHR}\n`);

  const cfgK = (asOf?: Date, verbose = false) => ({
    useWeightThreshold: true as const, weightedP80: true, effectiveWeightMin: true, minCount: 8,
    useSlopeDetection: true, asOf, verbose,
  });
  const cfgD = (asOf?: Date, verbose = false) => ({
    ...cfgK(asOf, verbose), dataDrivenPaceBounds: true,
  });

  // ── Per-year ──────────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2018 }, (_, i) => 2019 + i);

  for (const year of years) {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end   = year < currentYear ? new Date(`${year}-12-31T23:59:59Z`) : new Date();

    const acts = await prisma.activity.findMany({
      where: { userId: user.id, startDate: { gte: start, lte: end }, sportType: { contains: "run", mode: "insensitive" } },
      select: { name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true, weatherTemp: true },
    }) as ActFull[];

    // Data-driven OL threshold: bootstrap from preliminary LT1 estimate
    const olThreshold = bootstrapOlThreshold(acts, maxHR, restHR, end);
    const olFilter    = makeOlRaceFilter(olThreshold);
    const laps        = buildLaps(acts, olFilter);

    const verbose = year >= 2025;
    if (verbose) console.log(`\n── ${year} (K) ──  OL threshold=${fmt(olThreshold)}/km`);
    const rK = estimateZones(laps, maxHR, restHR, cfgK(end, verbose));
    printResult(`${year} cfgK  `, rK, laps.length, olThreshold);

    if (verbose) console.log(`\n── ${year} (D: data-driven pace bounds) ──`);
    const rD = estimateZones(laps, maxHR, restHR, cfgD(end, verbose));
    printResult(`${year} cfgD  `, rD, laps.length, olThreshold);
  }

  // ── LIVE ──────────────────────────────────────────────────────────────────
  console.log("\n── LIVE (5-year window) ──");
  const fiveYearsAgo = subDays(new Date(), 5 * 365);

  const liveActs = await prisma.activity.findMany({
    where: { userId: user.id, startDate: { gte: fiveYearsAgo }, sportType: { contains: "run", mode: "insensitive" } },
    select: { name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true },
  }) as ActFull[];

  const liveOlThreshold = bootstrapOlThreshold(liveActs, maxHR, restHR);
  const liveOlFilter    = makeOlRaceFilter(liveOlThreshold);
  const liveLaps        = buildLaps(liveActs, liveOlFilter);
  console.log(`Total laps: ${liveLaps.length}  OL threshold=${fmt(liveOlThreshold)}/km`);

  console.log("\n── Verbose: LIVE Config K ──");
  const resK = estimateZones(liveLaps, maxHR, restHR, cfgK(undefined, true));
  printResult("  Config K", resK, liveLaps.length, liveOlThreshold);

  console.log("\n── Verbose: LIVE Config D ──");
  const resD = estimateZones(liveLaps, maxHR, restHR, cfgD(undefined, true));
  printResult("  Config D", resD, liveLaps.length, liveOlThreshold);
}

main().finally(() => prisma.$disconnect());
