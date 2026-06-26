export interface CriticalSpeedResult {
  csMetersPerSec: number;
  wPrimeMeters: number;
  rSquared: number;
  effortsUsed: number;
}

/**
 * Estimate Critical Speed from a combined pool of:
 *  - Activity best-effort segments (from Strava JSON)
 *  - Race PBs from RaceRecord table
 *
 * `racePBs` beyond 10K must already be filtered by the caller to manually-entered entries
 * only (see lib/fitness/vo2max.ts::buildKnownPerformances doc comment for why — an
 * auto-detected RaceRecord beyond 10K isn't trustworthy road-race pace, and since it
 * overrides bestEfforts for the same distance below, an untrusted point here would
 * silently win over a possibly-better bestEffort).
 *
 * Linear regression: time/distance = CS_inv + W'/distance
 * CS = 1/intercept (m/s), W' = slope (meters of anaerobic capacity)
 */
export function estimateCriticalSpeed(
  bestEfforts: Array<{ distance: number; elapsed_time: number }>,
  racePBs?: Array<{ distanceM: number; timeSec: number }>,
): CriticalSpeedResult | null {
  // `bestEfforts` beyond 10K are never trusted as genuine maximal efforts — same cap already
  // proven necessary for buildKnownPerformances()/personalizedFatigueExponent() in vo2max.ts.
  // Verified concretely (RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md §3.2): when this cap
  // used to be 15 000m, the only "fastest available" bestEffort segments in the 10-15K range
  // turned out to be deliberately submaximal "LT!" threshold sessions, not maximal efforts,
  // pulling this regression toward a slower, less reliable line (R²=0.582 vs. the independent
  // statistical-zone LT2 estimate's R²=0.99 for the same athlete). `racePBs` stay trusted up
  // to 15K (and beyond, via the empirical HM/marathon fallback below) since they're already
  // gated to isManual-only beyond 10K by the caller (see loadRacePBs()/buildTrustedRacePBs()).
  const BESTEFFORT_MAX_DIST = 10_000;
  const RACEPB_MAX_DIST = 15_000;
  const merged = new Map<number, number>(); // distance → best time

  for (const e of bestEfforts) {
    if (e.distance >= 200 && e.distance <= BESTEFFORT_MAX_DIST && e.elapsed_time > 0) {
      const d = Math.round(e.distance);
      if (!merged.has(d) || merged.get(d)! > e.elapsed_time) merged.set(d, e.elapsed_time);
    }
  }

  if (racePBs) {
    for (const r of racePBs) {
      if (r.distanceM >= 200 && r.distanceM <= RACEPB_MAX_DIST && r.timeSec > 0) {
        const d = Math.round(r.distanceM);
        // Race PBs override activity best-efforts for the same distance
        if (!merged.has(d) || merged.get(d)! > r.timeSec) merged.set(d, r.timeSec);
      }
    }
  }

  const usable = [...merged.entries()].map(([distance, elapsed_time]) => ({ distance, elapsed_time }));
  // 2 points are enough for a linear regression (5K + 10K is a common and valid pair)
  if (usable.length < 2) {
    // Empirical fallback: derive CS from HM or marathon PB (both > 15 000 m so excluded above)
    // Literature: HM pace ≈ CS × 0.97; Marathon pace ≈ CS × 0.93
    if (!racePBs) return null;
    const hm  = racePBs.find(r => Math.abs(r.distanceM - 21097) < 200);
    const mar = racePBs.find(r => Math.abs(r.distanceM - 42195) < 500);
    // Prefer HM (closer to CS intensity); fall back to marathon
    const pb  = hm ?? mar;
    if (!pb || pb.timeSec <= 0) return null;
    const factor = hm ? 0.97 : 0.93;
    const paceMs = pb.distanceM / pb.timeSec; // m/s
    return {
      csMetersPerSec: paceMs / factor,
      wPrimeMeters:   200,  // unknown — placeholder
      rSquared:       0,    // signals empirical estimate, not regression
      effortsUsed:    1,
    };
  }

  // Linear regression: time/distance = CS_inv + W'/distance
  // i.e. y = a + b*x  where  y = time/distance, x = 1/distance
  const n = usable.length;
  const xs = usable.map(e => 1 / e.distance);
  const ys = usable.map(e => e.elapsed_time / e.distance);

  const sumX  = xs.reduce((a, x) => a + x, 0);
  const sumY  = ys.reduce((a, y) => a + y, 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;  // -W'/CS (always negative for valid data)
  const intercept = (sumY - slope * sumX) / n;           // 1/CS in s/m

  if (intercept <= 0) return null;

  const csMs   = 1 / intercept;
  // W' = -slope × CS  (slope is negative in the t/d ~ 1/d model)
  const wPrime = -slope * csMs;

  // R²
  const yMean = sumY / n;
  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const rSq   = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  if (csMs <= 0 || wPrime <= 0) return null;

  return {
    csMetersPerSec: csMs,
    wPrimeMeters:   wPrime,
    rSquared:       rSq,
    effortsUsed:    n,
  };
}
