/**
 * Multi-model VO2max estimation.
 *
 * Models (with race PBs present / without):
 *   1. Daniels VDOT          — per-distance VDOT from race PBs/quality runs  (0.55 / 0.00)
 *   2. Critical Speed         — linear regression across race PB distances     (0.15 / 0.00)
 *   3. HR-pace regression     — Firstbeat-style slope, recency-weighted        (0.15–0.22 / 0.35–0.45)
 *   4. Uth-Sørensen (2003)   — 15 × (HRmax/HRrest)                           (0.05 / 0.10)
 *   5. Cooper (1968)          — 15.3 × (HRmax/HRrest)                         (0.03 / 0.07)
 *   6. Fitness decay bridge   — last known VDOT × decay factor                 (0.02 / 0.05)
 *
 * Key rule: easy runs NEVER lower the estimate.
 *   Interval sessions excluded from HR-pace regression (avg pace diluted by warm-up).
 *   Fitness decay applied when no quality session in last 14+ days.
 */

import { RACE_DISTANCES } from "./paces";
import { estimateCriticalSpeed, type CriticalSpeedResult } from "./critical-speed";

export interface VO2maxEstimate {
  value: number;
  vdot: number;
  confidence: "high" | "medium" | "low";
  method: string;
  breakdown?: Record<string, number>; // model → estimate
}

// ── Daniels VDOT formula ─────────────────────────────────────────────────

export function vdotFromRace(distanceM: number, timeSec: number): number {
  const v = distanceM / timeSec * 60; // m/min
  const pctVO2max = percentVO2maxFromDuration(timeSec / 60);
  const vo2atPace = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return vo2atPace / pctVO2max;
}

function percentVO2maxFromDuration(minutes: number): number {
  if (minutes <= 3.5)  return 1.00;
  if (minutes <= 5)    return 0.975;
  if (minutes <= 8)    return 0.96;
  if (minutes <= 10)   return 0.952;
  if (minutes <= 15)   return 0.942;
  if (minutes <= 20)   return 0.936;
  if (minutes <= 30)   return 0.927;
  if (minutes <= 40)   return 0.92;
  if (minutes <= 60)   return 0.907;
  if (minutes <= 90)   return 0.892;
  if (minutes <= 120)  return 0.88;
  return 0.865;
}

// ── Predict race time from VDOT ───────────────────────────────────────────

export function predictRaceTime(vdot: number, distanceM: number): number {
  let lo = distanceM / 15, hi = distanceM * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(distanceM, mid) > vdot) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export function tsbAdjustedRaceTime(baseTimeSec: number, tsb: number): number {
  const adj = Math.max(Math.min(-tsb * 0.0005, 0.08), -0.04);
  return Math.round(baseTimeSec * (1 + adj));
}

/** Riegel formula: T2 = T1 × (D2/D1)^exponent
 *  exponent: 1.04 advanced, 1.06 standard, 1.08 beginners
 */
export function riegelPredict(t1Sec: number, d1M: number, d2M: number, exponent = 1.06): number {
  return Math.round(t1Sec * Math.pow(d2M / d1M, exponent));
}

/** ±% confidence interval based on empirical error margins.
 *  uncertaintyMultiplier widens the band for predictions that lean heavily on an
 *  extrapolation with no nearby real result (see blendedRacePrediction). */
export function predictionRange(predictedSec: number, distM: number, uncertaintyMultiplier = 1): { lo: number; hi: number } {
  const basePct = distM >= 42000 ? 0.06 : distM >= 21000 ? 0.04 : distM >= 10000 ? 0.03 : 0.025;
  const pct = Math.min(0.30, basePct * uncertaintyMultiplier);
  return {
    lo: Math.round(predictedSec * (1 - pct)),
    hi: Math.round(predictedSec * (1 + pct)),
  };
}

// ── HR-based models ───────────────────────────────────────────────────────

/** Uth-Sørensen-Overgaard-Pedersen (2003): VO2max = 15 × HRmax/HRrest */
export function vo2maxUth(maxHR: number, restHR: number): number {
  return 15 * (maxHR / restHR);
}

/** Cooper (1968): VO2max = 15.3 × HRmax/HRrest */
export function vo2maxCooper(maxHR: number, restHR: number): number {
  return 15.3 * (maxHR / restHR);
}

/**
 * HR-pace regression (Firstbeat-style), recency-weighted.
 * Weighted least squares: VO2 = a × HR + b
 * Excludes interval sessions (avg pace diluted by warm-up/recovery).
 * Uses exponential recency weighting (180-day half-life).
 */
export function vo2maxHRPaceRegression(
  runs: Array<{ avgHR: number; avgPaceSecPerKm: number; weight?: number }>,
  maxHR: number,
): number | null {
  const valid = runs.filter(r =>
    r.avgHR > maxHR * 0.60 && r.avgHR < maxHR * 0.92 &&
    r.avgPaceSecPerKm > 180 && r.avgPaceSecPerKm < 600
  );
  if (valid.length < 4) return null;

  const points = valid.map(r => {
    const vMin = 1000 / r.avgPaceSecPerKm * 60;
    const vo2 = -4.60 + 0.182258 * vMin + 0.000104 * vMin * vMin;
    return { hr: r.avgHR, vo2, w: r.weight ?? 1.0 };
  });

  // Weighted least squares
  const sumW    = points.reduce((s, p) => s + p.w, 0);
  const sumWHR  = points.reduce((s, p) => s + p.w * p.hr, 0);
  const sumWVO2 = points.reduce((s, p) => s + p.w * p.vo2, 0);
  const sumWHR2 = points.reduce((s, p) => s + p.w * p.hr * p.hr, 0);
  const sumWHRVO2 = points.reduce((s, p) => s + p.w * p.hr * p.vo2, 0);
  const denom = sumW * sumWHR2 - sumWHR * sumWHR;
  if (Math.abs(denom) < 1e-6) return null;

  const a = (sumW * sumWHRVO2 - sumWHR * sumWVO2) / denom;
  const b = (sumWVO2 - a * sumWHR) / sumW;

  const vo2atMax = a * maxHR + b;
  return vo2atMax > 30 && vo2atMax < 90 ? vo2atMax : null;
}

/** Returns the regression slope and intercept for HR→VO2 extrapolation, or null. */
export function buildHRPaceRegressionParams(
  runs: Array<{ avgHR: number; avgPaceSecPerKm: number; weight?: number }>,
  maxHR: number,
): { slope: number; intercept: number } | null {
  const valid = runs.filter(r =>
    r.avgHR > maxHR * 0.60 && r.avgHR < maxHR * 0.92 &&
    r.avgPaceSecPerKm > 180 && r.avgPaceSecPerKm < 600
  );
  if (valid.length < 4) return null;

  const points = valid.map(r => {
    const vMin = 1000 / r.avgPaceSecPerKm * 60;
    const vo2 = -4.60 + 0.182258 * vMin + 0.000104 * vMin * vMin;
    return { hr: r.avgHR, vo2, w: r.weight ?? 1.0 };
  });

  const sumW    = points.reduce((s, p) => s + p.w, 0);
  const sumWHR  = points.reduce((s, p) => s + p.w * p.hr, 0);
  const sumWVO2 = points.reduce((s, p) => s + p.w * p.vo2, 0);
  const sumWHR2 = points.reduce((s, p) => s + p.w * p.hr * p.hr, 0);
  const sumWHRVO2 = points.reduce((s, p) => s + p.w * p.hr * p.vo2, 0);
  const denom = sumW * sumWHR2 - sumWHR * sumWHR;
  if (Math.abs(denom) < 1e-6) return null;

  const slope = (sumW * sumWHRVO2 - sumWHR * sumWVO2) / denom;
  const intercept = (sumWVO2 - slope * sumWHR) / sumW;
  return { slope, intercept };
}

/**
 * Critical Speed (CS) model — linear regression of distance vs time across PBs.
 * CS ≈ LT2 pace (the highest sustainable aerobic speed).
 * vVO2max ≈ CS × 1.04.
 * Requires ≥2 PBs; best with 3+ across a range of distances (3-30 min duration).
 */
