// VO2max estimation via three methods, weighted by confidence.

export interface VO2maxEstimate {
  value: number;       // ml/kg/min
  vdot: number;        // Daniels VDOT (≈VO2max for running)
  confidence: "high" | "medium" | "low";
  method: string;
}

// ─── Method 1: Race-based VDOT (most accurate) ────────────────────────────

// Daniels VDOT from a race performance.
// distance in meters, time in seconds.
export function vdotFromRace(distanceM: number, timeSec: number): number {
  const v = distanceM / timeSec * 60; // m/min
  const pctVO2max = percentVO2maxFromDuration(timeSec / 60);
  const vo2atPace = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return vo2atPace / pctVO2max;
}

// Approximate %VO2max sustainable for a given race duration (minutes).
// Based on Daniels' tables.
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

// ─── Method 2: HR-ratio (Astrand-Ryhming) ────────────────────────────────

export function vo2maxFromHRRatio(maxHR: number, restHR: number): number {
  // Simple formula: VO2max ≈ 15 × (HRmax / HRrest)
  return 15 * (maxHR / restHR);
}

// ─── Method 3: Submaximal run (Uth et al.) ───────────────────────────────
// Uses pace + HR from aerobic runs. Estimates VO2 at observed pace/HR, extrapolates.

export function vo2maxFromSubmaxEffort(
  avgPaceSecPerKm: number, // pace at the effort
  avgHR: number,
  maxHR: number,
): number {
  // VO2 at that pace (ml/kg/min using Daniels approximation)
  const v = 1000 / avgPaceSecPerKm * 60; // m/min
  const vo2AtPace = -4.60 + 0.182258 * v + 0.000104 * v * v;
  // Scale to 100% HR max
  const hrFraction = avgHR / maxHR;
  return vo2AtPace / hrFraction;
}

// ─── Combined estimate ────────────────────────────────────────────────────

// Race-like keyword detection — catches fast efforts not marked workout_type=1
function looksLikeRace(name: string): boolean {
  return /tävl|race|lopp|mila|stafett|sic\b|sprint.*ol|parkrun|time.?trial|tt\b|timed|5k|10k|half.?marathon|halvmara/i
    .test(name);
}

interface ActivitySample {
  distanceM: number;
  timeSec: number;
  avgHR: number | null;
  isRace: boolean;
  sportType: string;
  name?: string;
  bestEfforts?: unknown; // JSON from Strava
}

