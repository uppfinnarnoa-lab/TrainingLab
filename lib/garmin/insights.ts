// Derived Garmin wellness insights — HRV overreaching detection and the composite
// readiness score from docs/architecture/overview.md (HRV 40% + TSB 30% + sleep 20% +
// resting HR trend 10%). All inputs are read-only aggregates over GarminDailySummary;
// nothing is persisted here.

export interface GarminDailyLite {
  date: Date;
  hrvNightly: number | null;
  restingHR: number | null;
}

export interface HrvBaseline {
  rolling7dAvg: number | null;
  baseline60dAvg: number | null;
  cv14d: number | null;            // informational — coefficient of variation, last 14 nights
  baselineDropPct: number | null;  // negative = below personal baseline
  flag: "overreaching_risk" | null;
}

function avg(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

function daysAgo(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / 86400_000;
}

// HRV is only meaningful relative to a personal baseline (absolute RMSSD varies hugely
// between individuals) — see docs/planning/archive (overreaching research): a sustained
// ≥20% drop in the 7-day rolling average below a 60-day baseline is the cited
// overreaching/illness precursor signal. The two windows are kept non-overlapping (7d vs.
// 8-60d ago) so the "current" reading can't drag down its own reference baseline.
export function computeHrvBaseline(daily: GarminDailyLite[], now: Date): HrvBaseline {
  const last7 = daily.filter(d => d.hrvNightly != null && daysAgo(d.date, now) <= 7).map(d => d.hrvNightly!);
  const baselinePool = daily.filter(d => d.hrvNightly != null && daysAgo(d.date, now) > 7 && daysAgo(d.date, now) <= 60).map(d => d.hrvNightly!);
  const last14 = daily.filter(d => d.hrvNightly != null && daysAgo(d.date, now) <= 14).map(d => d.hrvNightly!);

  const rolling7dAvg = last7.length >= 3 ? avg(last7) : null;
  const baseline60dAvg = baselinePool.length >= 14 ? avg(baselinePool) : null;

  let cv14d: number | null = null;
  if (last14.length >= 7) {
    const m = avg(last14)!;
    const sd = Math.sqrt(last14.reduce((s, v) => s + (v - m) ** 2, 0) / last14.length);
    cv14d = m > 0 ? Math.round((sd / m) * 1000) / 10 : null; // %
  }

  const baselineDropPct = rolling7dAvg != null && baseline60dAvg != null && baseline60dAvg > 0
    ? Math.round(((rolling7dAvg / baseline60dAvg) - 1) * 1000) / 10
    : null;

  return {
    rolling7dAvg: rolling7dAvg != null ? Math.round(rolling7dAvg * 10) / 10 : null,
    baseline60dAvg: baseline60dAvg != null ? Math.round(baseline60dAvg * 10) / 10 : null,
    cv14d,
    baselineDropPct,
    flag: baselineDropPct != null && baselineDropPct <= -20 ? "overreaching_risk" : null,
  };
}

export interface ReadinessComponents {
  hrv: number | null;
  tsb: number | null;
  sleep: number | null;
  restHR: number | null;
}
export interface ReadinessResult {
  score: number | null;
  components: ReadinessComponents;
}

const WEIGHTS: Record<keyof ReadinessComponents, number> = { hrv: 0.40, tsb: 0.30, sleep: 0.20, restHR: 0.10 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// restHRDeltaBpm: most recent resting HR minus its own 30-day trailing average — an
// elevated resting HR relative to one's own baseline is the same kind of "relative, not
// absolute" recovery signal as HRV.
//
// garminTrainingReadiness: Garmin's own 0-100 score, when available. Blended in at 40% —
// it draws on sensor inputs we don't have (HRV status algorithm internals, stress, recent
// sleep architecture) — same blend weight previously used by the dashboard's own ad-hoc
// formula, kept here so there is exactly one readiness computation in the app.
export function computeReadinessScore(input: {
  hrvRolling7dAvg: number | null;
  hrvBaseline60dAvg: number | null;
  tsb: number | null;
  sleepScore: number | null;
  restHRDeltaBpm: number | null;
}, garminTrainingReadiness?: number | null): ReadinessResult {
  const hrvRatio = input.hrvRolling7dAvg != null && input.hrvBaseline60dAvg != null && input.hrvBaseline60dAvg > 0
    ? input.hrvRolling7dAvg / input.hrvBaseline60dAvg
    : null;

  const components: ReadinessComponents = {
    // ratio 1.0 (at baseline) → 50; +20% above baseline → 100; -20% below → 0
    hrv: hrvRatio != null ? Math.round(clamp(50 + (hrvRatio - 1) * 250, 0, 100)) : null,
    // TSB 0 (balanced) → 50; +25 (fresh) → 100; -25 (deep fatigue) → 0
    tsb: input.tsb != null ? Math.round(clamp(50 + input.tsb * 2, 0, 100)) : null,
    sleep: input.sleepScore,
    // at baseline → 50; 10bpm below baseline (fresh) → 100; 10bpm above (fatigued) → 0
    restHR: input.restHRDeltaBpm != null ? Math.round(clamp(50 - input.restHRDeltaBpm * 5, 0, 100)) : null,
  };

  const available = (Object.keys(components) as (keyof ReadinessComponents)[])
    .filter(k => components[k] != null);
  if (available.length === 0 && garminTrainingReadiness == null) return { score: null, components };

  const ownScore = available.length > 0
    ? available.reduce((s, k) => s + WEIGHTS[k] * components[k]!, 0) / available.reduce((s, k) => s + WEIGHTS[k], 0)
    : null;

  const score = ownScore != null && garminTrainingReadiness != null
    ? ownScore * 0.6 + garminTrainingReadiness * 0.4
    : ownScore ?? garminTrainingReadiness!;

  return { score: Math.round(clamp(score, 0, 100)), components };
}

export function readinessLabel(score: number): { color: string; label: string } {
  if (score >= 70) return { color: "#6EE7B7", label: "Ready" };
  if (score >= 45) return { color: "#FBBF24", label: "Moderate" };
  return { color: "#F87171", label: "Recover" };
}

export function computeRestingHRBaseline(daily: GarminDailyLite[], now: Date): { latest: number | null; baseline30dAvg: number | null; deltaBpm: number | null } {
  const sorted = [...daily].filter(d => d.restingHR != null).sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = sorted.at(-1)?.restingHR ?? null;
  const pool = sorted.filter(d => daysAgo(d.date, now) <= 30).map(d => d.restingHR!);
  const baseline30dAvg = pool.length >= 10 ? avg(pool) : null;
  const deltaBpm = latest != null && baseline30dAvg != null ? Math.round((latest - baseline30dAvg) * 10) / 10 : null;
  return {
    latest,
    baseline30dAvg: baseline30dAvg != null ? Math.round(baseline30dAvg * 10) / 10 : null,
    deltaBpm,
  };
}