export function criticalSpeedFromPBs(
  pbs: Array<{ distanceM: number; timeSec: number }>,
): { vdot: number; csPaceSecPerKm: number } | null {
  const valid = pbs.filter(p => p.timeSec >= 120 && p.timeSec <= 2400 && p.distanceM >= 800);
  if (valid.length < 2) return null;

  // Linear regression: distanceM = CS * timeSec + D'
  const n = valid.length;
  const sumT  = valid.reduce((s, p) => s + p.timeSec, 0);
  const sumD  = valid.reduce((s, p) => s + p.distanceM, 0);
  const sumT2 = valid.reduce((s, p) => s + p.timeSec * p.timeSec, 0);
  const sumTD = valid.reduce((s, p) => s + p.timeSec * p.distanceM, 0);
  const denom = n * sumT2 - sumT * sumT;
  if (Math.abs(denom) < 1e-6) return null;

  const csMs = (n * sumTD - sumT * sumD) / denom; // m/s
  if (csMs <= 0 || csMs > 10) return null; // sanity: 0–36 km/h

  // vVO2max is ~4% faster than CS (CS ≈ LT2 pace)
  const vVO2maxMs = csMs * 1.04;
  const vVO2maxPaceSecPerKm = 1000 / vVO2maxMs;
  // Use a representative ~3K duration at vVO2max to get VDOT
  const approxTimeSec = 3000 / vVO2maxMs;
  const vdot = vdotFromRace(3000, approxTimeSec);

  return { vdot, csPaceSecPerKm: Math.round(1000 / csMs) };
}

/** Submaximal effort extrapolation (Åstrand-Ryhming adapted for running) */
export function vo2maxFromSubmaxEffort(
  avgPaceSecPerKm: number,
  avgHR: number,
  maxHR: number,
): number {
  const v = 1000 / avgPaceSecPerKm * 60;
  const vo2AtPace = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return vo2AtPace / (avgHR / maxHR);
}

// ── Grade-Adjusted Pace ───────────────────────────────────────────────────

/**
 * Adjust flat pace for elevation gain using the Minetti (2002) piecewise metabolic cost model.
 * Cmet(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6  (W·kg⁻¹·m⁻¹)
 * GAP = rawPace × Cmet(0)/Cmet(i) = rawPace / (Cmet(i)/3.6)
 * Replaces the linear 0.033 approximation which was nearly flat for fractional grades.
 */
export function gradeAdjustedPace(paceSecPerKm: number, elevGainM: number, distM: number): number {
  if (distM < 500 || elevGainM <= 0) return paceSecPerKm;
  const i = Math.min(0.25, elevGainM / distM);
  const cost = (155.4*i**5 - 30.4*i**4 - 43.3*i**3 + 46.3*i**2 + 19.5*i + 3.6) / 3.6;
  return paceSecPerKm / cost;
}

/**
 * VDOT estimate from a tempo/threshold training run (not a race).
 * Applies when avgHR is in the 83–90% maxHR range — this is threshold effort.
 * Threshold pace ≈ avgPace / 0.95 (runner is at ~95% of threshold during a tempo).
 * Returns null if HR is outside the tempo range.
 */
export function vdotFromTempoRun(
  avgGapSecPerKm: number,
  avgHR: number,
  maxHR: number,
): number | null {
  const hrFraction = avgHR / maxHR;
  if (hrFraction < 0.82 || hrFraction > 0.92) return null;
  // Conservative: at 88% HRmax the runner covers ~95% of threshold pace
  const thresholdPace = avgGapSecPerKm / 0.95;
  // Threshold ≈ 60-min all-out → approximate with 3500m equivalent duration
  const approxTimeSec = thresholdPace * 3.5;
  const v = vdotFromRace(3500, approxTimeSec);
  return v > 30 && v < 90 ? v : null;
}

// ── Personalized fatigue exponent (power-law, Gemini 2025) ───────────────────

/**
 * Derives a personalized Riegel-style fatigue exponent by fitting a power-law
 * V = V_ref × (D/D_ref)^k to the runner's actual best efforts in log-log space.
 *
 * Endurance specialists: k ≈ −0.05 (exponent ≈ 1.05).
 * Average runner: k ≈ −0.06 (exponent ≈ 1.06, matches standard Riegel).
 * Explosive / undertrained: k ≈ −0.12 (exponent ≈ 1.12).
 *
 * Returns k (the log-log slope) or null if insufficient data.
 * Convert to Riegel exponent: exp = 1 − k.
 */
