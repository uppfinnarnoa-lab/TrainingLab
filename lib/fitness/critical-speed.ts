export interface CriticalSpeedResult {
  csMetersPerSec: number;
  wPrimeMeters: number;
  rSquared: number;
  effortsUsed: number;
}

/**
 * Estimate Critical Speed from a combined pool of:
 *  - Activity best-effort segments (from Strava JSON)
 *  - Race PBs from RaceRecord table (more reliable for longer distances)
 *
 * Linear regression: time/distance = CS_inv + W'/distance
 * CS = 1/intercept (m/s), W' = slope (meters of anaerobic capacity)
 */
export function estimateCriticalSpeed(
  bestEfforts: Array<{ distance: number; elapsed_time: number }>,
  racePBs?: Array<{ distanceM: number; timeSec: number }>,
): CriticalSpeedResult | null {
  // Merge both sources; race PBs take priority for the same distance.
  // Upper bound is 15 000 m (≈15K): distances above that are run below CS pace
  // (HM, marathon) and would pull the linear fit toward an underestimate.
  const CS_MAX_DIST = 15_000;
  const merged = new Map<number, number>(); // distance → best time

  for (const e of bestEfforts) {
    if (e.distance >= 200 && e.distance <= CS_MAX_DIST && e.elapsed_time > 0) {
      const d = Math.round(e.distance);
      if (!merged.has(d) || merged.get(d)! > e.elapsed_time) merged.set(d, e.elapsed_time);
    }
  }

  if (racePBs) {
    for (const r of racePBs) {
      if (r.distanceM >= 200 && r.distanceM <= CS_MAX_DIST && r.timeSec > 0) {
        const d = Math.round(r.distanceM);
        // Race PBs override activity best-efforts for the same distance
        if (!merged.has(d) || merged.get(d)! > r.timeSec) merged.set(d, r.timeSec);
      }
    }
  }

  const usable = [...merged.entries()].map(([distance, elapsed_time]) => ({ distance, elapsed_time }));
  // 2 points are enough for a linear regression (5K + 10K is a common and valid pair)
  if (usable.length < 2) return null;

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

  const slope     = (n * sumXY - sumX * sumY) / denom;  // W' in meters
  const intercept = (sumY - slope * sumX) / n;           // 1/CS in s/m

  if (intercept <= 0) return null;

  const csMs   = 1 / intercept;
  const wPrime = slope;

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
