/**
 * Rolling monthly LT/AT estimator validation script.
 *
 * For each calendar month going back as far as data allows, runs the same
 * estimateZonesFromActivities() pipeline now shared by lib/fitness/zones.ts
 * (used by both updateHRZones()'s live calibration and updateVO2maxAndPaces()'s
 * rolling trend) against a window ending that month — standalone reimplementation,
 * frozen from production so experiments here can't accidentally affect prod.
 *
 * Validated against 5+ years of real local data (see IMPLEMENTATION_PLAN.md Bug
 * 14/15): combined activities+laps data gives much better month-coverage and
 * equal-or-better R² than laps-only. The OL pace-threshold exclusion MUST stay
 * gated to isRace=true only — broadening it to all activities was tried and
 * reverted, since it discards legitimate easy/recovery training (routinely
 * slower than 1.15× LT1 pace, and not OL) far more often than it catches a
 * genuine OL leak. gateToRaceOnly/combined below are kept as toggles in case
 * a future change needs re-validating the same way.
 *
 * Usage: npx tsx scripts/rolling-lt-test.ts
 * Usage (verbose bucket/breakpoint detail for one month): DEBUG_MONTH=2025-06 npx tsx scripts/rolling-lt-test.ts
 */
import { PrismaClient } from "@prisma/client";
import { subDays, format, addDays } from "date-fns";
import { gradeAdjustedPace } from "../lib/fitness/vo2max";

const prisma = new PrismaClient();

// ── OL filter ────────────────────────────────────────────────────────────────
// Tried massively expanding this (via real data: 278 isRace=true activities, 270+
// of them Swedish orienteering events the original 7-keyword list never matched)
// to exclude essentially all OL races by name. Reverted: it regressed the LIVE
// computation (already validated, matches the documented baseline) from 3:53/km
// to 4:00/km. This athlete is a competitive orienteer — most genuinely maximal
// hard efforts happen DURING races, not pure road training, so excluding OL races
// wholesale removes real high-intensity signal, not just noise. The original,
// narrower filter (catching only clearly slow/technical OL terminology) plus the
// existing pace-threshold check (excluding any race slower than easy-training
// pace, terrain/navigation-limited) is the validated, correct balance.
function makeOlFilter(olPaceThresholdSecPerKm: number, gateToRaceOnly: boolean) {
  return (name: string, sportType: string, isRace: boolean, averageSpeed: number | null) =>
    !/virtualrun/i.test(sportType) &&
    !/indoor|inomhus/i.test(name) &&
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
    (gateToRaceOnly
      ? (!isRace || (averageSpeed != null && 1000 / averageSpeed < olPaceThresholdSecPerKm))
      : (averageSpeed == null || 1000 / averageSpeed < olPaceThresholdSecPerKm));
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
    asOf?: Date;
    minEffWeight?: number;
    verbose?: boolean;
  } = {},
): EstimateResult | null {
  const refTime = (opts.asOf ?? new Date()).getTime();
  const recentCount = runs.filter(r => r.startDate && (refTime - r.startDate.getTime()) / 86400000 < 90).length;
  // Smoothed halfLife (Bug 9 fix, mirrored from lib/fitness/zones.ts) — linear
  // interpolation instead of a hard cliff at recentCount===40, so a single
  // activity crossing the boundary can't cause a discontinuous jump.
  const halfLifeT = Math.max(0, Math.min(1, (recentCount - 30) / 20));
  const halfLife = 180 - halfLifeT * 90;
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

  const points = allValid.filter(p => p.gap > 200);
  if (V) console.log(`  halfLife=${halfLife.toFixed(0)}  recentCount=${recentCount}  allValid=${allValid.length}  points=${points.length}`);
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

  // Require a genuinely dominant kink to exist at all — applied identically to every
  // window (live or historical). A smooth/ambiguous curve (no period with a clearly
  // steeper transition than the rest) isn't reliable regardless of which bucket "wins"
  // the relative 20%-of-max test below. Calibrated against the live computation
  // (slopeMax≈0.50), a confirmed-good sparse historical month (2021-11, slopeMax≈0.32),
  // and a confirmed-ambiguous one (2025-08, slopeMax≈0.20).
  const MIN_ABS_SLOPE = 0.25;
  if (slopeMax < MIN_ABS_SLOPE) {
    if (V) console.log(`  [NULL] slopeMax(${slopeMax.toFixed(3)}) < ${MIN_ABS_SLOPE} — no dominant kink, curve too smooth/ambiguous to trust`);
    return null;
  }

  // Scan from the FASTEST bucket — no longer unconditionally skipping index 0 — but
  // require a much stronger signal there specifically (60% of max, not 20%). Bucket 0
  // is disproportionately prone to a PAV merge of a non-monotonic fast-pace inversion
  // (e.g. a few scattered hard efforts), which can produce a moderate slope that's
  // real noise, not LT2 (confirmed in 2025-06/09/10/11: bucket-0 slope ~33-55% of max,
  // selecting it gave a physiologically impossible LT2 faster than the live result).
  // 2021-11's genuine fastest-bucket kink is far stronger (78% of max) and survives
  // this bar; the previous blanket skip would have rejected it regardless of strength.
  //
  // (A bucket-weight confidence floor was also tried — rejecting candidates whose
  // bucket barely clears minEffWeight — but PAV merging additively combines weights
  // from the buckets it merges, so a borderline-sparse bucket's weight after merging
  // looks no different from a well-supported one; it didn't discriminate the cases it
  // was meant to catch and reduced coverage elsewhere. Reverted.)
  let bp1 = 1;
  if (slopes[0] > 0.60 * slopeMax) {
    bp1 = 0;
  } else {
    for (let i = 1; i < slopes.length - 2; i++) {
      if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
    }
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
  if (lt2PaceSecPerKm > gapP60) { if (V) console.log(`  [NULL] lt2Pace(${fmt(lt2PaceSecPerKm)}) > P60(${fmt(gapP60)})`); return null; }
  if (lt1PaceSecPerKm > gapP85) { if (V) console.log(`  [NULL] lt1Pace(${fmt(lt1PaceSecPerKm)}) > P85(${fmt(gapP85)})`); return null; }

  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length, lapCount: runs.length };
}