export function personalizedFatigueExponent(
  bestEfforts: Array<{ distance: number; elapsed_time: number }>,
): number | null {
  // Beyond 10K, a bestEffort segment is almost never a genuine flat maximal effort for
  // this kind of runner — it's either a submaximal segment pulled from an ordinary long
  // training run, or (verified against real data, see RACE_ESTIMATE_PERSONALIZATION_PLAN)
  // a race-flagged orienteering result, whose pace reflects terrain/navigation, not road
  // speed, at ANY distance. Activity.isRace can't be used to rescue long-distance points
  // here: for this dataset literally every isRace=true activity is an orienteering event
  // (verified — zero road races are ever flagged isRace), so trusting "isRace" beyond
  // 10K would feed in slow technical-terrain pace as if it were road race data. Implied
  // VDOT from this runner's own bestEfforts stays consistent (53.8-60) through 10K, then
  // crashes hard beyond it (≈41 at 15K, ≈36 at 20-21K, ≈27 at marathon distance) — that
  // gap is terrain/pacing, not real fatigue. RaceRecord PBs (separate, user-confirmed,
  // already validated clean for this runner) remain the only trusted source beyond 10K.
  const valid = bestEfforts.filter(e =>
    e.distance >= 1000 && e.distance <= 10000 && e.elapsed_time > 0
  );

  // Keep only fastest per distance
  const byDistance = new Map<number, number>();
  for (const e of valid) {
    const existing = byDistance.get(e.distance);
    if (!existing || e.elapsed_time < existing) byDistance.set(e.distance, e.elapsed_time);
  }
  if (byDistance.size < 3) return null;

  const pts = [...byDistance.entries()].map(([d, t]) => ({
    logD: Math.log(d),
    logV: Math.log(d / t),
  }));

  const n = pts.length;
  const sumX  = pts.reduce((s, p) => s + p.logD, 0);
  const sumY  = pts.reduce((s, p) => s + p.logV, 0);
  const sumXY = pts.reduce((s, p) => s + p.logD * p.logV, 0);
  const sumX2 = pts.reduce((s, p) => s + p.logD * p.logD, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;

  const k = (n * sumXY - sumX * sumY) / denom;
  // Plausible physiological range (outside → bad data or model misfit)
  if (k > -0.01 || k < -0.20) return null;
  return k;
}

// ── Local/bracket-based personalized race prediction ────────────────────────

export interface KnownPerformance { distanceM: number; timeSec: number }

/**
 * Merges race PBs (RaceRecord) with activity bestEfforts (Strava rolling-window segments)
 * into one deduplicated set of real performances, keyed by rounded distance. Race PBs win
 * ties at the same distance since they're a confirmed result, not a segment pulled from
 * inside a longer activity.
 *
 * Both sources are trusted up to 10K unconditionally. Beyond 10K, bestEfforts are never
 * trusted (see personalizedFatigueExponent for why Activity.isRace can't rescue longer
 * segments) — and since automatic PB detection was added, RaceRecord beyond 10K is ONLY
 * trusted when manually entered (callers must already filter `racePBs` to isManual-only
 * beyond 10K, see lib/fitness/cache.ts::loadRacePBs() and the equivalent block in
 * app/(dashboard)/stats/page.tsx). RaceRecord used to be safe to trust unconditionally at
 * any distance because it only ever held manually-vetted entries — an auto-detected entry
 * can come from any isRace=true activity, and for this app's primary athlete that's
 * exclusively orienteering (terrain/navigation pace, not road pace).
 *
 * `racePBs`' floor is 200m (not 1000m) — a genuine sub-1000m PB (e.g. a 400m) is the
 * strongest available evidence of anaerobic speed reserve and was previously thrown away
 * entirely (see RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md §3.1/§5.5). `bestEfforts`
 * keeps its 1000m floor — sub-1000m segments pulled from inside a longer activity are
 * noisier (acceleration phases, GPS lag) than a runner's own logged PB at that distance.
 *
 * `lowerTierCandidates` (optional) — estimated, lower-confidence anchors from
 * extractTempoRunAnchors()/extractIntervalLapCandidates() (§5.4/§5.10): only used to fill a
 * distance bucket that has NO trusted racePB/bestEffort coverage, never allowed to override
 * or compete with measured data.
 */
export function buildKnownPerformances(
  racePBs: Array<{ distanceM: number; timeSec: number }>,
  bestEfforts: Array<{ distance: number; elapsed_time: number }>,
  lowerTierCandidates?: KnownPerformance[],
): KnownPerformance[] {
  const merged = new Map<number, number>();
  for (const e of bestEfforts) {
    if (e.distance < 1000 || e.distance > 10000 || e.elapsed_time <= 0) continue;
    const d = Math.round(e.distance);
    if (!merged.has(d) || merged.get(d)! > e.elapsed_time) merged.set(d, e.elapsed_time);
  }
  for (const p of racePBs) {
    if (p.distanceM < 200 || p.timeSec <= 0) continue;
    const d = Math.round(p.distanceM);
    if (!merged.has(d) || merged.get(d)! > p.timeSec) merged.set(d, p.timeSec);
  }
  if (lowerTierCandidates) {
    const trustedDistances = [...merged.keys()]; // snapshot before lower-tier ever touches `merged`
    const trustedBuckets = new Set(trustedDistances);
    // A lower-tier candidate is only useful where it fills a genuine gap. Verified necessary
    // against real data: dropping one in right next to an already-trusted point (e.g. a 791m
    // interval lap sitting between trusted 400m and 1000m PBs) doesn't add coverage — it just
    // out-competes the closer, higher-quality trusted point for any target distance that lands
    // between them, because bracket selection only looks at proximity, not source confidence
    // (see RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md implementation notes).
    const MIN_GAP_RATIO = 1.5;
    const tooCloseToTrusted = (d: number) =>
      trustedDistances.some(t => Math.max(d, t) / Math.min(d, t) < MIN_GAP_RATIO);
    const lowerTierMerged = new Map<number, number>();
    for (const c of lowerTierCandidates) {
      if (c.distanceM <= 0 || c.timeSec <= 0) continue;
      const d = Math.round(c.distanceM);
      if (trustedBuckets.has(d) || tooCloseToTrusted(d)) continue; // never overrides or crowds trusted data above
      // Among multiple lower-tier candidates landing on the same untrusted bucket, keep the
      // fastest, not just whichever happened to come first in the input array.
      if (!lowerTierMerged.has(d) || lowerTierMerged.get(d)! > c.timeSec) lowerTierMerged.set(d, c.timeSec);
    }
    for (const [d, t] of lowerTierMerged) merged.set(d, t);
  }
  return [...merged.entries()].map(([distanceM, timeSec]) => ({ distanceM, timeSec }));
}

interface LocalPrediction { timeSec: number; exponent: number; anchor: KnownPerformance; bracketed: boolean }

// Anaerobic/aerobic energy-contribution crossover (Péronnet & Thibault, 1989: aerobic share
// of total energy passes 50% at ~100s, ≈800m) — below this, a runner's fatigue profile is
// dominated by anaerobic capacity, not aerobic endurance. A bracket spanning this boundary
// (e.g. a 400m anchor paired with a 5000m anchor) would fit ONE exponent across two different
// physiological regimes — exactly the mixing problem this whole local-bracket model exists to
// avoid (see RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md §5.5). Only relevant once
// buildKnownPerformances' lowered 200m floor can actually produce a sub-800m anchor.
const REGIME_BOUNDARY_M = 800;
// Literature range for speed-oriented/anaerobic-leaning runners (vs. standard Riegel 1.06) —
// used only when extrapolating from a sub-800m anchor, never for the existing 1000m+ regime.
const SHORT_REGIME_FALLBACK_EXPONENT = 1.04;

/**
 * Predicts race time at targetM from the runner's own nearby real results, instead of
 * one fixed anchor + one global exponent applied across the whole distance range.
 *
 * When real results exist on both sides of targetM, fits a LOCAL Riegel exponent
 * between just those two — this never mixes physiologically different regimes (e.g. a
 * 1K race-pace effort and a submaximal marathon-pace long run) into one slope, because
 * it only ever looks at the two points immediately bracketing the target. When only one
 * side has data, falls back to `fallbackExponent` from that single anchor — bracketed:
 * false signals the caller this is an extrapolation, not an interpolation.
 */
export function personalizedRacePrediction(
  targetM: number,
  knownPerformances: KnownPerformance[],
  fallbackExponent: number,
): LocalPrediction | null {
  const valid = knownPerformances.filter(p => p.timeSec > 0 && p.distanceM > 0);
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.distanceM - b.distanceM);
  const below = [...sorted].reverse().find(p => p.distanceM <= targetM) ?? null;
  const above = sorted.find(p => p.distanceM >= targetM) ?? null;

  const closerOf = (a: KnownPerformance, b: KnownPerformance) =>
    Math.abs(Math.log(targetM / a.distanceM)) <= Math.abs(Math.log(targetM / b.distanceM)) ? a : b;
  const spansRegimeBoundary = (a: KnownPerformance, b: KnownPerformance) =>
    (a.distanceM < REGIME_BOUNDARY_M) !== (b.distanceM < REGIME_BOUNDARY_M);

  // Real results on both sides, far enough apart to fit a stable local slope (an
  // extremely tight bracket would amplify GPS/segment noise into a wild exponent), and not
  // straddling the anaerobic/aerobic crossover: interpolate between them rather than
  // extrapolating from a single global exponent.
  if (below && above && below !== above && above.distanceM / below.distanceM >= 1.02
      && !spansRegimeBoundary(below, above)) {
    const localExp = Math.log(above.timeSec / below.timeSec) / Math.log(above.distanceM / below.distanceM);
    const exponent = Math.min(1.25, Math.max(0.95, localExp));
    const anchor = closerOf(below, above);
    const timeSec = Math.round(anchor.timeSec * Math.pow(targetM / anchor.distanceM, exponent));
    return { timeSec, exponent, anchor, bracketed: true };
  }

  const anchor = below && above ? closerOf(below, above) : (below ?? above!);
  const exponentForAnchor = anchor.distanceM < REGIME_BOUNDARY_M ? SHORT_REGIME_FALLBACK_EXPONENT : fallbackExponent;
  const timeSec = Math.round(anchor.timeSec * Math.pow(targetM / anchor.distanceM, exponentForAnchor));
  return { timeSec, exponent: exponentForAnchor, anchor, bracketed: false };
}

// ── §5.9: detect and exclude mid-race splits mistakenly entered as standalone PBs ────────
//
// Verified against real data (RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md §2.3): every
// manually-entered RaceRecord sharing a stravaActivityId with a LONGER-distance entry from
// the same activity is a progressive checkpoint time, not an independent maximal effort —
// e.g. a "3000m PB" that's actually the 3K split inside a 10K race reflects 10K pacing, not
// all-out 3K speed. Only the longest distance in such a group is a genuine result at its own
// target distance; shorter ones are excluded entirely (the blend already degrades gracefully
// to the population curve when a distance has no trusted anchor — see blendedRacePrediction).
export interface RaceRecordForTrust {
  distanceM: number;
  timeSec: number;
  date: Date;
  isManual: boolean;
  stravaActivityId?: string | null;
}

export function buildTrustedRacePBs(records: RaceRecordForTrust[]): RacePB[] {
  // Existing rule (BUG_AUDIT_2026_06_25): beyond 10K, only a manually-entered PB is trusted.
  const candidates = records.filter(r => !(r.distanceM > 10000 && !r.isManual));

  const byActivity = new Map<string, RaceRecordForTrust[]>();
  const standalone: RaceRecordForTrust[] = [];
  for (const r of candidates) {
    if (r.stravaActivityId) {
      if (!byActivity.has(r.stravaActivityId)) byActivity.set(r.stravaActivityId, []);
      byActivity.get(r.stravaActivityId)!.push(r);
    } else {
      standalone.push(r);
    }
  }
  const trusted = [...standalone];
  for (const group of byActivity.values()) {
    trusted.push(group.length === 1 ? group[0] : group.reduce((a, b) => a.distanceM > b.distanceM ? a : b));
  }

  const bestPerDist = new Map<number, RacePB>();
  for (const r of trusted) {
    if (r.distanceM <= 0 || r.timeSec <= 0) continue;
    const d = Math.round(r.distanceM);
    if (!bestPerDist.has(d) || bestPerDist.get(d)!.timeSec > r.timeSec)
      bestPerDist.set(d, { distanceM: r.distanceM, timeSec: r.timeSec, date: r.date });
  }
  return [...bestPerDist.values()];
}

