// Heart rate and pace zone calculations.
// Zones are defined relative to the athlete's lactate threshold HR and VO2max pace.

import { gradeAdjustedPace } from "./vo2max";

export interface HRZones {
  z1: [number, number]; // recovery
  z2: [number, number]; // aerobic
  z3: [number, number]; // tempo
  z4: [number, number]; // threshold
  z5: [number, number]; // VO2max
  maxHR: number;
  restHR: number;
}

export interface PaceZones {
  easy:      [number, number]; // sec/km
  marathon:  [number, number];
  threshold: [number, number];
  interval:  [number, number];
  repetition:[number, number];
  vdot: number;
}

/**
 * Estimate max HR from a list of per-activity max HR values.
 *
 * Strategy: take the 98th percentile rather than the absolute max to avoid
 * single-sensor spikes, then add a small margin because max is rarely reached
 * in training (only in true all-out efforts / races).
 *
 * The absolute max is used only as a floor (we won't estimate BELOW what was
 * actually observed).
 */
// Artifact cap: optical HR sensors can spike above 210 on wrist movement.
// 190 bpm is a safe ceiling for most adults; true physiological max rarely exceeds this.
export const MAXHR_ARTIFACT_CAP = 190;

/**
 * Estimate max HR from per-activity max HR values.
 * Uses 85th percentile of clean data — max is rarely reached in training.
 */
export function estimateMaxHR(activityMaxHRs: number[], cap = MAXHR_ARTIFACT_CAP): number {
  if (activityMaxHRs.length === 0) return 185;
  const clean = activityMaxHRs.filter(h => h >= 140 && h <= cap);
  if (clean.length === 0) return 185;
  const sorted = [...clean].sort((a, b) => a - b);
  const p85 = sorted[Math.min(Math.floor(sorted.length * 0.85), sorted.length - 1)];
  return Math.round(p85);
}

/**
 * Estimate max HR from race/hard-effort activities.
 * Uses 80th percentile + 5 bpm margin: race-peak HR is typically ~5 bpm below
 * true physiological HRmax (Scharhag-Rosenberger et al. 2023, n=5311 CPET).
 * Requires ≥ 2 race observations to avoid single-effort noise.
 */
export function estimateMaxHRFromRaces(raceMaxHRs: number[], cap = MAXHR_ARTIFACT_CAP): number | null {
  if (raceMaxHRs.length < 2) return null;
  const clean = raceMaxHRs.filter(h => h >= 140 && h <= cap);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const p80 = sorted[Math.min(Math.floor(sorted.length * 0.80), sorted.length - 1)];
  return Math.min(Math.round(p80) + 5, 210);
}

/**
 * Estimate max HR from threshold-effort activities.
 * More robust than raw max because threshold efforts have consistent, reliable HR.
 * thresholdHRs: array of average HRs from known hard/threshold sessions.
 */
export function estimateMaxHRFromThreshold(thresholdHRs: number[]): number | null {
  if (thresholdHRs.length < 3) return null;
  const sorted = [...thresholdHRs].sort((a, b) => a - b);
  // 85th percentile of threshold HRs ≈ lactate threshold HR
  const p85idx = Math.floor(sorted.length * 0.85);
  const thresholdHR = sorted[Math.min(p85idx, sorted.length - 1)];
  // Threshold HR is typically 85–92% of max HR for well-trained runners; use 88%
  return Math.round(thresholdHR / 0.88);
}

/**
 * Physiologically-anchored HR zones — non-uniform, based on LT1 and LT2.
 *
 * Research values for well-trained endurance athletes:
 *   LT1 (aerobic threshold)  ≈ 80 % maxHR  (Seiler, Esteve-Lanao)
 *   LT2 (lactate threshold)  ≈ 89 % maxHR  (higher for trained runners)
 *
 * Zone structure (non-uniform widths):
 *   Z1  Recovery    restHR  → LT1 - Z2width
 *   Z2  Aerobic     LT1-Z2w → LT1           (meaningful width: ~10-12 bpm)
 *   Z3  Tempo       LT1     → LT2           (natural physiological range)
 *   Z4  Threshold   LT2     → LT2 + 8 bpm  (at/just above LT2)
 *   Z5  VO2max      LT2+8   → maxHR
 */
export function buildHRZones(maxHR: number, restHR: number = 45): HRZones {
  const pct = (p: number) => Math.round(maxHR * p);

  const lt1 = pct(0.83);  // LT1 ≈ 83% for well-trained runners (raised from 80% — observational calibration)
  const lt2 = pct(0.89);  // LT2 ≈ 89% for trained runners

  // Z2 width: ~7% of LT1 value → gives meaningful aerobic zone (~10-12 bpm)
  const z2width = Math.max(8, Math.round(lt1 * 0.07));

  return {
    z1: [restHR,          lt1 - z2width],
    z2: [lt1 - z2width,   lt1],
    z3: [lt1,             lt2],
    z4: [lt2,             Math.min(lt2 + 8, maxHR - 2)],
    z5: [Math.min(lt2 + 8, maxHR - 2), maxHR],
    maxHR,
    restHR,
  };
}