export function estimateVO2max(
  activities: ActivitySample[],
  maxHR: number,
  restHR: number,
): VO2maxEstimate {
  const estimates: number[] = [];
  let bestMethod = "HR ratio";

  // Method 1: Best VDOT from race-like efforts
  // Includes: isRace=true AND name-keyword races AND best efforts from Strava
  const isRunning = (a: ActivitySample) =>
    a.sportType.toLowerCase().includes("run") || a.sportType.toLowerCase().includes("trail");

  // 1a. Marked races + keyword races (treated as maximal efforts)
  const raceEfforts = activities.filter(a =>
    isRunning(a) && a.distanceM >= 1500 &&
    (a.isRace || looksLikeRace(a.name ?? ""))
  );

  // 1b. Strava bestEfforts JSON — per-distance PRs across ALL activities
  const bestEffortVdots: number[] = [];
  for (const a of activities) {
    if (!a.bestEfforts || !isRunning(a)) continue;
    try {
      const efforts = a.bestEfforts as Array<{ distance: number; elapsed_time: number }>;
      for (const e of efforts) {
        if (e.distance >= 1500 && e.elapsed_time > 0) {
          const v = vdotFromRace(e.distance, e.elapsed_time);
          if (v > 35 && v < 90) bestEffortVdots.push(v);
        }
      }
    } catch { /* malformed JSON */ }
  }

  // 1c. Hard intervals / track sessions — use activity avg pace if HR was high
  //     Catches Tisdagsbana, OLGY, 5x4, 4x10 etc. even without race flag.
  //     If avg HR > 88% maxHR during a run ≥ 3 km, treat avg pace as a near-maximal
  //     effort and compute VDOT. This is conservative — actual race pace > avg pace.
  const hardRunVdots: number[] = [];
  if (maxHR > 0) {
    for (const a of activities) {
      if (!isRunning(a)) continue;
      if (!a.avgHR || a.avgHR < maxHR * 0.88) continue;
      if (a.distanceM < 3000 || a.timeSec < 600) continue;
      // At ≥ 88% maxHR over ≥ 3 km, this is at/near threshold intensity.
      // The full activity distance at avg pace underestimates true race pace
      // for an equivalent effort, so we use 95% of avg pace as proxy.
      const adjustedTimeSec = a.timeSec * 0.95;
      const v = vdotFromRace(a.distanceM, adjustedTimeSec);
      if (v > 35 && v < 90) hardRunVdots.push(v);
    }
  }

  // 1d. Top-20 fastest runs by avg pace (any distance 3–25 km, no HR filter).
  //     Catches fast training sessions that are neither races nor have HR data.
  //     Applied conservatively: avg pace < true race pace, factor applied by distance.
  const recentRunVdots: number[] = [];
  const fastRuns = [...activities]
    .filter(a => isRunning(a) && a.distanceM >= 3000 && a.distanceM <= 25000 && a.timeSec > 0)
    .sort((a, b) => (a.timeSec / a.distanceM) - (b.timeSec / b.distanceM))
    .slice(0, 20);

  for (const a of fastRuns) {
    // Conservative factor: interval avg pace is ~97% of equivalent race pace,
    // for longer efforts it's ~99%.
    const factor = a.distanceM < 8000 ? 0.96 : 0.99;
    const v = vdotFromRace(a.distanceM, a.timeSec / factor);
    if (v > 35 && v < 90) recentRunVdots.push(v);
  }

  const raceVdots = raceEfforts.map(r => vdotFromRace(r.distanceM, r.timeSec))
    .filter(v => v > 35 && v < 90);
  const allVdots = [...raceVdots, ...bestEffortVdots, ...hardRunVdots, ...recentRunVdots];

  if (allVdots.length > 0) {
    const best = Math.max(...allVdots);
    estimates.push(best);
    bestMethod = raceVdots.includes(best)       ? "race performance (VDOT)" :
                 bestEffortVdots.includes(best)  ? "best effort data (VDOT)" :
                 hardRunVdots.includes(best)     ? "hard effort / high-HR run (VDOT)" :
                                                   "fastest training run (VDOT)";
  }

  // Method 2: HR ratio
  if (maxHR > 0 && restHR > 0) {
    estimates.push(vo2maxFromHRRatio(maxHR, restHR));
  }

  // Method 3: submaximal runs (easy runs with HR data, distance 5-15km)
  const submaxRuns = activities
    .filter(a =>
      a.sportType.toLowerCase().includes("run") &&
      a.avgHR && a.avgHR > 0 &&
      a.distanceM >= 4000 &&
      a.distanceM <= 20000
    )
    .slice(0, 10);
  if (submaxRuns.length > 0 && maxHR > 0) {
    const subEstimates = submaxRuns
      .filter(r => r.avgHR)
      .map(r => vo2maxFromSubmaxEffort(r.timeSec / (r.distanceM / 1000), r.avgHR!, maxHR));
    const filtered = subEstimates.filter(v => v > 30 && v < 90);
    if (filtered.length > 0) {
      estimates.push(filtered.reduce((a, b) => a + b, 0) / filtered.length);
    }
  }

  if (estimates.length === 0) {
    return { value: 45, vdot: 45, confidence: "low", method: "default estimate" };
  }

  // Weighted average (race-based gets higher weight)
  const value = estimates.length > 1
    ? estimates[0] * 0.6 + estimates.slice(1).reduce((a, b) => a + b, 0) / estimates.slice(1).length * 0.4
    : estimates[0];

  const clamped = Math.min(Math.max(value, 25), 90);

  return {
    value: Math.round(clamped * 10) / 10,
    vdot: Math.round(clamped * 10) / 10,
    confidence: allVdots.length > 0 ? "high" : estimates.length >= 2 ? "medium" : "low",
    method: bestMethod,
  };
}

// Predict race time from VDOT for a given distance.
// vdotFromRace is a DECREASING function of time (faster = higher VDOT),
// so when the estimate is too high we need MORE time (move lo up), and
// when too low we need LESS time (move hi down).
export function predictRaceTime(vdot: number, distanceM: number): number {
  let lo = distanceM / 15; // fastest plausible (e.g. 4 min/km for 5K)
  let hi = distanceM * 3;  // slowest plausible
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const estimated = vdotFromRace(distanceM, mid);
    if (estimated > vdot) {
      lo = mid; // estimated VDOT too high → need more time → raise lo
    } else {
      hi = mid; // estimated VDOT too low → need less time → lower hi
    }
  }
  return Math.round((lo + hi) / 2);
}

// TSB-adjusted race time: account for current fatigue.
export function tsbAdjustedRaceTime(baseTimeSec: number, tsb: number): number {
  // TSB 0 = neutral, positive = fresh, negative = fatigued
  // Rough: each -10 TSB points = ~0.5% slower
  const adjustment = Math.max(Math.min(-tsb * 0.0005, 0.08), -0.04);
  return Math.round(baseTimeSec * (1 + adjustment));
}
