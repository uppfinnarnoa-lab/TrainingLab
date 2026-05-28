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
  regression?: { slope: number; intercept: number } | null,
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

  // Convert pace → HR via regression; returns null when regression is unavailable or out of range
  function paceToHR(paceSecPerKm: number): number | null {
    if (!regression) return null;
    const vMin = (1000 / paceSecPerKm) * 60;
    const vo2AtPace = -4.60 + 0.182258 * vMin + 0.000104 * vMin * vMin;
    const hr = (vo2AtPace - regression.intercept) / regression.slope;
    return hr > maxHR * 0.65 && hr < maxHR * 0.99 ? Math.round(hr) : null;
  }

  const lt2HRFromRegression = paceToHR(lt2PaceSecPerKm);
  const lt1HRFromRegression = paceToHR(lt1PaceSecPerKm);

  // Never mix sources: if either regression HR is unavailable, use percentages for BOTH.
  // Mixed sources (one from regression, one from fixed %) can invert lt1/lt2.
  const bothValid = lt1HRFromRegression !== null && lt2HRFromRegression !== null;
  const lt1HR = bothValid ? lt1HRFromRegression! : Math.round(maxHR * 0.82);
  const lt2HR = bothValid ? lt2HRFromRegression! : Math.round(maxHR * 0.88);

  // Final sanity: regression could theoretically invert values with unusual data
  if (lt1HR >= lt2HR) {
    return {
      lt1HR: Math.round(maxHR * 0.78), lt2HR: Math.round(maxHR * 0.88),
      lt1PaceSecPerKm: Math.round(lt1PaceSecPerKm), lt2PaceSecPerKm: Math.round(lt2PaceSecPerKm),
      source: "race-pbs",
    };
  }

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
}