/** The LT1 and LT2 boundaries extracted from a zone set, for display. */
export function ltBoundaries(zones: HRZones) {
  return {
    lt1: zones.z3[0],  // LT1 = bottom of Z3
    lt2: zones.z4[0],  // LT2 = bottom of Z4
    ltTrainingRange: [zones.z4[0], Math.round(zones.maxHR * 0.91)] as [number, number],
    atTrainingRange: [zones.z3[0], zones.z4[0]] as [number, number],
  };
}

export interface LTBoundaries {
  lt1HR: number;
  lt2HR: number;
  lt1PaceSecPerKm: number;
  lt2PaceSecPerKm: number;
  source: "race-pbs" | "default";
}

/**
 * Per-distance LT2 conversion: race pace × factor = LT2 pace.
 * Shorter races are faster than LT2 → factor > 1; marathon is slower → factor < 1.
 * Reliability reflects how directly the distance maps to LT2 (HM = 1.0, extremes lower).
 */
const LT2_CONVERSIONS: Array<{ lo: number; hi: number; factor: number; rel: number }> = [
  { lo: 700,   hi: 1200,  factor: 1.30,  rel: 0.20 }, // ~800m — high anaerobic, noisy
  { lo: 1200,  hi: 2000,  factor: 1.25,  rel: 0.30 }, // ~1500m/mile
  { lo: 2000,  hi: 4500,  factor: 1.19,  rel: 0.45 }, // ~3K
  { lo: 4500,  hi: 7000,  factor: 1.135, rel: 0.70 }, // ~5K
  { lo: 7000,  hi: 12000, factor: 1.065, rel: 0.85 }, // ~10K
  { lo: 12000, hi: 23000, factor: 1.00,  rel: 1.00 }, // half-marathon (most direct)
  { lo: 38000, hi: 44000, factor: 0.95,  rel: 0.45 }, // marathon (pacing strategy varies)
];

/**
 * Estimate LT1 and LT2 from stored race PBs using a multi-PB weighted-best algorithm.
 *
 * All available PBs are converted to an implied LT2 pace using distance-specific
 * calibration factors, then weighted by:
 *   - Distance reliability (HM = 1.0 most direct; short/marathon races lower)
 *   - Recency (18-month half-life — a PB from 2 years ago gets ~26% weight)
 *
 * Candidates are sorted fastest-first and the weighted mean of the top-35% fastest
 * by reliability weight is returned. This naturally handles:
 *   - "Not max effort" PBs: another distance's harder effort takes over
 *   - Stale fitness: recent PBs dominate older ones
 *   - Noisy short-race PBs: low reliability prevents a single 3K from dominating
 *
 * LT2 HR is then derived via the HR-pace regression (not from actual race HR, which
 * would be lower for any non-max-effort race and therefore less reliable as an anchor).
 */
export function estimateLTFromRaces(
  racePBs: Array<{ distanceM: number; timeSec: number; date?: Date }>,
  maxHR: number,
  restHR: number,
): LTBoundaries {
  if (racePBs.length === 0) {
    return {
      lt1HR: Math.round(maxHR * 0.82), lt2HR: Math.round(maxHR * 0.88),
      lt1PaceSecPerKm: 0, lt2PaceSecPerKm: 0, source: "default",
    };
  }

  const now = Date.now();

  // Convert each PB to an implied LT2 pace with combined reliability × recency weight
  const candidates = racePBs
    .map(pb => {
      const conv = LT2_CONVERSIONS.find(c => pb.distanceM >= c.lo && pb.distanceM < c.hi);
      if (!conv) return null;
      const racePaceSecPerKm = pb.timeSec / (pb.distanceM / 1000);
      const lt2Pace = racePaceSecPerKm * conv.factor;
      const monthsOld = pb.date ? (now - pb.date.getTime()) / (1000 * 60 * 60 * 24 * 30) : 24;
      const recency = Math.exp(-monthsOld / 18); // 18-month half-life
      return { lt2Pace, weight: conv.rel * recency };
    })
    .filter((c): c is { lt2Pace: number; weight: number } => c !== null && c.weight > 0.01);

  // Fallback when all PBs are outside the calibrated distance range
  if (candidates.length === 0) {
    return {
      lt1HR: Math.round(maxHR * 0.82), lt2HR: Math.round(maxHR * 0.88),
      lt1PaceSecPerKm: 0, lt2PaceSecPerKm: 0, source: "default",
    };
  }

  // Sort fastest-first and accumulate until ≥35% of total weight is covered.
  // This prefers the fastest (highest-fitness) estimates while requiring enough
  // reliability support to prevent a single noisy PB from dominating.
  candidates.sort((a, b) => a.lt2Pace - b.lt2Pace);
  const totalW = candidates.reduce((s, c) => s + c.weight, 0);
  const threshold = totalW * 0.35;
  let cumW = 0, sumPaceW = 0;
  for (const c of candidates) {
    cumW += c.weight;
    sumPaceW += c.lt2Pace * c.weight;
    if (cumW >= threshold) break;
  }

  const lt2PaceSecPerKm = sumPaceW / cumW;

  // PMC12845794 (n=1,411): VT1/VT2 speed ratio = 0.844 → LT1 pace ≈ LT2/0.844 ≈ ×1.185
  const lt1PaceSecPerKm = lt2PaceSecPerKm / 0.844;

  // HR derived from fixed physiological percentages (Seiler 2010):
  // HR-pace regression extrapolation to threshold paces inflates LT2 HR to 95-97% maxHR.
  const lt2HR = Math.round(maxHR * 0.88);
  const lt1HR = Math.round(maxHR * 0.83);

  return {
    lt1HR,
    lt2HR,
    lt1PaceSecPerKm: Math.round(lt1PaceSecPerKm),
    lt2PaceSecPerKm: Math.round(lt2PaceSecPerKm),
    source: "race-pbs",
  };
}

