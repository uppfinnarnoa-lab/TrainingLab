/**
 * Activity → Planned workout intent-based matching.
 *
 * Matches actual Strava activities to planned sessions by workout intention
 * (style, type, purpose) — NOT exact distance/time/intervals.
 *
 * Classification categories: easy | aerobic | threshold | vo2max | long | race | strength | other
 *
 * Reference: Seiler polarisation model, Coggan zones, Banister TRIMP.
 */

export type WorkoutIntent =
  | "easy"
  | "aerobic"
  | "threshold"
  | "vo2max"
  | "long"
  | "race"
  | "strength"
  | "other";

interface PlannedWorkoutForMatch {
  id: string;
  name: string;
  sportType: string;
  date: string;          // ISO date string
  targetDuration?: number | null;  // seconds
  targetDistance?: number | null;  // meters
  notes?: string | null;
  template?: {
    estimatedZoneDistribution?: Record<string, number> | null;
  } | null;
}

interface ActivityForMatch {
  id: string;
  name: string;
  sportType: string;
  startDateLocal: Date;
  distance: number;       // meters
  movingTime: number;     // seconds
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  sufferScore?: number | null;
  isRace: boolean;
  trainingLoad?: number | null;
}

export interface MatchResult {
  activityId: string;
  plannedId: string;
  confidence: number;   // 0–100
  activityIntent: WorkoutIntent;
  plannedIntent: WorkoutIntent;
}

// ── Intent classification ─────────────────────────────────────────────────────

export function classifyPlannedIntent(pw: PlannedWorkoutForMatch): WorkoutIntent {
  const sport = pw.sportType.toLowerCase();
  if (/weight|gym|strength|styrka|kraft/i.test(sport)) return "strength";

  const text = `${pw.name} ${pw.notes ?? ""}`.toLowerCase();

  if (/\brace\b|tävl|lopp\b|competition|match/i.test(text)) return "race";
  if (/long\b|lång.*pass|långpass|lång.*löp/i.test(text)) return "long";
  if (/interval|vo2|bana\b|fartlek|speed.*work|sprint/i.test(text)) return "vo2max";
  if (/tempo\b|tröskel|threshold|laktattrösk|LT2|at-pass/i.test(text)) return "threshold";
  if (/easy\b|lugn\b|återhämt|recovery|restore|vila\b|active.*rest/i.test(text)) return "easy";

  // Zone distribution from template
  if (pw.template?.estimatedZoneDistribution) {
    const z = pw.template.estimatedZoneDistribution;
    const total = Object.values(z).reduce((s: number, v) => s + (v as number), 0);
    if (total > 0) {
      const z5pct = ((z["z5"] ?? 0) as number) / total;
      const z4pct = ((z["z4"] ?? 0) as number) / total;
      const z12pct = (((z["z1"] ?? 0) as number) + ((z["z2"] ?? 0) as number)) / total;
      const totalMin = total / 60;
      if (z5pct > 0.10) return "vo2max";
      if (z4pct > 0.15) return "threshold";
      if (totalMin > 80 && z12pct > 0.75) return "long";
      if (z12pct > 0.80) return "easy";
      if (z12pct > 0.60) return "aerobic";
    }
  }

  // Duration-based fallback
  if (pw.targetDuration && pw.targetDuration > 90 * 60) return "long";
  if (pw.targetDuration && pw.targetDuration < 30 * 60) return "easy";

  return "other";
}

export function classifyActivityIntent(
  act: ActivityForMatch,
  maxHR: number,
): WorkoutIntent {
  const sport = act.sportType.toLowerCase();
  if (/weight|gym|strength|styrka/i.test(sport)) return "strength";
  if (act.isRace) return "race";

  const hrFraction = act.averageHeartrate ? act.averageHeartrate / maxHR : null;
  const durationMin = act.movingTime / 60;

  if (hrFraction !== null) {
    if (hrFraction > 0.92 || (act.maxHeartrate ?? 0) > maxHR * 0.97) return "vo2max";
    if (hrFraction > 0.84) return "threshold";
    if (hrFraction < 0.76 && durationMin > 80) return "long";
    if (hrFraction < 0.73 && durationMin > 50) return "easy";
    if (hrFraction < 0.76) return "easy";
    return "aerobic";
  }

  // No HR: name-based
  const name = act.name.toLowerCase();
  if (/interval|bana\b|vo2|fartlek|speed/i.test(name)) return "vo2max";
  if (/tempo|tröskel|threshold/i.test(name)) return "threshold";
  if (/easy|lugn|återhämt|recovery/i.test(name)) return "easy";
  if (durationMin > 80) return "long";

  return "other";
}