interface BucketPoint { pace: number; medianHR: number; count: number }

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
): StatisticalZoneResult | null {
  // ── 1. Filter and compute GAP ──────────────────────────────────────────
  const MIN_DIST = 800;          // allows 1km lap splits from activities
  const MIN_DURATION_SEC = 180;  // 3 min — laps are pre-warmed from the surrounding run

  // Prefer 90-day recency half-life to track current fitness; fall back to 180 days when
  // fewer than 40 runs exist in the last 90 days (injury/off-season gaps).
  const recentCount = runs.filter(r => {
    if (!r.startDate) return false;
    return (Date.now() - r.startDate.getTime()) / 86_400_000 < 90;
  }).length;
  const halfLife = recentCount >= 40 ? 90 : 180;

  const points = runs
    .filter(r =>
      // Reject near-max HR (sensor artifacts or all-out efforts — not steady state)
      r.avgHR > maxHR * 0.52 && r.avgHR < maxHR * 0.96 &&
      r.distanceM >= MIN_DIST && r.movingTimeSec >= MIN_DURATION_SEC &&
      // Reject extreme terrain where GAP correction is unreliable (>12% avg grade)
      r.totalElevationGain / r.distanceM < 0.12
    )
    .map(r => {
      const rawPace = r.movingTimeSec / (r.distanceM / 1000);
      const gap = gradeAdjustedPace(rawPace, r.totalElevationGain, r.distanceM);
      const temp = r.weatherTemp ?? 15;
      // Reject very hot runs entirely — heat drastically inflates HR beyond useful range
      if (temp > 30) return null;
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate
        ? (Date.now() - r.startDate.getTime()) / 86_400_000
        : halfLife;
      const recency = Math.exp(-daysAgo / halfLife);
      // Aerobic zone (62–85% maxHR) has clearest LT signal; down-weight extremes
      const hrFrac = r.avgHR / maxHR;
      const zoneProximity = hrFrac >= 0.62 && hrFrac <= 0.85 ? 1.5 : 0.75;
      // Race activities are max-effort steady-state at known pace — most informative for LT2
      const raceBoost = r.isRace ? 3.0 : 1.0;
      return { gap, hr: r.avgHR, weight: tempWeight * recency * zoneProximity * raceBoost };
    })
    .filter((p): p is { gap: number; hr: number; weight: number } =>
      p !== null && p.gap > 200 && p.gap < 391 // 3:20–6:31/km (OL paces excluded upstream)
    );

  if (points.length < 40) return null;

  const binWidth = 15; // fixed 15 s/km bins: ~13 buckets in 200–391 range, better LT resolution than adaptive FD

  // ── 3. Build buckets with weighted median HR ────────────────────────────
  const bucketMap = new Map<number, Array<{ hr: number; w: number }>>();
  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  const MIN_COUNT = 15;
  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => pts.length >= MIN_COUNT)
    .map(([pace, pts]) => {
      const sorted = pts.sort((a, b) => a.hr - b.hr);
      const totalW = sorted.reduce((s, p) => s + p.w, 0);
      // 80th-percentile HR per bucket: tracks the near-ceiling effort at each pace,
      // not the average — median is pulled down by easy/tired days at that pace
      let cum = 0, pct80HR = sorted[0].hr;
      for (const p of sorted) { cum += p.w; if (cum >= totalW * 0.80) { pct80HR = p.hr; break; } }
      return { pace, medianHR: pct80HR, count: pts.length };
    })
    .sort((a, b) => a.pace - b.pace);

  // Enforce non-increasing HR with increasing pace via pool-adjacent-violators.
  // Noise inversions between adjacent buckets corrupt R² and misplace breakpoints.
  const mono = poolAdjacentViolators(buckets);
  if (mono.length < 6) return null;

  // ── 4. Exhaustive piecewise linear search for two breakpoints ──────────
  const nb = mono.length;
  const paceArr = mono.map(b => b.pace);
  const hrArr   = mono.map(b => b.medianHR);
  // Reciprocal-density weights: sparse buckets (threshold pace) get equal influence
  // to the dense easy-run buckets, preventing regression bias toward the easy end
  const bucketWeights = mono.map(b => 1 / Math.sqrt(b.count));

  // LT2 (bp1): 2-segment LS search — large slope change makes LS reliable here
  let lt2Err = Infinity, bp1 = 2;
  for (let i = 1; i < nb - 2; i++) {
    const err = segErr(paceArr, hrArr, 0, i, bucketWeights) +
                segErr(paceArr, hrArr, i, nb - 1, bucketWeights);
    if (err < lt2Err) { lt2Err = err; bp1 = i; }
  }

  // LT1 (bp2): D-max on the easy-zone sub-curve [bp1..nb-1].
  // LS is biased for subtle slope changes (Baek 2018); D-max is geometry-based and unbiased.
  let bp2 = Math.min(bp1 + 2, nb - 2);
  const dMaxIdx = dMaxLT1(paceArr, hrArr, bp1, nb);
  if (dMaxIdx !== null) bp2 = dMaxIdx;

  // R² uses the optimal 3-segment LS fit as a data-quality metric (independent of LT1 method).
  // D-max gives a physiologically better LT1 but higher LS error — computing R² from the
  // D-max fit would artificially lower it and cause false rejections.
  let bestLSErr = Infinity;
  for (let j = bp1 + 1; j < nb - 1; j++) {
    const err = segErr(paceArr, hrArr, 0, bp1, bucketWeights) +
                segErr(paceArr, hrArr, bp1, j, bucketWeights) +
                segErr(paceArr, hrArr, j, nb - 1, bucketWeights);
    if (err < bestLSErr) bestLSErr = err;
  }

  // Weighted R² — consistent with the weighted fit
  const totalBW = bucketWeights.reduce((s, w) => s + w, 0);
  const meanHR = hrArr.reduce((s, v, i) => s + v * bucketWeights[i], 0) / totalBW;
  const totalVar = hrArr.reduce((s, v, i) => s + bucketWeights[i] * (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestLSErr / totalVar) * 100) / 100);

  if (rSquared < 0.62) return null;

  // paceArr is sorted ascending (fast→slow); bp1 < bp2 so bp1 = fast = LT2, bp2 = slow = LT1
  const lt2PaceSecPerKm = paceArr[bp1];
  const lt1PaceSecPerKm = paceArr[bp2];
  const lt2HR = Math.round(hrArr[bp1]);
  const lt1HR = Math.round(hrArr[bp2]);

  // Sanity: LT1 < LT2 < maxHR with meaningful separation, and in realistic HR ranges
  if (lt1HR >= lt2HR - 8) return null; // minimum 8 bpm gap between thresholds
  if (lt2HR >= maxHR * 0.98) return null;
  if (lt1HR < maxHR * 0.60 || lt2HR < maxHR * 0.70) return null; // thresholds too low — bad data
  // Breakpoints must be in physiologically plausible pace ranges
  if (lt1PaceSecPerKm < 240 || lt1PaceSecPerKm > 380) return null; // LT1 at 4:00–6:20/km
  if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) return null; // LT2 at 3:20–7:00/km
  if (lt2PaceSecPerKm >= lt1PaceSecPerKm) return null; // LT2 must be faster than LT1

  // ── 5. Build non-uniform zones ─────────────────────────────────────────
  const z2width = Math.max(4, Math.round((lt2HR - lt1HR) * 0.12));
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
  if (!ensureValidZones(zones)) return null;

  return { lt1HR, lt2HR, lt1PaceSecPerKm, lt2PaceSecPerKm, rSquared, bucketCount: buckets.length, zones };
}

