/**
 * Centralized color logic for the planner.
 *
 * Running → color depends on workout TYPE:
 *   Tävling / race          → Yellow  #FBBF24
 *   Tröskell / Tempo / LT   → Pink    #F472B6
 *   Hårda intervaller       → Purple  #818CF8
 *   Easy / Distans / default→ Sky     #7DD3FC
 *
 * Other sports → color depends on SPORT:
 *   Cycling / Cykel         → Orange  #FB923C
 *   Orienteering / OL       → Teal    #2DD4BF
 *   Strength / Styrka / Gym → Amber   #F97316
 *   Nordic Skiing           → Ice     #BAE6FD
 *   Roller Skiing           → Sky     #38BDF8
 *   Swimming                → Blue    #60A5FA
 *
 * Status markings (separate from color — overlaid on the pill):
 *   Completed  → green left border  #22C55E
 *   Missed     → red left border    #EF4444
 *   Planned (past, unlogged) → orange accent border
 */

// ── Workout type / sport colors ──────────────────────────────────────────

export const STATUS_COLORS = {
  completed: "#22C55E",
  missed:    "#EF4444",
  partial:   "#F97316",
  unlogged:  "#FBBF24", // past workout not yet marked
  planned:   null,      // future — uses workout color only
} as const;

export function workoutColor(sportName: string, typeName?: string | null): string {
  const s = sportName.toLowerCase();
  const t = (typeName ?? "").toLowerCase();

  // Non-running sports → colour by sport
  if (/cycl|ride|cykel|bike/.test(s)) return "#FB923C";       // orange
  if (/orienteer|ol\b/.test(s))        return "#2DD4BF";       // teal
  if (/strength|styrka|gym|weight/.test(s)) return "#F97316";  // amber
  if (/nordicski|klassisk|backcountry|längdski/.test(s)) return "#BAE6FD"; // ice blue
  if (/rollerski|rullski/.test(s))     return "#38BDF8";       // sky blue
  if (/swim|sim/.test(s))              return "#60A5FA";       // blue

  // Running (and trail run, virtual run) → colour by type
  if (/run|trail|virtual/.test(s)) {
    if (/tävl|race|lopp|mila|stafett|sic\b|sprint|2dagars/.test(t)) return "#FBBF24"; // yellow — race
    if (/tröskel|threshold|tempo|lång tröskel|lt\b/.test(t))         return "#F472B6"; // pink — threshold
    if (/intervall|interval|4x4|fartlek|tabata|korta|mosse/.test(t)) return "#818CF8"; // purple — hard intervals
    return "#7DD3FC"; // sky — easy / distans / default
  }

  return "#7DD3FC"; // fallback
}

/** Colour from a sport name alone (for non-running sports in templates) */
export function sportOnlyColor(sportName: string): string {
  return workoutColor(sportName, null);
}

/** The border/indicator colour that shows completion status, layered ON TOP of workout colour */
export function statusBorderColor(
  status: string,
  workoutDate: string,
): string | null {
  if (status === "completed" || status === "partial") return STATUS_COLORS.completed;
  if (status === "missed")                             return STATUS_COLORS.missed;
  // Past workout not yet logged
  const isPast = workoutDate < new Date().toISOString().split("T")[0];
  if (status === "planned" && isPast)                  return STATUS_COLORS.unlogged;
  return null; // future planned — no status border
}