function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`; }

type ActFull = {
  name: string; sportType: string; startDate: Date; laps: unknown;
  isRace: boolean | null; averageSpeed: number | null; weatherTemp?: number | null;
  averageHeartrate: number | null; distance: number; movingTime: number; totalElevationGain: number;
};

function buildLaps(acts: ActFull[], olFilter: ReturnType<typeof makeOlFilter>) {
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
          isRace: a.isRace ?? false, weatherTemp: a.weatherTemp ?? null,
        }))
    );
}

// Whole-activity rows (Bug 14 fix) — combined with buildLaps so the dataset
// matches statResult in lib/fitness/cache.ts exactly (acts + laps), not the
// narrower laps-only subset the trend computation used before.
function buildActs(acts: ActFull[], olFilter: ReturnType<typeof makeOlFilter>) {
  return acts
    .filter(a =>
      a.averageHeartrate && olFilter(a.name, a.sportType, a.isRace ?? false, a.averageSpeed) &&
      a.distance >= 4000 && a.movingTime >= 900 &&
      !WU_CD_RE.test(a.name)
    )
    .map(a => ({
      avgHR: a.averageHeartrate!, distanceM: a.distance, movingTimeSec: a.movingTime,
      totalElevationGain: a.totalElevationGain, startDate: a.startDate,
      isRace: a.isRace ?? false, weatherTemp: a.weatherTemp ?? null,
    }));
}

function bootstrapOlThreshold(acts: ActFull[], maxHR: number, restHR: number, gateToRaceOnly: boolean, asOf?: Date): number {
  const nameOnly = makeOlFilter(Infinity, gateToRaceOnly);
  const phase1Laps = buildLaps(acts, nameOnly);
  const prelim = estimateZones(phase1Laps, maxHR, restHR, { asOf });
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

  const allActs = await prisma.activity.findMany({
    where: { userId: user.id, sportType: { contains: "run", mode: "insensitive" } },
    select: {
      name: true, sportType: true, startDate: true, laps: true, isRace: true, averageSpeed: true,
      weatherTemp: true, averageHeartrate: true, distance: true, movingTime: true, totalElevationGain: true,
    },
    orderBy: { startDate: "asc" },
  }) as ActFull[];

  console.log(`Total running activities: ${allActs.length}\n`);

  // Validated config — matches estimateZonesFromActivities() in lib/fitness/zones.ts exactly.
  const CONFIGS: Array<{ label: string; gateToRaceOnly: boolean; combined: boolean }> = [
    { label: "Validated (combined, race-gated OL)", gateToRaceOnly: true, combined: true },
  ];

  const now = new Date();
  const firstDate = allActs[0]?.startDate ?? subDays(now, 365);
  const windowEnds: Date[] = [];
  let d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d >= addDays(firstDate, 90)) {
    windowEnds.unshift(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }

  console.log(`Monthly windows: ${windowEnds.length}  (${format(windowEnds[0], "yyyy-MM")} → ${format(windowEnds.at(-1)!, "yyyy-MM")})\n`);

  console.log(`${"Month".padEnd(8)}  ${"Config".padEnd(36)}  LT2          LT1          R²     n     OL_thr`);
  console.log("-".repeat(100));

  type TrendPoint = { month: string; lt2Sec: number; lt1Sec: number };
  const trendsByConfig: Record<string, TrendPoint[]> = {};
  for (const cfg of CONFIGS) trendsByConfig[cfg.label] = [];

  for (const windowEnd of windowEnds) {
    const month = format(windowEnd, "yyyy-MM");
    const actsUpToWindow = allActs.filter(a => a.startDate <= windowEnd);
    let any = false;

    for (const cfg of CONFIGS) {
      const windowOlThreshold = bootstrapOlThreshold(actsUpToWindow, maxHR, restHR, cfg.gateToRaceOnly, windowEnd);
      const windowOlFilter = makeOlFilter(windowOlThreshold, cfg.gateToRaceOnly);
      const windowLaps = buildLaps(actsUpToWindow, windowOlFilter);
      const windowActs = cfg.combined ? buildActs(actsUpToWindow, windowOlFilter) : [];
      const dataset = [...windowActs, ...windowLaps];

      const verbose = process.env.DEBUG_MONTH === month;
      if (verbose) console.log(`\n[DEBUG ${month} / ${cfg.label}] laps=${windowLaps.length} acts=${windowActs.length}`);
      const result = estimateZones(dataset, maxHR, restHR, { asOf: windowEnd, verbose });
      if (result) {
        any = true;
        console.log(
          `${month}    ${cfg.label}  LT2=${fmt(result.lt2PaceSecPerKm)}/km  LT1=${fmt(result.lt1PaceSecPerKm)}/km  R²=${result.rSquared.toFixed(2)}  n=${String(dataset.length).padStart(4)}  ol=${fmt(windowOlThreshold)}`
        );
        trendsByConfig[cfg.label].push({ month, lt2Sec: result.lt2PaceSecPerKm, lt1Sec: result.lt1PaceSecPerKm });
      } else if (any) {
        console.log(`${month}    ${cfg.label}  — (null)`);
      }
    }
    if (any) console.log();
  }

  for (const cfg of CONFIGS) {
    const smoothed = smoothTrend(trendsByConfig[cfg.label]);
    console.log(`\n\n═══ ${cfg.label}: raw vs smoothed ═══\n`);
    console.log(`${"Month".padEnd(8)}  ${"Raw LT2".padEnd(10)}  ${"Sm LT2".padEnd(8)}  ${"Raw LT1".padEnd(10)}  ${"Sm LT1".padEnd(8)}  Notes`);
    console.log("-".repeat(72));
    const raw = trendsByConfig[cfg.label];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
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

  console.log("\n\n═══ Final (current month) comparison ═══\n");
  for (const cfg of CONFIGS) {
    const trend = trendsByConfig[cfg.label];
    const last = trend.at(-1);
    if (last) console.log(`${cfg.label}: LT2=${fmt(last.lt2Sec)}/km  LT1=${fmt(last.lt1Sec)}/km`);
    else console.log(`${cfg.label}: no result`);
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

  // No longer requires an exact 1-month gap on both sides — with the breakpoint fix,
  // some months legitimately return null (data too ambiguous to trust), so a point's
  // nearest surviving neighbors are often calendar-gapped. Instead: when the two
  // nearest available neighbors closely AGREE with each other (regardless of how far
  // apart in time they are), and the current point disagrees with both, the current
  // point is the more likely outlier — a median-filter-style check, not a fixed-gap one.
  //
  // lt2 is the primary statistically-detected breakpoint; lt1 is derived from it
  // (VT1/VT2 ratio). Only lt2 is checked — when it's flagged, lt1 is rescaled by its
  // original ratio to lt2 rather than checked independently, which previously let one
  // get "corrected" while the other didn't (decoupling them from their physiological
  // ratio: a real case smoothed lt2 from 232s to 263s while lt1 stayed at 275s, a ratio
  // nowhere near the ~1.185 the algorithm itself assumes).
  const OUTLIER_THRESHOLD = 15;
  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1].lt2Sec, curr = result[i].lt2Sec, next = result[i + 1].lt2Sec;
    if (Math.abs(prev - next) > OUTLIER_THRESHOLD) continue; // neighbors don't agree — no basis to call curr the outlier
    const isFasterThanBoth = curr <= Math.min(prev, next) - OUTLIER_THRESHOLD;
    const isSlowerThanBoth = curr >= Math.max(prev, next) + OUTLIER_THRESHOLD;
    if (isFasterThanBoth || isSlowerThanBoth) {
      const smoothedLt2 = (prev + next) / 2;
      const ratio = result[i].lt1Sec / result[i].lt2Sec;
      result[i] = { ...result[i], lt2Sec: smoothedLt2, lt1Sec: smoothedLt2 * ratio };
    }
  }

  // Symmetric rate cap (Bug 9 fix) — caps both improvement AND degradation at
  // 20s/km per elapsed month, not just improvement. Scaled by the actual gap since
  // consecutive array entries are no longer guaranteed to be 1 calendar month apart.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const MAX_CHANGE_PER_MONTH = 20;
  for (let i = 1; i < result.length; i++) {
    const gap = monthDiff(result[i - 1].month, result[i].month);
    const maxChange = MAX_CHANGE_PER_MONTH * gap;
    const prevLt2 = result[i - 1].lt2Sec;
    const cappedLt2 = clamp(result[i].lt2Sec, prevLt2 - maxChange, prevLt2 + maxChange);
    if (cappedLt2 !== result[i].lt2Sec) {
      const ratio = result[i].lt1Sec / result[i].lt2Sec;
      result[i] = { ...result[i], lt2Sec: cappedLt2, lt1Sec: cappedLt2 * ratio };
    }
  }

  return result;
}

main().finally(() => prisma.$disconnect());