// ── §5.10: mine fast laps from interval sessions as a new, lowest-priority anchor tier ────
//
// isQualitySession()/looksLikeIntervals() correctly exclude whole-interval-activity pace from
// quality-session analysis (the activity average is diluted by recovery jogs between reps) —
// but nothing previously extracted the FAST reps themselves as evidence. Verified against real
// data (§2.4): "400ingar"/"5x4" work-lap paces are meaningfully faster than this athlete's only
// available 3K "PB" (itself contaminated, see buildTrustedRacePBs), and exist at moderate, not
// maximal, HR — real, currently-unused evidence of short-distance speed.
export interface LapForIntervalMining { distance: number; moving_time: number }

// No legitimate training rep (even an elite sprinter's flying 100m) sustains faster than this —
// anything quicker is GPS/lap-button noise (e.g. a 631m "lap" timed at 33s implies 68km/h).
// Verified necessary against real data: very short (<300m) laps include exactly this kind of
// implausible outlier alongside genuine fast reps, and the median-pace work/recovery split
// alone doesn't catch it (noise can land on either side of the session median).
const MIN_PLAUSIBLE_PACE_SEC_PER_KM = 135; // ~7.4 m/s, faster than sustained elite 800m pace

// "interval"-named sessions in this dataset range from sharp track work to easy fartlek —
// far too heterogeneous to trust every lap that merely beats its own session's median pace
// (verified necessary: an early version of this function kept every such lap and produced
// ~250 candidates densely clustered around 300-1300m, several mutually inconsistent by
// 20+ implied VDOT points, which corrupted nearby brackets — see implementation notes in
// RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md). Keeping only the SINGLE fastest qualifying
// lap per session caps this at roughly one candidate per interval session, and the VDOT floor
// below rejects a session whose "fastest lap" still wasn't a genuinely hard effort.
const MIN_PLAUSIBLE_VDOT_FOR_INTERVAL_REP = 40;

export function extractIntervalLapCandidates(
  activities: Array<{ name: string; laps?: unknown }>,
): KnownPerformance[] {
  const candidates: KnownPerformance[] = [];
  for (const a of activities) {
    if (!looksLikeIntervals(a.name ?? "") || !Array.isArray(a.laps)) continue;
    const laps = (a.laps as LapForIntervalMining[]).filter(l => l.distance > 100 && l.moving_time > 0);
    if (laps.length < 3) continue;
    const paces = laps.map(l => l.moving_time / (l.distance / 1000)).sort((x, y) => x - y);
    const medianPace = paces[Math.floor(paces.length / 2)];

    let best: { distanceM: number; timeSec: number; pace: number } | null = null;
    for (const l of laps) {
      if (l.distance < 300 || l.distance > 2000 || l.moving_time < 40) continue; // plausible single-rep distance/duration
      const pace = l.moving_time / (l.distance / 1000);
      if (pace < MIN_PLAUSIBLE_PACE_SEC_PER_KM) continue; // GPS/lap-button noise, not a real pace
      // A "work" rep is meaningfully faster than this session's own median lap pace — separates
      // reps from recovery jogs without needing a fixed duration/distance cutoff per workout type.
      if (pace > medianPace * 0.92) continue;
      if (!best || pace < best.pace) best = { distanceM: l.distance, timeSec: l.moving_time, pace };
    }
    if (best && vdotFromRace(best.distanceM, best.timeSec) >= MIN_PLAUSIBLE_VDOT_FOR_INTERVAL_REP) {
      candidates.push({ distanceM: best.distanceM, timeSec: best.timeSec });
    }
  }
  return candidates;
}

// ── §5.4: convert the single best qualifying tempo/threshold run into one equivalent
// maximal-effort anchor ──────────────────────────────────────────────────────────────────
//
// vo2maxFromSubmaxEffort() already exists but was never called anywhere — it's exactly the
// missing conversion step: submax HR/pace at a real run's own distance → an estimated VO2max
// → an equivalent ALL-OUT time at that same distance via predictRaceTime(). Gives the bracket
// model a real (if lower-confidence, ~10-15% SEE per Åstrand-Ryhming-style submax extrapolation)
// anchor in the 10-25K range from training data alone, instead of extrapolating one exponent
// from a single distant race PB. Same HR-fraction band as vdotFromTempoRun (82-92% maxHR).
//
// Deliberately returns AT MOST ONE point, not a dense per-distance sweep: verified necessary
// against real data — several independently-estimated submax points (each already carrying
// ~10-15% uncertainty) can land close enough together to form a tight, falsely-confident
// bracket with each other, which is worse than a single-sided extrapolation from real data
// (see RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md implementation notes).
export interface TempoRunForAnchoring {
  distanceM: number;
  timeSec: number;
  avgHR: number | null;
  totalElevationGain?: number | null;
  name?: string;
}

export function extractTempoRunAnchors(
  runs: TempoRunForAnchoring[],
  maxHR: number,
): KnownPerformance[] {
  let best: { distanceM: number; vEst: number } | null = null;
  for (const r of runs) {
    if (!r.avgHR || r.distanceM < 10000 || r.distanceM > 25000 || r.timeSec < 40 * 60) continue;
    if (looksLikeIntervals(r.name ?? "") || looksLikeRace(r.name ?? "")) continue;
    const hrFraction = r.avgHR / maxHR;
    if (hrFraction < 0.82 || hrFraction > 0.92) continue;
    const rawPace = r.timeSec / (r.distanceM / 1000);
    const gap = gradeAdjustedPace(rawPace, r.totalElevationGain ?? 0, r.distanceM);
    const vEst = vo2maxFromSubmaxEffort(gap, r.avgHR, maxHR);
    if (!(vEst > 30 && vEst < 90)) continue;
    if (!best || vEst > best.vEst) best = { distanceM: r.distanceM, vEst };
  }
  return best ? [{ distanceM: best.distanceM, timeSec: predictRaceTime(best.vEst, best.distanceM) }] : [];
}

export interface RacePrediction {
  peak: number;
  riegel: number | null;
  rangeLo: number;
  rangeHi: number;
  lowConfidenceShort: boolean;
  /** Individual model votes for this distance (§5.8 UI model selector) — keyed by display name. */
  models: Record<string, number>;
}

// ── Critical Speed/W' as a third, physiologically-independent vote ──────────
//
// estimateCriticalSpeed() fits a 2-parameter hyperbolic model (Monod & Scherrer) from the
// same bestEfforts+racePBs pool used above — distinct from the log-log Riegel exponent,
// so it doesn't just restate the same evidence. A 2024/2025 systematic review of
// field-based critical-speed testing in runners (see RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN)
// found half-marathoners sustain ~97.3% of critical speed, but marathon caliber varies far
// more (elite ~95%, population average ~84.8%) — too wide a spread to pick one fraction
// for a marathon POINT estimate, so beyond half-marathon it only widens the uncertainty
// range (see blendedRacePrediction), it never votes on the number itself.
const CS_VOTE_MAX_DIST_HYPERBOLA = 15000; // mirrors critical-speed.ts's own CS_MAX_DIST fitting cutoff
const CS_VOTE_MAX_DIST_FRACTION  = 22000; // marathon-only range-widening guard (excludes HM itself)
const MARATHON_CS_FRACTION_ELITE = 0.95;
const MARATHON_CS_FRACTION_AVG   = 0.848;

interface CSVote { timeSec: number; confidence: number }

function criticalSpeedVote(targetM: number, cs: CriticalSpeedResult | null | undefined): CSVote | null {
  if (!cs || cs.csMetersPerSec <= 0) return null;
  if (targetM > CS_VOTE_MAX_DIST_HYPERBOLA) return null; // beyond this, use thresholdAnchoredVote() instead
  const confidence = Math.max(0, Math.min(1, cs.rSquared));
  const t = (targetM - cs.wPrimeMeters) / cs.csMetersPerSec;
  return t > 0 ? { timeSec: t, confidence } : null;
}