/**
 * Build HR zones anchored to data-derived LT1/LT2 instead of fixed percentages.
 * Falls back to standard percentages when values are physiologically inconsistent.
 */
export function buildHRZonesFromLT(
  lt: LTBoundaries,
  maxHR: number,
  restHR: number,
): HRZones {
  const lt1 = lt.lt1HR;
  const lt2 = lt.lt2HR;

  // Guard: if LT values are inverted or degenerate, fall back to fixed percentages
  if (lt1 >= lt2 || lt1 < restHR + 4 || lt2 >= maxHR) {
    return buildHRZones(maxHR, restHR);
  }

  const z2width = Math.max(8, Math.round(lt1 * 0.07));
  // Ensure Z1 lower bound doesn't exceed Z1 upper bound
  const z1lo = Math.min(restHR, lt1 - z2width - 1);
  const z1hi = lt1 - z2width;

  const zones: HRZones = {
    z1: [z1lo,     z1hi],
    z2: [z1hi,     lt1],
    z3: [lt1,      lt2],
    z4: [lt2,      Math.min(lt2 + 8, maxHR - 2)],
    z5: [Math.min(lt2 + 8, maxHR - 2), maxHR],
    maxHR,
    restHR,
  };

  return ensureValidZones(zones) ? zones : buildHRZones(maxHR, restHR);
}

/** Validate that all zones are strictly monotonically increasing with positive widths. */
export function ensureValidZones(z: HRZones): boolean {
  return (
    z.z1[0] < z.z1[1] &&
    z.z1[1] <= z.z2[0] &&
    z.z2[0] < z.z2[1] &&
    z.z2[1] <= z.z3[0] &&
    z.z3[0] < z.z3[1] &&
    z.z3[1] <= z.z4[0] &&
    z.z4[0] < z.z4[1] &&
    z.z4[1] <= z.z5[0] &&
    z.z5[0] < z.z5[1]
  );
}

// ── Statistical zone estimation ────────────────────────────────────────────

export interface StatisticalZoneResult {
  lt1HR: number;
  lt2HR: number;
  lt1PaceSecPerKm: number;
  lt2PaceSecPerKm: number;
  rSquared: number;          // 0–1, confidence of the piecewise fit
  bucketCount: number;       // number of valid pace buckets used
  zones: HRZones;
  usedExtendedWindow?: boolean; // true if the standard recency window failed and an escalated half-life was needed
}

interface BucketPoint { pace: number; medianHR: number; count: number; totalWeight: number }

/**
 * Estimate HR zones statistically from a large dataset of training runs.
 * Algorithm:
 *   1. Compute grade-adjusted pace (GAP) per activity
 *   2. Bucket by pace using Freedman-Diaconis optimal bin width
 *   3. Compute weighted median HR per bucket (robust to outliers)
 *   4. Find two breakpoints via exhaustive piecewise linear regression
 *   5. Breakpoints = LT1 and LT2 → build non-uniform zones
 *
 * Requires ≥ 8 valid buckets with ≥ 10 runs each for a reliable estimate.
 * Returns null if data is insufficient.
 */