/**
 * D-max method for LT1: finds the index in pace[lt2Idx..n-1] with maximum positive
 * deviation above the chord from (pace[lt2Idx], hr[lt2Idx]) to (pace[n-1], hr[n-1]).
 *
 * Physiological basis: the threshold zone (LT2→LT1) has a shallower HR:pace slope than
 * the easy zone (LT1→slowest). The chord lies between these two slopes, so the threshold
 * zone sits above the chord and the easy zone below. LT1 = the point of maximum deviation
 * above the chord (the transition from above-chord to below-chord).
 *
 * Superior to LS for LT1 because LS is biased toward the data-dense easy zone for subtle
 * slope changes (Baek 2018, arxiv:1811.03720).
 */
function dMaxLT1(pace: number[], hr: number[], lt2Idx: number, n: number): number | null {
  if (n - lt2Idx < 3) return null;
  const ax = pace[lt2Idx], ay = hr[lt2Idx]; // LT2 anchor
  const bx = pace[n - 1],  by = hr[n - 1];  // slowest anchor
  const pRange = bx - ax;
  const hRange = ay - by;
  if (pRange <= 0 || hRange <= 0) return null;

  let maxDev = 0, maxIdx = -1;
  for (let i = lt2Idx + 1; i < n - 1; i++) {
    const px = (pace[i] - ax) / pRange;
    const py = (hr[i]   - by) / hRange;
    // Deviation above the diagonal chord (0,1)→(1,0) in normalised space
    const dev = py - (1 - px);
    if (dev > maxDev) { maxDev = dev; maxIdx = i; }
  }

  // Require ≥ 3% normalised deviation — if curve is nearly linear there is no LT1 signal
  return maxDev >= 0.03 && maxIdx !== -1 ? maxIdx : null;
}

function poolAdjacentViolators(buckets: BucketPoint[]): BucketPoint[] {
  const out = buckets.map(b => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].medianHR < out[i + 1].medianHR) {
        const tc = out[i].count + out[i + 1].count;
        out.splice(i, 2, {
          pace:     (out[i].pace     * out[i].count + out[i + 1].pace     * out[i + 1].count) / tc,
          medianHR: (out[i].medianHR * out[i].count + out[i + 1].medianHR * out[i + 1].count) / tc,
          count:    tc,
        });
        changed = true;
        break;
      }
    }
  }
  return out;
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