// ── §5.1/§5.2: anchor HM/Marathon to the athlete's own measured LT2 pace, not a population
// fraction-of-CS constant alone ──────────────────────────────────────────────────────────
//
// Verified against real data (RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md §2): this
// athlete's statistically-estimated LT2 pace (FitnessCache.statZonesJson, R²=0.99 — derived
// from training data via breakpoint analysis, independent of race PBs) is a meaningfully
// better threshold estimate than the CS/W' regression (R²=0.582, degraded by submaximal
// "LT!" session contamination in its 10-15K input — see §3.2). Below this distance, running
// AT OR ABOVE LT2 pace is physiologically normal (LT2/MLSS is sustainable for roughly
// 30-60 min, which covers up to ~10-15K for most runners) — the vote and hard ceiling below
// only apply from Half Marathon upward, where sustained duration clearly exceeds that window.
const LT2_VOTE_MIN_DIST     = 21097; // Half Marathon and beyond
const LT2_VOTE_MIN_RSQUARED = 0.7;   // below this, the statistical zone fit itself isn't trustworthy enough to anchor on
const HM_LT2_FRACTION_BASE       = 0.973; // field-based CS-testing review: HM ≈ 97.3% of CS/LT2
const MARATHON_LT2_FRACTION_BASE = 0.848; // same review, population-average marathon caliber — this
  // athlete's profile (strong short distance, comparatively weaker long-distance endurance,
  // established in the original 06-23 diagnosis) leans toward "average," not elite (0.95)
const MAX_PERSONAL_SUSTAIN_ADJUSTMENT = 0.04;

export interface ThresholdPaceSource { paceSecPerKm: number; confidence: number }

/** Prefers the statistical LT2 estimate when reliable; falls back to CS pace otherwise. */
function pickThresholdSource(
  lt2: { paceSecPerKm: number; rSquared: number } | null | undefined,
  cs: CriticalSpeedResult | null | undefined,
): ThresholdPaceSource | null {
  if (lt2 && lt2.paceSecPerKm > 0 && lt2.rSquared >= LT2_VOTE_MIN_RSQUARED) {
    return { paceSecPerKm: lt2.paceSecPerKm, confidence: lt2.rSquared };
  }
  if (cs && cs.csMetersPerSec > 0) {
    return { paceSecPerKm: 1000 / cs.csMetersPerSec, confidence: Math.max(0, Math.min(1, cs.rSquared)) };
  }
  return null;
}

/**
 * Long-run-history-derived nudge to the literature base fraction (Vickers & Vertosick, 2016,
 * BMC, N=2,303: weekly mileage/long-run history predicts marathon-specific fade independently
 * of any PB-derived exponent) — capped small, this only ever fine-tunes the literature base,
 * never dominates it.
 */
function personalSustainAdjustment(longestRunLast8wM: number | undefined, targetM: number): number {
  if (longestRunLast8wM === undefined || longestRunLast8wM <= 0) return 0;
  const ratio = longestRunLast8wM / targetM;
  const raw = ratio >= 0.7 ? 0.02 : ratio <= 0.25 ? -0.03 : -0.03 + (ratio - 0.25) / 0.45 * 0.05;
  return Math.max(-MAX_PERSONAL_SUSTAIN_ADJUSTMENT, Math.min(MAX_PERSONAL_SUSTAIN_ADJUSTMENT, raw));
}

function sustainFraction(targetM: number, longestRunLast8wM: number | undefined): number {
  const base = targetM >= 30000 ? MARATHON_LT2_FRACTION_BASE : HM_LT2_FRACTION_BASE;
  const adj = personalSustainAdjustment(longestRunLast8wM, targetM);
  return Math.min(0.97, Math.max(0.75, base + adj));
}

/** The pace this athlete's own measured threshold implies they can never exceed for `targetM`. */
function thresholdCeilingTimeSec(
  targetM: number,
  source: ThresholdPaceSource | null,
  longestRunLast8wM: number | undefined,
): number | null {
  if (!source || targetM < LT2_VOTE_MIN_DIST) return null;
  const paceSecPerKm = source.paceSecPerKm / sustainFraction(targetM, longestRunLast8wM);
  return paceSecPerKm * (targetM / 1000);
}

function thresholdAnchoredVote(
  targetM: number,
  source: ThresholdPaceSource | null,
  longestRunLast8wM: number | undefined,
): CSVote | null {
  const timeSec = thresholdCeilingTimeSec(targetM, source, longestRunLast8wM);
  return timeSec !== null && source ? { timeSec, confidence: source.confidence } : null;
}

/**
 * Extra range-widening when recent long-run history doesn't cover the target distance.
 * Vickers & Vertosick (2016, BMC, N=2,303) found weekly mileage/long-run history predicts
 * marathon-specific fade independently of any PB-derived exponent. Only ever widens the
 * band — never shifts the point estimate, since there's no real marathon/HM result yet to
 * validate a point-estimate change against for an athlete with no such RaceRecord.
 */
function longRunAdequacyWidenFactor(longestRunLast8wM: number | undefined, targetM: number): number {
  if (longestRunLast8wM === undefined) return 1;
  if (longestRunLast8wM <= 0) return 1.3;
  const ratio = longestRunLast8wM / targetM;
  if (ratio >= 0.8) return 1;
  if (ratio <= 0.3) return 1.4;
  return 1.4 - (ratio - 0.3) / 0.5 * 0.4;
}

/**
 * Single canonical race-time prediction for one target distance. Blends the global
 * Daniels VDOT curve ("peak" — a population-average %VO2max-vs-duration table), the local
 * bracket-based personalized model above, and (within its own valid range) the Critical
 * Speed/W' model as a third, independent vote.
 *
 * The global curve is only as good as the assumption that this runner's endurance
 * profile matches the population average through the WHOLE distance range — verified
 * false for distances where it diverges from a runner's own real results (e.g. this
 * model overestimated 10K speed by 6-16% for a runner with a spikier short-vs-long
 * profile, see RACE_ESTIMATE_PERSONALIZATION_PLAN). Real nearby results are direct
 * evidence and dominate the blend whenever they exist close to (or bracketing) the
 * target; the global curve fills in for distances with no nearby real data (e.g.
 * marathon for a runner whose longest real effort is a 15K) — there the blend leans
 * back on the global curve AND widens predictionRange(), instead of presenting an
 * overconfident sharp number built on a long single-sided extrapolation.
 */
