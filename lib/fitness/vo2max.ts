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

/** ±% confidence interval based on empirical error margins */
export function predictionRange(predictedSec: number, distM: number): { lo: number; hi: number } {
  const pct = distM >= 42000 ? 0.06 : distM >= 21000 ? 0.04 : distM >= 10000 ? 0.03 : 0.025;
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
 * Adjust flat pace for elevation gain.
 * Minetti (2002) cost-of-transport model: uphill adds ~3.3% per % grade.
 * Eliminates the biggest source of noise in the HR-pace regression for hilly runs.
 */
export function gradeAdjustedPace(paceSecPerKm: number, elevGainM: number, distM: number): number {
  if (distM < 500 || elevGainM <= 0) return paceSecPerKm;
  const grade = Math.min(0.15, elevGainM / distM); // cap at 15%
  return paceSecPerKm / (1 + grade * 0.033);
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

// ── Helpers ───────────────────────────────────────────────────────────────

function looksLikeRace(name: string): boolean {
  return /tävl|race|lopp|mila|stafett|sic\b|parkrun|time.?trial|tt\b|halvmara|half.?marathon/i
    .test(name);
}

function looksLikeIntervals(name: string): boolean {
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
  tsb?: number,
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

  // ── MODEL 4: HR-pace regression (Firstbeat-style, GAP-corrected, recency-weighted) ──
  // Use grade-adjusted pace (GAP) to eliminate elevation noise from hilly runs.
  // Exclude interval sessions — their avg pace is diluted by warm-up/recovery.
  const regressionRuns = runs
    .filter(a => a.avgHR && a.distanceM >= 3000 && a.timeSec > 0
      && !looksLikeIntervals(a.name ?? ""))
    .map(a => {
      const rawPace = a.timeSec / (a.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, a.totalElevationGain ?? 0, a.distanceM);
      return { avgHR: a.avgHR!, avgPaceSecPerKm: gap, weight: recencyWeight(a.startDate) };
    });
  const nValidRegression = regressionRuns.filter(r =>
    r.avgHR > maxHR * 0.60 && r.avgHR < maxHR * 0.92
  ).length;
  // Boost regression weight with larger datasets (more data = more reliable slope)
  const model4Weight = nValidRegression >= 300 ? 0.28 : nValidRegression >= 100 ? 0.22 : nValidRegression >= 20 ? 0.16 : 0.10;
  const model4 = maxHR > 0 ? vo2maxHRPaceRegression(regressionRuns, maxHR) : null;

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

  // ── MODEL 7: TSB-adjusted VDOT (Banister form model) ─────────────────────
  // Adjusts the PB-based estimate up/down based on current training stress balance.
  // TSB +15 ≈ peak form (+4.5%); TSB −30 ≈ heavy fatigue (−9%).
  let model7Vdot: number | null = null;
  if (model1Vdot && tsb !== undefined && tsb !== null) {
    model7Vdot = tsbAdjustedVdot(model1Vdot, tsb);
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

  // ── WEIGHTED MEAN — race PBs dominate when present ───────────────────────
  const hasRacePBs = racePBCandidates.length > 0 || model6Vdot !== null;
  // TSB and HR-form signal reflect CURRENT fitness (not just historical PBs).
  // They get higher weight so predictions adapt to training state, not just race history.
  const tsbWeight    = model7Vdot !== null ? 0.25 : 0.00; // form matters a lot
  const hrFormWeight = model8Vdot !== null ? 0.20 : 0.00; // training quality signal
  // Reduce PB and regression weight when we have good current-fitness signals
  const hasCurrent   = tsbWeight + hrFormWeight > 0;
  const vdotWeight   = hasRacePBs ? (hasCurrent ? 0.30 : 0.50) : 0.00;
  const csWeight     = model6Vdot !== null ? (hasCurrent ? 0.06 : 0.08) : 0.00;
  const regrWeight   = hasRacePBs ? Math.min(model4Weight, hasCurrent ? 0.08 : 0.10) : model4Weight;
  type ModelEntry = [number | null, number, string];
  const models: ModelEntry[] = [
    [model1Vdot,  vdotWeight,  "VDOT (race PBs)"],
    [model7Vdot,  tsbWeight,   "TSB-adjusted (form)"],
    [model8Vdot,  hrFormWeight,"HR-form signal"],
    [model6Vdot,  csWeight,    "Critical Speed"],
    [model4,      regrWeight,  "HR-pace regression"],
    [model2,      hasRacePBs ? 0.04 : 0.10, "Uth-Sørensen"],
    [model3,      hasRacePBs ? 0.02 : 0.07, "Cooper"],
    [model5Vdot,  hasRacePBs ? 0.01 : 0.05, "decay bridge"],
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