export function estimateZonesFromStatisticalAnalysis(
  runs: Array<{
    avgHR: number;
    distanceM: number;
    movingTimeSec: number;
    totalElevationGain: number;
    weatherTemp?: number | null;
    startDate?: Date;
    isRace?: boolean;
  }>,
  maxHR: number,
  restHR: number,
  asOf?: Date,
  debug = false,
  halfLifeOverrideDays?: number,
): StatisticalZoneResult | null {
  const log = (...args: unknown[]) => { if (debug) console.log("[zones:debug]", ...args); };

  // ── 1. Filter and compute GAP ──────────────────────────────────────────
  const MIN_DIST = 800;          // allows 1km lap splits from activities
  const MIN_DURATION_SEC = 180;  // 3 min — laps are pre-warmed from the surrounding run

  const refTime = (asOf ?? new Date()).getTime();

  // Prefer 90-day recency half-life to track current fitness; fall back to 180 days when
  // few runs exist in the last 90 days (injury/off-season gaps). Smoothed linearly across
  // a 30-50 run band instead of a hard cutoff at 40 — a single activity crossing the 90-day
  // window boundary (which happens every day, with zero new data needed) could otherwise
  // flip this boolean and reweight every bucket in the regression at once, producing a
  // large, discontinuous jump in the estimate from nothing more than the date advancing.
  const recentCount = runs.filter(r => {
    if (!r.startDate) return false;
    return (refTime - r.startDate.getTime()) / 86_400_000 < 90;
  }).length;
  const halfLifeT = Math.max(0, Math.min(1, (recentCount - 30) / 20)); // 0 at <=30 runs, 1 at >=50
  const halfLife = halfLifeOverrideDays ?? (180 - halfLifeT * 90);
  if (halfLifeOverrideDays) log(`halfLife override=${halfLifeOverrideDays}d (standard would be ${Math.round(180 - halfLifeT * 90)}d)`);

  // ── First pass: all valid raw points (no gap upper bound) ─────────────────
  // HR bounds are universal physiology; lower gap bound (200 s/km = 3:20/km) is a
  // physical impossibility for sustained 800m+ laps.
  const allValid = runs
    .filter(r =>
      r.avgHR > maxHR * 0.52 && r.avgHR < maxHR * 0.96 &&
      r.distanceM >= MIN_DIST && r.movingTimeSec >= MIN_DURATION_SEC &&
      r.totalElevationGain / r.distanceM < 0.12
    )
    .flatMap(r => {
      const rawPace = r.movingTimeSec / (r.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, r.totalElevationGain, r.distanceM);
      const temp = r.weatherTemp ?? 15;
      if (temp > 30 || gap <= 200) return [];
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate ? (refTime - r.startDate.getTime()) / 86_400_000 : halfLife;
      const recency = Math.exp(-daysAgo / halfLife);
      const raceBoost = r.isRace ? 3.0 : 1.0;
      return [{ gap, hr: r.avgHR, weight: tempWeight * recency * raceBoost }];
    });

  // ── Compute pace percentiles from all raw points ────────────────────────
  // Used for data-driven sanity checks: LT2 must be in the faster 60% of training laps;
  // LT1 must be in the faster 85%. Scales automatically with any athlete's fitness level.
  const sortedRawGaps = allValid.map(p => p.gap).sort((a, b) => a - b);
  const gapPct = (p: number) =>
    sortedRawGaps[Math.max(0, Math.min(sortedRawGaps.length - 1, Math.floor(sortedRawGaps.length * p)))];
  const gapP60 = gapPct(0.60);
  const gapP85 = gapPct(0.85);

  // ── Apply weight threshold ─────────────────────────────────────────────
  // weight > 0.01 makes the recency window real: with halfLife=90 this is ~14 months.
  // Sparse slow-pace buckets beyond the athlete's typical range are filtered by the
  // effective-weight MIN_EFF_WEIGHT=8 threshold, so no hardcoded gap upper bound is needed.
  const points = allValid.filter(p => p.weight > 0.01);

  log(`allValid=${allValid.length} points(weight>0.01)=${points.length} (need >=40)`);
  if (points.length < 40) return null;

  const binWidth = 15; // fixed 15 s/km bins

  // ── 3. Build buckets ───────────────────────────────────────────────────
  const bucketMap = new Map<number, Array<{ hr: number; w: number }>>();
  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  // Effective-weight threshold: a bucket must have accumulated weight ≥ 8 to qualify.
  // A bucket with 3 recent race laps (weight ≈ 3 each = 9) passes; 12 stale laps
  // (weight ≈ 0.2 each = 2.4) do not. Data-driven, not count-based.
  const MIN_EFF_WEIGHT = 8;
  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => pts.reduce((s, p) => s + p.w, 0) >= MIN_EFF_WEIGHT)
    .map(([pace, pts]) => {
      const totalW = pts.reduce((s, p) => s + p.w, 0);
      // Weighted P80: accumulate recency/race weights until 80% is covered.
      // Race laps (3× boost) drive P80 higher at fast-pace buckets, preventing
      // spurious PAV inversions that mis-place the LT2 breakpoint.
      const sortedByHR = [...pts].sort((a, b) => a.hr - b.hr);
      let cumW = 0;
      let pct80HR = sortedByHR[sortedByHR.length - 1].hr;
      for (const pt of sortedByHR) { cumW += pt.w; if (cumW >= totalW * 0.80) { pct80HR = pt.hr; break; } }
      return { pace, medianHR: pct80HR, count: pts.length, totalWeight: totalW };
    })
    .sort((a, b) => a.pace - b.pace);

  // Enforce non-increasing HR with increasing pace via pool-adjacent-violators.
  // Noise inversions between adjacent buckets corrupt R² and misplace breakpoints.
  const mono = poolAdjacentViolators(buckets);
  log(`rawBuckets=${buckets.length} monoBuckets=${mono.length} (need >=6)`);
  if (mono.length < 6) return null;

  // ── 4. Slope-based LT2 detection + bp2 regression ─────────────────────
  const nb = mono.length;
  const paceArr = mono.map(b => b.pace);
  const hrArr   = mono.map(b => b.medianHR);
  // Count-based reciprocal weights: sparse fast-pace buckets (threshold region) need
  // proportionally more regression influence than dense easy-run buckets.
  const bucketWeights = mono.map(b => 1 / Math.sqrt(b.count));

  // Slope-based LT2 detection: scan from the fastest bucket, find first transition
  // where HR-pace slope exceeds 20% of the curve's own maximum slope.
  // This is the "plateau end" = LT2. The 0.20 threshold is a dimensionless ratio
  // of the curve's own geometry — no HR value or maxHR% is referenced.
  const slopes = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i + 1]) / (paceArr[i + 1] - p));
  const slopeMax = Math.max(...slopes);

  // Require a genuinely dominant kink to exist at all — rejects a smooth/ambiguous
  // curve (no period with a clearly steeper transition than the rest) regardless of
  // which bucket "wins" the relative test below. Validated against 5+ years of real
  // data (scripts/rolling-lt-test.ts): the live computation and well-supported sparse
  // historical windows both have slopeMax well above this; genuinely ambiguous windows
  // (smooth decline, no real kink) sit clearly below it.
  log(`slopeMax=${slopeMax.toFixed(3)} (need >=0.25)`);
  if (slopeMax < 0.25) return null;

  // Scan from the FASTEST bucket — but require a much stronger signal there
  // specifically (60% of max, not 20%). Bucket 0 is disproportionately prone to a
  // pool-adjacent-violators merge of a non-monotonic fast-pace inversion (a handful of
  // scattered hard efforts), which can produce a moderate slope that's noise, not LT2 —
  // confirmed empirically: in several real months this selected a LT2 pace faster than
  // the live (most data-rich) result, which isn't physiologically plausible. A genuine
  // fastest-bucket kink (e.g. in sparse historical data where it's the only one with
  // enough weight to register) is far stronger and clears this higher bar regardless.
  let bp1 = 1; // fallback: second bucket
  if (slopes[0] > 0.60 * slopeMax) {
    bp1 = 0;
  } else {
    for (let i = 1; i < slopes.length - 2; i++) {
      if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
    }
  }

  // Fix bp1, find bp2 by minimising remaining two-segment error.
  // bp2 = LS-derived LT1 (used as fallback when VT1 interpolation is out of range).
  let bestLSErr = Infinity, bp2 = Math.min(bp1 + 2, nb - 2);
  for (let j = bp1 + 1; j < nb - 1; j++) {
    const err = segErr(paceArr, hrArr, 0, bp1, bucketWeights) +
                segErr(paceArr, hrArr, bp1, j, bucketWeights) +
                segErr(paceArr, hrArr, j, nb - 1, bucketWeights);
    if (err < bestLSErr) { bestLSErr = err; bp2 = j; }
  }

  // Weighted R² — consistent with the weighted fit
  const totalBW = bucketWeights.reduce((s, w) => s + w, 0);
  const meanHR = hrArr.reduce((s, v, i) => s + v * bucketWeights[i], 0) / totalBW;
  const totalVar = hrArr.reduce((s, v, i) => s + bucketWeights[i] * (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestLSErr / totalVar) * 100) / 100);

  log(`rSquared=${rSquared} (need >=0.62)`);
  if (rSquared < 0.62) return null;

  // LT2: slope-detected breakpoint bp1 (fastest significant HR-drop point)
  const lt2PaceSecPerKm = paceArr[bp1];
  const lt2HR = Math.round(hrArr[bp1]);

  // LT1: VT1/VT2 speed ratio (PMC12845794, n=1411) — anchored to LT2 pace, more reliable than D-max on field data
  const lt1PaceTargetSecPerKm = lt2PaceSecPerKm / 0.844;
  let lt1PaceSecPerKm = Math.round(lt1PaceTargetSecPerKm);
  let lt1HR: number;
  const lt1BucketIdx = paceArr.findIndex(p => p >= lt1PaceTargetSecPerKm);
  if (lt1BucketIdx === -1) {
    // VT1 pace is beyond (slower than) all buckets — fall back to LS-derived LT1 index
    lt1HR = Math.round(hrArr[bp2]);
    lt1PaceSecPerKm = Math.round(paceArr[bp2]);
  } else if (lt1BucketIdx === 0) {
    lt1HR = Math.round(hrArr[0]);
  } else {
    const t = (lt1PaceTargetSecPerKm - paceArr[lt1BucketIdx - 1]) /
              (paceArr[lt1BucketIdx] - paceArr[lt1BucketIdx - 1]);
    lt1HR = Math.round(hrArr[lt1BucketIdx - 1] + t * (hrArr[lt1BucketIdx] - hrArr[lt1BucketIdx - 1]));
  }

  // Sanity: universal physiology — apply equally to all athletes
  log(`lt1HR=${lt1HR} lt2HR=${lt2HR} maxHR=${maxHR} lt1Pace=${lt1PaceSecPerKm} lt2Pace=${lt2PaceSecPerKm} gapP60=${gapP60} gapP85=${gapP85}`);
  if (lt1HR >= lt2HR - 5) { log("FAIL: lt1HR >= lt2HR - 5"); return null; }       // minimum 5 bpm separation
  if (lt2HR >= maxHR * 0.98) { log("FAIL: lt2HR >= maxHR*0.98"); return null; }
  if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70) { log("FAIL: lt1HR < maxHR*0.60 || lt2HR < maxHR*0.70"); return null; }
  if (lt2PaceSecPerKm >= lt1PaceSecPerKm) { log("FAIL: lt2Pace >= lt1Pace"); return null; }
  // Pace sanity: data-driven — threshold paces must be in the faster minority of training.
  // LT2 (threshold effort) must be faster than 60% of training laps;
  // LT1 (aerobic effort) must be faster than 85% of training laps.
  // These percentiles auto-scale to any athlete's fitness level.
  if (lt2PaceSecPerKm > gapP60) { log("FAIL: lt2Pace slower than gapP60"); return null; }
  if (lt1PaceSecPerKm > gapP85) { log("FAIL: lt1Pace slower than gapP85"); return null; }

  // ── 5. Build non-uniform zones ─────────────────────────────────────────
  const z2width = Math.max(8, Math.round(lt1HR * 0.07)); // same formula as buildHRZonesFromLT
  // Clamp Z1 lower bound so it never exceeds Z1 upper bound
  const z1hi = lt1HR - z2width;
  const z1lo = Math.min(restHR, z1hi - 1);
  const zones: HRZones = {
    z1: [z1lo,  z1hi],
    z2: [z1hi,  lt1HR],
    z3: [lt1HR, lt2HR],
    z4: [lt2HR, Math.min(lt2HR + 8, maxHR - 2)],
    z5: [Math.min(lt2HR + 8, maxHR - 2), maxHR],
    maxHR,
    restHR,
  };

  // Final guard: if zones are still invalid for any reason, discard
  if (!ensureValidZones(zones)) { log("FAIL: ensureValidZones rejected the built zones"); return null; }

  log(`SUCCESS: lt1HR=${lt1HR} lt2HR=${lt2HR} rSquared=${rSquared} buckets=${buckets.length}`);
  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length, zones };
}