function intentCompatibility(a: WorkoutIntent, b: WorkoutIntent): number {
  if (a === b) return 1.0;
  const pairs: [WorkoutIntent, WorkoutIntent, number][] = [
    ["easy",      "aerobic",   0.70],
    ["aerobic",   "easy",      0.70],
    ["long",      "easy",      0.60],
    ["long",      "aerobic",   0.50],
    ["easy",      "long",      0.60],
    ["aerobic",   "long",      0.50],
    ["aerobic",   "threshold", 0.35],
    ["threshold", "aerobic",   0.35],
    ["threshold", "vo2max",    0.30],
    ["vo2max",    "threshold", 0.30],
    ["other",     "easy",      0.50],
    ["other",     "aerobic",   0.50],
    ["other",     "threshold", 0.30],
    ["other",     "long",      0.40],
    ["easy",      "other",     0.50],
    ["aerobic",   "other",     0.50],
    ["long",      "other",     0.40],
  ];
  for (const [x, y, score] of pairs) {
    if (a === x && b === y) return score;
  }
  return 0;
}

function sportCompatible(actSport: string, planSport: string): boolean {
  if (!actSport || !planSport) return false;
  const a = actSport.toLowerCase();
  const p = planSport.toLowerCase();
  if (a === p) return true;
  // Running variants
  const runs = ["run", "trailrun", "virtualrun", "treadmill"];
  if (runs.some(r => a.includes(r)) && runs.some(r => p.includes(r))) return true;
  // Cycling variants
  const bikes = ["ride", "virtualride", "cycle", "cycling", "mountainbike", "gravel"];
  if (bikes.some(r => a.includes(r)) && bikes.some(r => p.includes(r))) return true;
  // Orienteering → running
  if (a.includes("orienteer") && runs.some(r => p.includes(r))) return true;
  return false;
}

// ── Main matcher ──────────────────────────────────────────────────────────────

export function matchActivityToPlanned(
  act: ActivityForMatch,
  candidates: PlannedWorkoutForMatch[],
  maxHR: number,
): MatchResult | null {
  const actIntent = classifyActivityIntent(act, maxHR);
  let best: (MatchResult & { score: number }) | null = null;

  for (const pw of candidates) {
    // Sport must be compatible (hard requirement)
    if (!sportCompatible(act.sportType, pw.sportType)) continue;

    const pwIntent = classifyPlannedIntent(pw);
    const intentScore = intentCompatibility(actIntent, pwIntent);
    let score = 40 + intentScore * 35; // 40 base for sport match + up to 35 for intent

    // Distance bonus (optional)
    if (act.distance > 0 && pw.targetDistance && pw.targetDistance > 0) {
      const ratio = act.distance / pw.targetDistance;
      if (ratio > 0.80 && ratio < 1.20) score += 15;
      else if (ratio > 0.65 && ratio < 1.35) score += 7;
    }

    // Duration bonus (optional)
    if (act.movingTime > 0 && pw.targetDuration && pw.targetDuration > 0) {
      const ratio = act.movingTime / pw.targetDuration;
      if (ratio > 0.75 && ratio < 1.25) score += 10;
      else if (ratio > 0.60 && ratio < 1.40) score += 5;
    }

    if (score > (best?.score ?? 0)) {
      best = {
        activityId: act.id,
        plannedId: pw.id,
        confidence: Math.round(score),
        activityIntent: actIntent,
        plannedIntent: pwIntent,
        score,
      };
    }
  }

  if (!best || best.confidence < 55) return null;
  return {
    activityId: best.activityId,
    plannedId: best.plannedId,
    confidence: best.confidence,
    activityIntent: best.activityIntent,
    plannedIntent: best.plannedIntent,
  };
}

/**
 * Match all unmatched activities against planned workouts within ±1 day.
 * Returns list of matches to apply.
 */
export function matchActivitiesToPlan(
  activities: ActivityForMatch[],
  plannedWorkouts: PlannedWorkoutForMatch[],
  maxHR: number,
): MatchResult[] {
  const results: MatchResult[] = [];
  const usedPlannedIds = new Set<string>();

  // Sort activities newest-first so recent get priority
  const sorted = [...activities].sort(
    (a, b) => b.startDateLocal.getTime() - a.startDateLocal.getTime(),
  );

  for (const act of sorted) {
    const actDate = act.startDateLocal.toISOString().split("T")[0];

    // Candidates: planned workouts ±1 day from activity date
    const candidates = plannedWorkouts.filter(pw => {
      if (usedPlannedIds.has(pw.id)) return false;
      const diff = Math.abs(
        new Date(pw.date).getTime() - new Date(actDate).getTime(),
      );
      return diff <= 24 * 60 * 60 * 1000; // ≤ 1 day apart
    });

    const match = matchActivityToPlanned(act, candidates, maxHR);
    if (match) {
      results.push(match);
      usedPlannedIds.add(match.plannedId);
    }
  }

  return results;
}