export function blendedRacePrediction(
  targetM: number,
  vdot: number,
  knownPerformances: KnownPerformance[],
  fallbackExponent: number,
  cs?: CriticalSpeedResult | null,
  longestRunLast8wM?: number,
  lt2?: { paceSecPerKm: number; rSquared: number } | null,
): RacePrediction {
  const danielsRaw = predictRaceTime(vdot, targetM);
  const local = personalizedRacePrediction(targetM, knownPerformances, fallbackExponent);
  // ≤15K: raw CS/W' hyperbola (criticalSpeedVote). ≥HM: the athlete's own measured LT2 pace
  // when reliable, else CS pace as fallback — see thresholdAnchoredVote doc comment. The two
  // ranges never overlap, so at most one of these is ever non-null for a given targetM.
  const physVote = criticalSpeedVote(targetM, cs)
    ?? thresholdAnchoredVote(targetM, pickThresholdSource(lt2, cs), longestRunLast8wM);

  let blended: number;
  let riegelOut: number | null;
  let lowConfidenceShort: boolean;
  let groundedWeight: number; // local + physVote share — scales the uncertainty band below

  if (!local) {
    if (physVote) {
      const wVote = physVote.confidence * 0.5; // no personal bracket at all — lean on the vote, but stay cautious
      blended = Math.round(wVote * physVote.timeSec + (1 - wVote) * danielsRaw);
      groundedWeight = wVote;
    } else {
      blended = danielsRaw;
      groundedWeight = 0;
    }
    riegelOut = null;
    lowConfidenceShort = danielsRaw < 210;
  } else {
    let wLocal: number;
    if (local.bracketed) {
      wLocal = 0.85;
    } else {
      // ratio === 1 means targetM IS (essentially) a known real result — there's no
      // extrapolation at all, so trust it almost completely rather than capping at the
      // same 0.85 used for a genuine two-point interpolation.
      const ratio = Math.max(targetM, local.anchor.distanceM) / Math.min(targetM, local.anchor.distanceM);
      wLocal = Math.max(0.15, Math.min(0.95, 0.95 - (ratio - 1) * 0.3));
    }
    // Daniels' %VO2max-vs-duration table flatlines below ~3.5min (percentVO2maxFromDuration) —
    // it's an approximation never calibrated for sprint-duration efforts, so for short
    // predicted durations the global curve is the unreliable half of the blend regardless
    // of how well-bracketed the local model is.
    lowConfidenceShort = local.timeSec < 210 || danielsRaw < 210;
    if (lowConfidenceShort) wLocal = Math.max(wLocal, 0.9);

    const peakShare = 1 - wLocal;
    // The vote gets more room when local is only a one-sided extrapolation (no real bracket) —
    // that's exactly where an independent physiological cross-check is most valuable; less room
    // when a real two-point bracket already pins the estimate down directly from this runner's
    // own data.
    const wVote = physVote ? peakShare * physVote.confidence * (local.bracketed ? 0.3 : 0.6) : 0;
    const wPeak = peakShare - wVote;

    blended = Math.round(wLocal * local.timeSec + wVote * (physVote?.timeSec ?? 0) + wPeak * danielsRaw);
    riegelOut = local.timeSec;
    groundedWeight = wLocal + wVote;
  }

  // Hard ceiling (§5.1): this athlete's own measured threshold pace bounds how fast HM/Marathon
  // can plausibly be, regardless of what the blend above produced — verified necessary against
  // real data (a 38:41 10K runner's blended marathon estimate implied 99.5% of their own LT2
  // pace sustained for 42.195km, which is unrealistic at any caliber).
  const ceilingTimeSec = thresholdCeilingTimeSec(targetM, pickThresholdSource(lt2, cs), longestRunLast8wM);
  if (ceilingTimeSec !== null && blended < ceilingTimeSec) blended = Math.round(ceilingTimeSec);

  const uncertaintyMultiplier = 1 + (1 - groundedWeight) * 1.5;
  let range = predictionRange(blended, targetM, uncertaintyMultiplier);

  // Marathon-distance literature spread (see criticalSpeedVote doc comment above) — widen
  // only, never narrow, and never touch the point estimate itself.
  if (cs && cs.csMetersPerSec > 0 && targetM > CS_VOTE_MAX_DIST_FRACTION) {
    const csFast = Math.round(targetM / (cs.csMetersPerSec * MARATHON_CS_FRACTION_ELITE));
    const csSlow = Math.round(targetM / (cs.csMetersPerSec * MARATHON_CS_FRACTION_AVG));
    range = { lo: Math.min(range.lo, csFast), hi: Math.max(range.hi, csSlow) };
  }

  // Long-run-history adequacy (see longRunAdequacyWidenFactor doc comment) — HM/marathon only.
  if (targetM >= 21097) {
    const extra = longRunAdequacyWidenFactor(longestRunLast8wM, targetM);
    if (extra > 1) {
      range = {
        lo: Math.round(blended - (blended - range.lo) * extra),
        hi: Math.round(blended + (range.hi - blended) * extra),
      };
    }
  }
  // The ceiling is a hard physiological floor on time — never let range-widening pull rangeLo
  // back below it either.
  if (ceilingTimeSec !== null) range = { ...range, lo: Math.max(range.lo, Math.round(ceilingTimeSec)) };

  const models: Record<string, number> = { "Daniels (population)": danielsRaw };
  if (riegelOut !== null) models["Riegel (your PBs)"] = riegelOut;
  if (physVote) models["Critical Speed / Threshold"] = Math.round(physVote.timeSec);

  return { peak: blended, riegel: riegelOut, rangeLo: range.lo, rangeHi: range.hi, lowConfidenceShort, models };
}

/**
 * Computes one predictionsJson row per RACE_DISTANCES entry — the single shared
 * implementation used by both FitnessCache update paths (cache.ts) and the stats page's
 * cache-miss fallback, so they can never drift apart (see Bug 11/14/15 in
 * IMPLEMENTATION_PLAN.md for what happens when the same computation is hand-duplicated).
 * Also returns the Critical Speed/W' fit so the AUTO cache path can persist it for display
 * and confidence-gating elsewhere — it's computed once here, not duplicated per caller.
 */