function poolAdjacentViolators(buckets: BucketPoint[]): BucketPoint[] {
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
          count:       tc,
          totalWeight: tw,
        });
        changed = true;
        break;
      }
    }
  }
  return out;
}

export interface ActivityForZoneEstimation {
  name: string;
  sportType: string;
  startDate: Date;
  isRace: boolean | null;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  distance: number;
  movingTime: number;
  totalElevationGain: number;
  weatherTemp?: number | null;
  laps?: unknown;
}

type LapRowForZones = { average_heartrate?: number; distance: number; moving_time: number; total_elevation_gain?: number };
const ZONE_WU_CD_RE = /^\s*wu\b|^\s*cd\b|\bwarm.?up\b|\bcool.?down\b|\bnedvarvning\b|\buppvärmning\b/i;

function nameOnlyOlFilter(a: ActivityForZoneEstimation): boolean {
  return /run|trail/i.test(a.sportType) &&
    !/virtualrun/i.test(a.sportType) &&
    !/indoor|inomhus/i.test(a.name) &&
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(a.name);
}

function buildLapRunsForZones(acts: ActivityForZoneEstimation[], olFilter: (a: ActivityForZoneEstimation) => boolean) {
  return acts
    .filter(a => olFilter(a) && !ZONE_WU_CD_RE.test(a.name) && Array.isArray(a.laps))
    .flatMap(a =>
      (a.laps as LapRowForZones[])
        .filter(l => l.average_heartrate && l.distance >= 800 && l.moving_time >= 180)
        .map(l => ({
          avgHR: l.average_heartrate!,
          distanceM: l.distance,
          movingTimeSec: l.moving_time,
          totalElevationGain: l.total_elevation_gain ?? 0,
          startDate: a.startDate,
          isRace: a.isRace ?? false,
          weatherTemp: a.weatherTemp ?? null,
        }))
    );
}

