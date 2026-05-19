// ATL / CTL / TSB computation using exponential weighted moving average.
// ATL (Acute Training Load): 7-day time constant (fitness fatigue)
// CTL (Chronic Training Load): 42-day time constant (fitness base)
// TSB (Training Stress Balance): CTL - ATL (form)

export interface DailyLoad {
  date: string;  // YYYY-MM-DD
  tss: number;
  atl: number;
  ctl: number;
  tsb: number;
}

const ATL_TC = 7;  // days
const CTL_TC = 42; // days
const ATL_K = 1 - Math.exp(-1 / ATL_TC);
const CTL_K = 1 - Math.exp(-1 / CTL_TC);

// Compute TRIMP-based TSS for an activity using HR data.
// Returns a TSS value (dimensionless, 100 ≈ 1 hour all-out).
export function computeTSS(params: {
  movingTimeSec: number;
  avgHR: number | null;
  maxHR: number;       // athlete's max HR
  restHR: number;      // athlete's resting HR
  thresholdHR?: number; // lactate threshold HR (≈ 88% max HR)
}): number {
  const { movingTimeSec, avgHR, maxHR, restHR } = params;
  const thresholdHR = params.thresholdHR ?? maxHR * 0.88;

  if (!avgHR || avgHR <= 0 || movingTimeSec <= 0) {
    // Fallback: estimate TSS from duration alone (moderate effort assumed)
    return (movingTimeSec / 3600) * 50;
  }

  // TRIMP-exponential (Banister): TRIMP = duration × HRratio × exp(b × HRratio)
  // b = 1.92 for men, 1.67 for women (using 1.92 as default)
  const hrRatio = (avgHR - restHR) / (maxHR - restHR);
  const clampedRatio = Math.max(0, Math.min(1, hrRatio));
  const trimp = (movingTimeSec / 60) * clampedRatio * Math.exp(1.92 * clampedRatio);

  // Normalize to TSS scale: 100 TSS = 1h at threshold HR
  const thresholdRatio = (thresholdHR - restHR) / (maxHR - restHR);
  const thresholdTRIMP = 60 * thresholdRatio * Math.exp(1.92 * thresholdRatio);
  const tss = (trimp / thresholdTRIMP) * 100;

  return Math.round(tss * 10) / 10;
}

// Build day-by-day ATL/CTL/TSB from a list of daily TSS values.
// Input: map from YYYY-MM-DD → tss
// Output: array of DailyLoad sorted by date.
export function buildLoadCurve(
  dailyTSS: Map<string, number>,
  startDate: Date,
  endDate: Date,
): DailyLoad[] {
  const result: DailyLoad[] = [];
  let atl = 0;
  let ctl = 0;

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = cursor.toISOString().split("T")[0];
    const tss = dailyTSS.get(key) ?? 0;

    atl = atl + ATL_K * (tss - atl);
    ctl = ctl + CTL_K * (tss - ctl);
    const tsb = ctl - atl;

    result.push({
      date: key,
      tss,
      atl: Math.round(atl * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

// Get the current TSB (most recent day's value).
export function currentTSB(curve: DailyLoad[]): number {
  return curve.length > 0 ? curve[curve.length - 1].tsb : 0;
}

export function currentCTL(curve: DailyLoad[]): number {
  return curve.length > 0 ? curve[curve.length - 1].ctl : 0;
}

// Classify TSB into a form state label.
export function tsbLabel(tsb: number): { label: string; color: string } {
  if (tsb > 25)  return { label: "Very fresh",   color: "#38BDF8" };
  if (tsb > 5)   return { label: "Fresh",         color: "#6EE7B7" };
  if (tsb > -10) return { label: "Neutral",        color: "#94A3B8" };
  if (tsb > -30) return { label: "Tired",          color: "#FBBF24" };
  return           { label: "Very tired",           color: "#F87171" };
}
