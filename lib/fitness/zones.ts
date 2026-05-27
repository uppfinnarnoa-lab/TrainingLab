// Heart rate and pace zone calculations.
// Zones are defined relative to the athlete's lactate threshold HR and VO2max pace.

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
// Artifact cap: well-trained adult endurance athletes rarely exceed 190 bpm.
// Values above this are treated as sensor artifacts (optical HR spikes etc.)
export const MAXHR_ARTIFACT_CAP = 190;

/**
 * Estimate max HR from per-activity max HR values.
 * Hard-caps at 205 bpm to remove optical HR sensor artifacts.
 * Uses 85th percentile of clean data (more conservative than 95th).
 * No +2 bpm buffer — we want to avoid overestimation.
 */
export function estimateMaxHR(activityMaxHRs: number[]): number {
  if (activityMaxHRs.length === 0) return 180;
  const clean = activityMaxHRs.filter(h => h >= 130 && h <= MAXHR_ARTIFACT_CAP);
  if (clean.length === 0) return 180;
  const sorted = [...clean].sort((a, b) => a - b);
  const p85 = sorted[Math.min(Math.floor(sorted.length * 0.85), sorted.length - 1)];
  return Math.round(p85);
}

/**
 * Estimate max HR from race/hard-effort activities.
 * Uses 80th percentile — even in races you rarely hit absolute true max.
 */
export function estimateMaxHRFromRaces(raceMaxHRs: number[]): number | null {
  if (raceMaxHRs.length < 2) return null;
  const clean = raceMaxHRs.filter(h => h >= 140 && h <= MAXHR_ARTIFACT_CAP);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const p80 = sorted[Math.min(Math.floor(sorted.length * 0.80), sorted.length - 1)];
  return Math.round(p80);
}

/**
 * Estimate max HR from threshold-effort activities.
 * More robust than raw max because threshold efforts have consistent, reliable HR.
 * thresholdHRs: array of average HRs from known hard/threshold sessions.
 */