function buildWholeActRunsForZones(acts: ActivityForZoneEstimation[], olFilter: (a: ActivityForZoneEstimation) => boolean) {
  return acts
    .filter(a =>
      a.averageHeartrate && olFilter(a) &&
      a.distance >= 4000 && a.movingTime >= 900 &&
      !ZONE_WU_CD_RE.test(a.name)
    )
    .map(a => ({
      avgHR: a.averageHeartrate!,
      distanceM: a.distance,
      movingTimeSec: a.movingTime,
      totalElevationGain: a.totalElevationGain,
      startDate: a.startDate,
      isRace: a.isRace ?? false,
      weatherTemp: a.weatherTemp ?? null,
    }));
}

/**
 * Single shared pipeline for statistical zone estimation — used identically by
 * updateHRZones() (live "Apply zones" calibration) and updateVO2maxAndPaces()'s
 * rolling monthly trend (LT/AT pace development chart). Both call sites must use
 * this exact function so they can never diverge: the trend's current-month point
 * always matches what the live calibration would produce on the same data.
 *
 * Validated empirically against 5+ years of real training data (scripts/rolling-lt-test.ts):
 * combining whole-activity + lap-level rows gives much better month-to-month coverage
 * and equal-or-better R² than laps-only. The OL pace-threshold exclusion is intentionally
 * gated to isRace=true only — broadening it to all activities was tried and reverted after
 * testing showed it discards legitimate easy/recovery training (which is routinely slower
 * than 1.15× LT1 pace and is not OL) far more often than it catches a genuine OL leak.
 */