export function computeRacePredictions(
  vdot: number,
  tsb: number,
  racePBs: Array<{ distanceM: number; timeSec: number }>,
  bestEfforts: Array<{ distance: number; elapsed_time: number }>,
  longestRunLast8wM?: number,
  lt2?: { paceSecPerKm: number; rSquared: number } | null,
  lowerTierCandidates?: KnownPerformance[],
): {
  predictions: Array<{ label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number; lowConfidenceShort: boolean; models: Record<string, number> }>;
  criticalSpeed: CriticalSpeedResult | null;
} {
  const personalK = personalizedFatigueExponent(bestEfforts);
  const fallbackExponent = personalK !== null ? (1 - personalK) : 1.06;
  const knownPerformances = buildKnownPerformances(racePBs, bestEfforts, lowerTierCandidates);
  const criticalSpeed = estimateCriticalSpeed(bestEfforts, racePBs);

  const predictions = RACE_DISTANCES.map(({ label, meters }) => {
    const { peak, riegel, rangeLo, rangeHi, lowConfidenceShort, models } =
      blendedRacePrediction(meters, vdot, knownPerformances, fallbackExponent, criticalSpeed, longestRunLast8wM, lt2);
    return { label, meters, peak, today: tsbAdjustedRaceTime(peak, tsb), riegel, rangeLo, rangeHi, lowConfidenceShort, models };
  });

  return { predictions, criticalSpeed };
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function looksLikeRace(name: string): boolean {
  return /tävl|race|lopp|mila|stafett|sic\b|parkrun|time.?trial|tt\b|halvmara|half.?marathon/i
    .test(name);
}

export function looksLikeIntervals(name: string): boolean {
  return /intervall|interval|fartlek|tisdagsbana|bana\b|x\s*\d|\d+\s*[×x]\s*\d+|rep(etition)?|varvlopp/i
    .test(name ?? "");
}

function nearDistance(distM: number, targetM: number) {
  return Math.abs(distM - targetM) / targetM < 0.08;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

interface SplitKm {
  distance: number;
  moving_time: number;
  average_speed: number;
}

function bestNkmSpeed(splits: SplitKm[], n: number): number | null {
  const valid = splits.filter(s => s.average_speed > 2 && s.distance > 500);
  if (valid.length < n) return null;
  let best = 0;
  for (let i = 0; i <= valid.length - n; i++) {
    const seg = valid.slice(i, i + n);
    const totalDist = seg.reduce((s, x) => s + x.distance, 0);
    const totalTime = seg.reduce((s, x) => s + x.moving_time, 0);
    if (totalTime > 0) best = Math.max(best, totalDist / totalTime);
  }
  return best > 0 ? best : null;
}

/** Exponential recency weight: 1.0 at 0 days, 0.5 at 90 days, 0.25 at 180 days */
function recencyWeight(startDate: Date | undefined): number {
  if (!startDate) return 0.5;
  const daysAgo = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysAgo / 130); // ~130 day half-life → old PRs stay relevant for a year
}

/**
 * Is this run a QUALITY session?
 * Quality = race, keyword race, OR pace is significantly above easy threshold.
 * Easy runs are excluded from VDOT estimation to prevent dragging it down.
 */
function isQualitySession(a: ActivitySample, easyPaceThreshold: number): boolean {
  if (a.isRace || looksLikeRace(a.name ?? "")) return true;
  const avgPaceSecPerKm = a.distanceM > 0 && a.timeSec > 0
    ? a.timeSec / (a.distanceM / 1000) : null;
  // Quality if faster than easy pace - 60 sec/km (allows a wide margin)
  return avgPaceSecPerKm != null && avgPaceSecPerKm < (easyPaceThreshold - 60);
}

/** Fitness decay model (Mujika & Padilla, 2000; Coyle, 1984).
 *  With regular easy running: ~5% loss per 12 weeks.
 *  With complete cessation: ~20% loss per 12 weeks.
 */
function applyFitnessDecay(
  vdot: number,
  daysSinceLastQuality: number,
  hasRecentEasyRuns: boolean,
): number {
  if (daysSinceLastQuality < 14) return vdot; // recent quality = no decay
  const weeks = (daysSinceLastQuality - 14) / 7;
  // Weekly decay rate: 0.4% with easy maintenance, 1.5% without
  const weeklyDecay = hasRecentEasyRuns ? 0.004 : 0.015;
  const decayed = vdot * Math.pow(1 - weeklyDecay, weeks);
  return Math.max(decayed, vdot * 0.70); // floor at 70% of best (realistic minimum)
}

// ── Main estimation function ──────────────────────────────────────────────

interface ActivitySample {
  distanceM: number;
  timeSec: number;
  avgHR: number | null;
  maxHR?: number | null;
  isRace: boolean;
  sportType: string;
  name?: string;
  bestEfforts?: unknown;
  splitsMetric?: unknown;
  startDate?: Date;
  totalElevationGain?: number | null;
}

export interface RacePB {
  distanceM: number;
  timeSec: number;
  date: Date;
}

/**
 * TSB-adjusted VDOT (Banister impulse-response model, simplified).
 * Formula: VDOT_adjusted = VDOT_PB × (1 + 0.003 × TSB)
 * TSB +15 → +4.5% performance boost (peak form)
 * TSB −30 → −9% (deep fatigue)
 * Based on industry practice (TrainingPeaks/WKO form model).
 * Clamped to ±15% of base VDOT to prevent extreme corrections.
 */
export function tsbAdjustedVdot(baseVdot: number, tsb: number): number {
  const factor = 1 + 0.003 * tsb;
  const clamped = Math.max(0.85, Math.min(1.15, factor));
  return Math.round(baseVdot * clamped * 10) / 10;
}

/**
 * HR-at-pace form signal: compare recent 30-day avg HR at easy pace
 * vs 90-day baseline. A +8-12bpm drift at same pace implies ~8-12% fitness loss.
 * Returns a fitness-change fraction (negative = decline, positive = improvement).
 * Returns null if insufficient data.
 */
export function hrFormSignal(
  runs: Array<{ avgHR: number; avgPaceSecPerKm: number; startDate: Date }>,
  maxHR: number,
): number | null {
  const now = Date.now();
  const easy = runs.filter(r =>
    r.avgHR > maxHR * 0.60 && r.avgHR < maxHR * 0.80 &&
    r.avgPaceSecPerKm > 240 && r.avgPaceSecPerKm < 480  // 4-8 min/km
  );
  if (easy.length < 10) return null;

  // Pick pace band with most data: round to nearest 15 sec/km bucket
  const buckets = new Map<number, { hrSum: number; count: number; recent: number; recentCount: number }>();
  for (const r of easy) {
    const bucket = Math.round(r.avgPaceSecPerKm / 15) * 15;
    if (!buckets.has(bucket)) buckets.set(bucket, { hrSum: 0, count: 0, recent: 0, recentCount: 0 });
    const b = buckets.get(bucket)!;
    b.hrSum += r.avgHR; b.count++;
    const daysAgo = (now - r.startDate.getTime()) / 86400000;
    if (daysAgo < 30) { b.recent += r.avgHR; b.recentCount++; }
  }

  // Find best bucket (most data)
  let bestBucket: { hrSum: number; count: number; recent: number; recentCount: number } | null = null;
  let bestCount = 0;
  for (const b of buckets.values()) {
    if (b.count > bestCount && b.recentCount >= 2) { bestBucket = b; bestCount = b.count; }
  }
  if (!bestBucket || bestBucket.recentCount < 2) return null;

  const baselineHR = bestBucket.hrSum / bestBucket.count;
  const recentHR   = bestBucket.recent / bestBucket.recentCount;
  const hrDrift    = recentHR - baselineHR; // positive = higher HR = worse fitness

  // Convert HR drift to VDOT fraction: every 10 bpm = ~10% change
  return -hrDrift / maxHR; // negative fraction = decline
}

export function estimateVO2max(
  activities: ActivitySample[],
  maxHR: number,
  restHR: number,
  racePBs?: RacePB[],
  avgWeeklyRunKm?: number,
): VO2maxEstimate {
  const isRunning = (a: ActivitySample) => /run|trail/i.test(a.sportType);
  const runs = activities.filter(isRunning);

  // Estimate "easy pace" as 75th percentile pace of ALL runs (easy runs cluster here)
  const allPaces = runs
    .filter(a => a.distanceM >= 3000 && a.timeSec > 0)
    .map(a => a.timeSec / (a.distanceM / 1000));
  const easyPaceThreshold = allPaces.length > 5 ? percentile(allPaces, 0.75) : 360;

  // ── MODEL 1: Pace-based VDOT from quality sessions only ──────────────────
  interface VdotCandidate { v: number; weight: number; source: string }
  const candidates: VdotCandidate[] = [];

  for (const a of runs) {
    const w = recencyWeight(a.startDate);

    // From splits: rolling segment bests
    if (a.splitsMetric && Array.isArray(a.splitsMetric)) {
      const splits = (a.splitsMetric as SplitKm[]).filter(s => s.moving_time > 0);
      for (const [n, label, factor] of [[5, "5km-seg", 1.0], [3, "3km-seg", 1.02], [10, "10km-seg", 1.0]] as const) {
        const speed = bestNkmSpeed(splits, n);
        if (!speed) continue;
        const timeSec = (n * 1000) / speed * (factor as number);
        const v = vdotFromRace(n * 1000, timeSec);
        if (v > 35 && v < 90) candidates.push({ v, weight: w, source: label });
      }
    }

    // From bestEfforts JSON
    if (a.bestEfforts && Array.isArray(a.bestEfforts)) {
      for (const e of a.bestEfforts as Array<{ distance: number; elapsed_time: number }>) {
        if (e.distance >= 1500 && e.elapsed_time > 0) {
          const v = vdotFromRace(e.distance, e.elapsed_time);
          if (v > 35 && v < 90) candidates.push({ v, weight: w * 1.05, source: "bestEffort" });
        }
      }
    }

    // From whole-activity pace (only if quality session or race)
    if (!isQualitySession(a, easyPaceThreshold)) continue;
    if (a.distanceM < 800 || a.timeSec <= 0) continue;

    const isRaceSession = a.isRace || looksLikeRace(a.name ?? "");
    const BUCKETS = [
      { m: 800,   tol: 0.10 },
      { m: 1500,  tol: 0.10 },
      { m: 1609,  tol: 0.08 },
      { m: 3000,  tol: 0.12 },
      { m: 5000,  tol: 0.12 },
      { m: 8000,  tol: 0.12 },
      { m: 10000, tol: 0.10 },
      { m: 15000, tol: 0.10 },
      { m: 21097, tol: 0.08 },
      { m: 42195, tol: 0.06 },
    ];
    for (const b of BUCKETS) {
      if (!nearDistance(a.distanceM, b.m)) continue;
      // For non-race sessions, apply a small conservative factor (2%) since training
      // is not fully maximal. Division inflates time → slightly lower VDOT.
      const factor = isRaceSession ? 1 : (b.m < 8000 ? 0.98 : 0.99);
      const v = vdotFromRace(b.m, a.timeSec / factor);
      if (v > 35 && v < 90) candidates.push({ v, weight: w * (isRaceSession ? 1.1 : 0.85), source: isRaceSession ? "race" : "quality-run" });
    }
  }

  // Race PBs from stored records — higher weight + slower recency decay than training runs
  // A verified 5K PB from 1 year ago is still strong evidence of fitness level.
  if (racePBs) {
    for (const pb of racePBs) {
      if (pb.distanceM >= 800 && pb.timeSec > 0) {
        // 365-day half-life (vs 130 days for training runs) — PBs stay relevant longer
        const daysAgo = (Date.now() - pb.date.getTime()) / (1000 * 60 * 60 * 24);
        const w = Math.exp(-daysAgo / 365) * 4.0; // 4× multiplier (vs 2× for training)
        const v = vdotFromRace(pb.distanceM, pb.timeSec);
        if (v > 35 && v < 90) candidates.push({ v, weight: w, source: "race-pb" });
      }
    }
  }

  // Best VDOT: race PBs dominate; activity candidates are top-3 average for stability
  let model1Vdot: number | null = null;
  const racePBCandidates = candidates.filter(c => c.source === "race-pb");
  const activityCandidates = candidates.filter(c => c.source !== "race-pb");

  if (racePBCandidates.length > 0) {
    const best = racePBCandidates.reduce((a, b) =>
      (a.v + Math.log(a.weight + 0.01) * 3) > (b.v + Math.log(b.weight + 0.01) * 3) ? a : b
    );
    model1Vdot = best.v;
  } else if (activityCandidates.length > 0) {
    const sorted = [...activityCandidates].sort((a, b) =>
      (b.v + Math.log(b.weight + 0.01) * 3) - (a.v + Math.log(a.weight + 0.01) * 3)
    );
    const top3 = sorted.slice(0, 3);
    const totalW = top3.reduce((s, c) => s + c.weight, 0);
    model1Vdot = top3.reduce((s, c) => s + c.v * c.weight, 0) / totalW;
  }

  // ── MODEL 2: Uth-Sørensen (2003) — plausibility check only ──────────────
  const model2 = restHR > 0 && maxHR > 0 ? vo2maxUth(maxHR, restHR) : null;

  // ── MODEL 3: Cooper (1968) — plausibility check only ─────────────────────
  const model3 = restHR > 0 && maxHR > 0 ? vo2maxCooper(maxHR, restHR) : null;

  // ── TEMPO-RUN VDOT candidates (Model 1 supplement) ───────────────────────
  // Runs at 83-90% maxHR that aren't intervals can yield threshold-based VDOT.
  // Weighted 0.6× (less reliable than a true race, better than easy run).
  for (const a of runs) {
    if (!a.avgHR || !a.distanceM || !a.timeSec) continue;
    if (looksLikeIntervals(a.name ?? "") || looksLikeRace(a.name ?? "")) continue;
    const rawPace = a.timeSec / (a.distanceM / 1000);
    const gap = gradeAdjustedPace(rawPace, a.totalElevationGain ?? 0, a.distanceM);
    const v = vdotFromTempoRun(gap, a.avgHR, maxHR);
    if (v !== null) {
      const w = recencyWeight(a.startDate) * 0.6;
      candidates.push({ v, weight: w, source: "tempo-run" });
    }
  }

  // ── MODEL 4: Volume-adjusted Riegel (Alex Gascón model) ─────────────────
  // Exponent d = clamp(1.18 − 0.0015 × avgWeeklyKm, 1.05, 1.18).
  // Higher volume → smaller exponent → better endurance → more accurate marathon prediction.
  let model4Vdot: number | null = null;
  if (racePBs && racePBs.length > 0 && avgWeeklyRunKm && avgWeeklyRunKm > 0) {
    const varExponent = Math.max(1.05, Math.min(1.18, 1.18 - 0.0015 * avgWeeklyRunKm));
    // Best PB by VDOT value (same anchor the display column uses)
    const anchor = racePBs.reduce((best, pb) =>
      vdotFromRace(pb.distanceM, pb.timeSec) > vdotFromRace(best.distanceM, best.timeSec) ? pb : best
    );
    const pred10K = anchor.timeSec * Math.pow(10000 / anchor.distanceM, varExponent);
    const v = vdotFromRace(10000, pred10K);
    if (v > 35 && v < 90) model4Vdot = v;
  }

  // ── MODEL 5: Fitness decay bridge ────────────────────────────────────────
  let model5Vdot: number | null = null;
  if (model1Vdot) {
    const lastQualityDate = candidates.length > 0
      ? runs.filter(a => isQualitySession(a, easyPaceThreshold) && a.startDate)
          .sort((a, b) => (b.startDate!.getTime()) - (a.startDate!.getTime()))
          .at(0)?.startDate
      : undefined;
    const daysSinceQuality = lastQualityDate
      ? (Date.now() - lastQualityDate.getTime()) / (1000 * 60 * 60 * 24) : 999;
    const hasRecentEasy = runs.some(a =>
      a.startDate && (Date.now() - a.startDate.getTime()) / (1000 * 60 * 60 * 24) < 30
    );
    model5Vdot = applyFitnessDecay(model1Vdot, daysSinceQuality, hasRecentEasy);
  }

  // ── MODEL 6: Critical Speed from race PBs ────────────────────────────────
  let model6Vdot: number | null = null;
  if (racePBs && racePBs.length >= 2) {
    const cs = criticalSpeedFromPBs(racePBs);
    if (cs && cs.vdot > 35 && cs.vdot < 90) model6Vdot = cs.vdot;
  }

  // ── MODEL 8: HR-form signal from easy runs ────────────────────────────────
  // If HR at easy pace has drifted vs 90-day baseline, adjust VDOT accordingly.
  let model8Vdot: number | null = null;
  if (model1Vdot) {
    const hrRuns = runs
      .filter(a => a.avgHR && a.distanceM > 0 && a.timeSec > 0 && !looksLikeIntervals(a.name ?? ""))
      .map(a => ({
        avgHR: a.avgHR!,
        avgPaceSecPerKm: gradeAdjustedPace(a.timeSec / (a.distanceM / 1000), a.totalElevationGain ?? 0, a.distanceM),
        startDate: a.startDate ?? new Date(),
      }));
    const signal = hrFormSignal(hrRuns, maxHR);
    if (signal !== null) {
      // Limit adjustment to ±8% of model1Vdot
      const adjustment = Math.max(-0.08, Math.min(0.08, signal));
      model8Vdot = model1Vdot * (1 + adjustment);
    }
  }

  // ── WEIGHTED MEAN — race PBs contribute but do not dominate ─────────────
  // TSB no longer contributes a model here (§5.6 — it was being applied twice: once via this
  // blend, again via tsbAdjustedRaceTime() for the race-prediction "Today" column). The base
  // VDOT/"peak" blend is now TSB-neutral; tsbAdjustedRaceTime() is the only place TSB shifts
  // a number, exactly the "Today" column it already names.
  const hasRacePBs = racePBCandidates.length > 0 || model6Vdot !== null;
  const hrFormWeight = model8Vdot !== null ? 0.20 : 0.00;
  const hasCurrent   = hrFormWeight > 0;

  // Age-decay VDOT weight: fresh PB (≤90d) → full; stale (540+d) → 35% floor.
  // Prevents an 18-month-old PB from dominating current-fitness signals.
  let pbAgeFactor = 1.0;
  if (racePBs && racePBs.length > 0) {
    const newestPB = racePBs.reduce((latest, pb) => pb.date > latest ? pb.date : latest, racePBs[0].date);
    const pbDaysAgo = (Date.now() - newestPB.getTime()) / 86400000;
    pbAgeFactor = pbDaysAgo <= 90  ? 1.0
                : pbDaysAgo >= 540 ? 0.35
                : 1.0 - (pbDaysAgo - 90) / 450 * 0.65;
  }
  const vdotBase   = hasRacePBs ? (hasCurrent ? 0.28 : 0.45) : 0.00;
  const vdotWeight = vdotBase * pbAgeFactor;
  const csWeight   = model6Vdot !== null ? (hasCurrent ? 0.05 : 0.08) : 0.00;
  const varWeight  = model4Vdot !== null ? (hasCurrent ? 0.12 : 0.18) : 0.00;
  type ModelEntry = [number | null, number, string];
  const models: ModelEntry[] = [
    [model1Vdot,  vdotWeight,               "VDOT (race PBs)"],
    [model8Vdot,  hrFormWeight,             "HR-form signal"],
    [model4Vdot,  varWeight,                "Volume-Adjusted Riegel"],
    [model6Vdot,  csWeight,                 "Critical Speed"],
    [model2,      hasRacePBs ? 0.05 : 0.12, "Uth-Sørensen"],
    [model5Vdot,  hasRacePBs ? 0.01 : 0.05, "Decay bridge"],
  ];

  const available = models.filter(([v]) => v !== null && v > 35 && v < 90);
  if (available.length === 0) {
    return { value: 45, vdot: 45, confidence: "low", method: "default estimate" };
  }

  const totalWeight = available.reduce((s, [, w]) => s + w, 0);
  const weightedSum = available.reduce((s, [v, w]) => s + v! * w, 0);
  const mean = weightedSum / totalWeight;

  const clamped = Math.min(Math.max(mean, 25), 90);
  const breakdown = Object.fromEntries(available.map(([v, , name]) => [name, Math.round(v! * 10) / 10]));

  const primaryMethod = available[0][2];
  const methodStr = `${primaryMethod} + ${available.length - 1} models (weighted mean)`;

  return {
    value: Math.round(clamped * 10) / 10,
    vdot:  Math.round(clamped * 10) / 10,
    confidence: model1Vdot ? (candidates.length >= 3 ? "high" : "medium") : "low",
    method: methodStr,
    breakdown,
  };
}