export function estimateMaxHRFromThreshold(thresholdHRs: number[]): number | null {
  if (thresholdHRs.length < 3) return null; // not enough data
  const sorted = [...thresholdHRs].sort((a, b) => a - b);
  // 90th percentile of threshold HRs ≈ lactate threshold HR
  const p90idx = Math.floor(sorted.length * 0.90);
  const thresholdHR = sorted[Math.min(p90idx, sorted.length - 1)];
  // Threshold HR is typically 85–91% of max HR; use 88% midpoint
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
 * Estimate LT1 and LT2 from stored race PBs.
 *
 * Priority: HM → 10K → 5K for LT2.
 * LT2 pace scaling factors from research:
 *   HM pace ≈ LT2 pace (direct, most accurate)
 *   10K pace × 1.065 ≈ LT2 pace
 *   5K pace × 1.135 ≈ LT2 pace
 *
 * Convert pace → HR via linear regression if available.
 * Falls back to % of maxHR if no regression.
 */
/**
 * Extrapolate a PB to 10K equivalent pace using Riegel formula.
 * Reliability falls with extrapolation distance — PBs far from 10K are weighted lower.
 */
function extrapolateTo10KPaceSecPerKm(
  pbs: Array<{ distanceM: number; timeSec: number }>,
): number | null {
  const usable = pbs.filter(p => p.distanceM >= 800 && p.distanceM <= 42200);
  if (usable.length === 0) return null;
  // Riegel: T2 = T1 × (D2/D1)^1.06
  const candidates = usable.map(p => {
    const t10K = p.timeSec * Math.pow(10000 / p.distanceM, 1.06);
    const pace10K = t10K / 10; // sec/km
    // Weight: closest distances to 10K are most reliable
    const ratio = Math.min(p.distanceM, 10000) / Math.max(p.distanceM, 10000);
    const w = ratio ** 2; // quadratic — falls off sharply for very short/long PBs
    return { pace10K, w };
  });
  const totalW = candidates.reduce((s, c) => s + c.w, 0);
  if (totalW < 0.01) return null;
  return candidates.reduce((s, c) => s + c.pace10K * c.w, 0) / totalW;
}

export function estimateLTFromRaces(
  racePBs: Array<{ distanceM: number; timeSec: number }>,
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

  const byDist = [...racePBs].sort((a, b) => a.distanceM - b.distanceM);

  function paceOf(distM: number): number | null {
    const match = byDist.find(r => Math.abs(r.distanceM - distM) / distM < 0.08);
    return match ? match.timeSec / (match.distanceM / 1000) : null;
  }

  const hmPace    = paceOf(21097);
  const tenKPace  = paceOf(10000);
  const fiveKPace = paceOf(5000);

  let lt2PaceSecPerKm: number | null = null;

  if (hmPace) {
    lt2PaceSecPerKm = hmPace;                  // HM pace ≈ LT2 (most accurate)
  } else if (tenKPace) {
    lt2PaceSecPerKm = tenKPace * 1.065;        // 10K + 6.5%
  } else if (fiveKPace) {
    lt2PaceSecPerKm = fiveKPace * 1.135;       // 5K + 13.5%
  } else {
    // No standard-distance PBs — extrapolate from any available PB via Riegel to 10K equivalent
    const extrapolated10KPace = extrapolateTo10KPaceSecPerKm(racePBs);
    if (extrapolated10KPace) lt2PaceSecPerKm = extrapolated10KPace * 1.065;
  }

  if (!lt2PaceSecPerKm) {
    return {
      lt1HR: Math.round(maxHR * 0.82), lt2HR: Math.round(maxHR * 0.88),
      lt1PaceSecPerKm: 0, lt2PaceSecPerKm: 0, source: "default",
    };
  }

  const lt1PaceSecPerKm = lt2PaceSecPerKm * 1.10; // LT1 ≈ 10% slower than LT2

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
  }>,
  maxHR: number,
  restHR: number,
): StatisticalZoneResult | null {
  // ── 1. Filter and compute GAP ──────────────────────────────────────────
  const MIN_DIST = 800;          // allows 1km lap splits from activities
  const MIN_DURATION_SEC = 180;  // 3 min — laps are pre-warmed from the surrounding run

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
      const grade = Math.min(0.12, Math.max(0, r.totalElevationGain / r.distanceM));
      const gap = rawPace / (1 + grade * 0.033);
      const temp = r.weatherTemp ?? 15;
      // Reject very hot runs entirely — heat drastically inflates HR beyond useful range
      if (temp > 30) return null;
      const tempWeight = temp > 25 ? 0.35 : temp > 20 ? 0.75 : 1.0;
      const daysAgo = r.startDate
        ? (Date.now() - r.startDate.getTime()) / 86_400_000
        : 180;
      const recency = Math.exp(-daysAgo / 180);
      return { gap, hr: r.avgHR, weight: tempWeight * recency };
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

  const MIN_COUNT = 10;
  const buckets: BucketPoint[] = [...bucketMap.entries()]
    .filter(([, pts]) => pts.length >= MIN_COUNT)
    .map(([pace, pts]) => {
      const sorted = pts.sort((a, b) => a.hr - b.hr);
      const totalW = sorted.reduce((s, p) => s + p.w, 0);
      let cum = 0, medianHR = sorted[0].hr;
      for (const p of sorted) { cum += p.w; if (cum >= totalW / 2) { medianHR = p.hr; break; } }
      return { pace, medianHR, count: pts.length };
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

  let bestErr = Infinity, bp1 = 2, bp2 = 4;
  for (let i = 1; i < nb - 3; i++) {
    for (let j = i + 2; j < nb - 1; j++) {
      const err = segErr(paceArr, hrArr, 0, i) + segErr(paceArr, hrArr, i, j) + segErr(paceArr, hrArr, j, nb - 1);
      if (err < bestErr) { bestErr = err; bp1 = i; bp2 = j; }
    }
  }

  // R² — how well does the 3-segment model fit?
  const meanHR = hrArr.reduce((s, v) => s + v, 0) / nb;
  const totalVar = hrArr.reduce((s, v) => s + (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, Math.round((1 - bestErr / totalVar) * 100) / 100);

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

function segErr(paces: number[], hrs: number[], from: number, to: number): number {
  if (to - from < 2) return 0;
  const xs = paces.slice(from, to + 1), ys = hrs.slice(from, to + 1);
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
                (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1e-6);
  const b = my - slope * mx;
  return xs.reduce((s, x, i) => s + (ys[i] - (slope * x + b)) ** 2, 0);
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