// Escalation ladder for the recency half-life (days) when the standard window (90-180d,
// auto-scaled by recent training volume) finds no usable pace/HR structure. Stepped rather
// than jumping straight to full history, so the result still uses the most recent data that's
// actually sufficient — each rung only kicks in if every shorter one already failed.
const EXTENDED_HALFLIFE_LADDER_DAYS = [270, 365, 545, 730, 1095];

export function estimateZonesFromActivities(
  activities: ActivityForZoneEstimation[],
  maxHR: number,
  restHR: number,
  asOf?: Date,
  debug = false,
): StatisticalZoneResult | null {
  const runPass = (halfLifeOverrideDays?: number): StatisticalZoneResult | null => {
    if (debug) console.log(`[zones:debug] estimateZonesFromActivities: ${activities.length} candidate activities, maxHR=${maxHR} restHR=${restHR}${halfLifeOverrideDays ? ` halfLifeOverride=${halfLifeOverrideDays}d` : ""}`);
    const phase1Laps = buildLapRunsForZones(activities, nameOnlyOlFilter);
    if (debug) console.log(`[zones:debug] phase1 lap-rows=${phase1Laps.length} (from activities with a non-empty .laps array)`);
    const phase1Result = estimateZonesFromStatisticalAnalysis(phase1Laps, maxHR, restHR, asOf, debug, halfLifeOverrideDays);
    const olPaceThreshold = phase1Result ? Math.round(phase1Result.lt1PaceSecPerKm * 1.15) : 330;

    const olFilter = (a: ActivityForZoneEstimation) =>
      nameOnlyOlFilter(a) &&
      (!a.isRace || (a.averageSpeed != null && 1000 / a.averageSpeed < olPaceThreshold));

    const runs = buildWholeActRunsForZones(activities, olFilter);
    const lapRuns = buildLapRunsForZones(activities, olFilter);
    if (debug) console.log(`[zones:debug] final pass: whole-activity rows=${runs.length} lap rows=${lapRuns.length}`);
    return estimateZonesFromStatisticalAnalysis([...runs, ...lapRuns], maxHR, restHR, asOf, debug, halfLifeOverrideDays);
  };

  const standard = runPass();
  if (standard) return standard;

  for (const halfLifeDays of EXTENDED_HALFLIFE_LADDER_DAYS) {
    const extended = runPass(halfLifeDays);
    if (extended) {
      if (debug) console.log(`[zones:debug] standard window found no structure — extended pass succeeded at halfLife=${halfLifeDays}d`);
      return { ...extended, usedExtendedWindow: true };
    }
  }
  return null;
}

function segErr(paces: number[], hrs: number[], from: number, to: number, weights?: number[]): number {
  if (to - from < 2) return 0;
  const xs = paces.slice(from, to + 1), ys = hrs.slice(from, to + 1);
  const ws = weights ? weights.slice(from, to + 1) : undefined;
  const totalW = ws ? ws.reduce((s, w) => s + w, 0) : xs.length;
  const mx = ws ? xs.reduce((s, x, i) => s + x * ws[i], 0) / totalW : xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ws ? ys.reduce((s, y, i) => s + y * ws[i], 0) / totalW : ys.reduce((s, v) => s + v, 0) / ys.length;
  const sxy = ws
    ? xs.reduce((s, x, i) => s + ws[i] * (x - mx) * (ys[i] - my), 0)
    : xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const sxx = ws
    ? xs.reduce((s, x, i) => s + ws[i] * (x - mx) ** 2, 0)
    : xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = sxy / (sxx || 1e-6);
  const b = my - slope * mx;
  return ws
    ? xs.reduce((s, x, i) => s + ws[i] * (ys[i] - (slope * x + b)) ** 2, 0)
    : xs.reduce((s, x, i) => s + (ys[i] - (slope * x + b)) ** 2, 0);
}

// Classify an average HR value into a zone (1-5). Returns 0 if no HR.
export function classifyHRZone(avgHR: number | null, zones: HRZones): number {
  if (!avgHR) return 0;
  if (avgHR < zones.z1[1]) return 1;
  if (avgHR < zones.z2[1]) return 2;
  if (avgHR < zones.z3[1]) return 3;
  if (avgHR < zones.z4[1]) return 4;
  return 5;
}

export interface ZoneTimeActivity {
  startDate: Date;
  movingTime: number;
  averageHeartrate: number | null;
  laps?: unknown;
}

export interface ZoneTimeResult {
  zoneSeconds: Record<string, number>; // z1..z5
  polZ1: number; polZ2: number; polZ3: number; // Seiler low/moderate/high seconds
}

type ZoneBoundaries = Pick<HRZones, "z1" | "z2" | "z3" | "z4" | "z5">;

/**
 * Time-in-zone from activities since `windowStart`, using lap-level HR when an activity
 * has laps (so a session that mixes warmup/hard intervals/cooldown gets its time split
 * across the zones actually experienced) and falling back to the whole-activity average
 * HR only when no laps exist. Classifying by whole-activity average alone systematically
 * hides time in the extreme zones (Z1 and Z4/Z5) for any mixed-effort session, since the
 * blended average gets pulled toward the middle zones.
 */
