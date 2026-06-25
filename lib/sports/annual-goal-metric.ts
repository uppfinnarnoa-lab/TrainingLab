export type AnnualGoalMetric = "distance" | "time";

// target is km for "distance", minutes for "time" — minutes to stay consistent with the
// separate Goal model's Activity.movingTime-based tracking (see goals-manager.tsx).
export interface AnnualGoal { metric: AnnualGoalMetric; target: number }

/** Strength/Yoga/etc. aren't meaningfully tracked by distance — default them to a time goal. */
export function annualGoalMetricForSport(sportName: string): AnnualGoalMetric {
  const s = sportName.toLowerCase();
  if (/run|trail|virtual|cycl|ride|bike|ski|swim|sim|walk|hike|row/.test(s)) return "distance";
  return "time";
}

/**
 * `AthleteProfile.annualGoals` predates per-sport metric — every stored value used to be a
 * bare number (always km). Normalizes either that legacy shape or the current
 * `{metric, target}` shape into one consistent type, so callers never need to know which
 * shape is actually on disk for a given user/sport.
 */
export function normalizeAnnualGoal(raw: unknown): AnnualGoal | null {
  if (typeof raw === "number") return { metric: "distance", target: raw };
  if (raw && typeof raw === "object" && typeof (raw as AnnualGoal).target === "number") {
    const r = raw as AnnualGoal;
    return { metric: r.metric === "time" ? "time" : "distance", target: r.target };
  }
  return null;
}

export function normalizeAnnualGoalsYear(yearGoals: Record<string, unknown> | undefined | null): Record<string, AnnualGoal> {
  const out: Record<string, AnnualGoal> = {};
  for (const [sport, raw] of Object.entries(yearGoals ?? {})) {
    const g = normalizeAnnualGoal(raw);
    if (g) out[sport] = g;
  }
  return out;
}