export function computeZoneTime(
  activities: ZoneTimeActivity[],
  zones: ZoneBoundaries,
  windowStart: Date,
): ZoneTimeResult {
  const zoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let polZ1 = 0, polZ2 = 0, polZ3 = 0;
  const lt1hr = zones.z2[1];
  const lt2hr = zones.z4[0];

  const accumulate = (hr: number, sec: number) => {
    const z = hr < zones.z1[1] ? 1 : hr < zones.z2[1] ? 2 : hr < zones.z3[1] ? 3 : hr < zones.z4[1] ? 4 : 5;
    zoneSeconds[`z${z}`] += sec;
    if (hr < lt1hr) polZ1 += sec;
    else if (hr < lt2hr) polZ2 += sec;
    else polZ3 += sec;
  };

  for (const a of activities) {
    if (a.startDate < windowStart) continue;
    const laps = Array.isArray(a.laps)
      ? (a.laps as { average_heartrate?: number; moving_time: number }[])
          .filter(l => l.average_heartrate && l.moving_time > 0)
      : [];
    if (laps.length > 0) {
      for (const l of laps) accumulate(l.average_heartrate!, l.moving_time);
    } else if (a.averageHeartrate) {
      accumulate(a.averageHeartrate, a.movingTime);
    }
  }

  return { zoneSeconds, polZ1, polZ2, polZ3 };
}

// Daniels VDOT pace tables. Returns pace zones in seconds per km.
// Based on Jack Daniels' Running Formula.
export function buildPaceZones(vdot: number): PaceZones {
  // Daniels tables for key paces (sec/km):
  // Easy = 59-74% vdot, Marathon = 75-84%, Threshold = 83-88%, Interval = 95-100%, Rep = 105-110%
  const vo2 = vdot;
  // Use velocity at VDOT to get threshold pace (T pace = ~88% VO2max velocity)
  const vO2maxVelocity = vdotToVelocity(vo2); // m/s

  const easyLow  = 1000 / (vO2maxVelocity * 0.59);
  const easyHigh = 1000 / (vO2maxVelocity * 0.74);
  const marLow   = 1000 / (vO2maxVelocity * 0.75);
  const marHigh  = 1000 / (vO2maxVelocity * 0.84);
  const thrLow   = 1000 / (vO2maxVelocity * 0.83);
  const thrHigh  = 1000 / (vO2maxVelocity * 0.88);
  const intLow   = 1000 / (vO2maxVelocity * 0.95);
  const intHigh  = 1000 / (vO2maxVelocity * 1.00);
  const repLow   = 1000 / (vO2maxVelocity * 1.05);
  const repHigh  = 1000 / (vO2maxVelocity * 1.10);

  return {
    easy:       [easyLow, easyHigh],
    marathon:   [marLow, marHigh],
    threshold:  [thrLow, thrHigh],
    interval:   [intLow, intHigh],
    repetition: [repLow, repHigh],
    vdot,
  };
}

export function buildPaceZonesFromLT(lt1PaceSecPerKm: number, lt2PaceSecPerKm: number): PaceZones {
  // All zone math in velocity space (m/s), not sec/km, to preserve correct % relationships.
  // LT2 ≈ 88% vVO2max for well-trained endurance athletes (Seiler 2010, Esteve-Lanao 2007).
  const lt2Vel  = 1000 / lt2PaceSecPerKm; // m/s
  const vVO2max = lt2Vel / 0.88;
  const paceAt  = (frac: number) => Math.round(1000 / (vVO2max * frac)); // sec/km

  return {
    easy:       [paceAt(0.74), paceAt(0.59)],      // 59–74% vVO2max
    marathon:   [paceAt(0.84), paceAt(0.75)],      // 75–84% vVO2max
    threshold:  [lt1PaceSecPerKm, lt2PaceSecPerKm], // anchored to actual LT1/LT2
    interval:   [paceAt(1.00), paceAt(0.95)],      // 95–100% vVO2max
    repetition: [paceAt(1.10), paceAt(1.05)],      // 105–110% vVO2max
    vdot: 0,
  };
}

// Convert VDOT to velocity at VO2max (m/s).
// Approximation: VO2 = 0.000104v³ - 0.182258v² + 4.6v - 4.31 (Daniels)
// Invert numerically.
function vdotToVelocity(vdot: number): number {
  // Daniels: VO2 at pace v (m/min) ≈ -4.60 + 0.182258v + 0.000104v²
  // Invert with Newton's method. Good initial guess: VDOT 50 → ~268 m/min.
  // Linear approximation: v ≈ vdot * 5.0 m/min is a safe starting point.
  let v = vdot * 5.0; // m/min — reasonable across VDOT 30-80
  for (let i = 0; i < 30; i++) {
    const f = -4.60 + 0.182258 * v + 0.000104 * v * v - vdot;
    const df = 0.182258 + 2 * 0.000104 * v;
    if (Math.abs(df) < 1e-10) break;
    v -= f / df;
  }
  return v / 60; // m/s
}
