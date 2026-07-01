// Pure estimate math for workout sections — shared by the server (templates
// API routes, computing estimatedDuration/estimatedDistance/estimatedZoneDistribution)
// and the client (WorkoutBuilder's live preview), so the two never drift.

export interface EstimatableSection {
  durationType: "time" | "distance" | "open";
  duration?: number | null;
  distance?: number | null;
  repetitions?: number | null;
  targetZone?: number | null;
  targetPaceLow?: number | null;
  targetPaceHigh?: number | null;
  restDurationType?: "time" | "distance" | null;
  restDuration?: number | null;
  restDistance?: number | null;
  restTargetZone?: number | null;
}

// [z1..z5], each [slowSecPerKm, fastSecPerKm] — same shape as WorkoutBuilder's
// `paceZones` prop (built from the athlete's VDOT, see lib/fitness/zones.ts).
export type PaceZoneRanges = number[][];

const DEFAULT_PACE_SEC_PER_KM = 360; // 6:00/km — last-resort fallback when no zone/pace is known at all

// Section-level targetPaceLow/targetPaceHigh take priority (an explicit override,
// though the builder UI doesn't currently expose setting them), then the
// athlete's real calibrated pace for the section's target zone, then a flat default.
function resolvePace(
  targetZone: number | null | undefined,
  paceLow: number | null | undefined,
  paceHigh: number | null | undefined,
  paceZones: PaceZoneRanges | undefined,
): number {
  if (paceHigh) return ((paceLow ?? paceHigh) + paceHigh) / 2;
  const zoneRange = targetZone ? paceZones?.[targetZone - 1] : undefined;
  if (zoneRange) return (zoneRange[0] + zoneRange[1]) / 2;
  return DEFAULT_PACE_SEC_PER_KM;
}

// One segment instance (active or rest), not yet multiplied by repetitions.
// A time-only segment gets its distance estimated from pace, and vice versa,
// so either dimension being unset doesn't drop the segment from the totals.
function resolveSegment(
  durationType: "time" | "distance" | "open" | undefined,
  duration: number | null | undefined,
  distance: number | null | undefined,
  targetZone: number | null | undefined,
  paceLow: number | null | undefined,
  paceHigh: number | null | undefined,
  paceZones: PaceZoneRanges | undefined,
): { sec: number; m: number } {
  if (durationType === "time" && duration) {
    if (distance) return { sec: duration, m: distance }; // both known — use literally, don't estimate
    const pace = resolvePace(targetZone, paceLow, paceHigh, paceZones);
    return { sec: duration, m: pace > 0 ? (duration / pace) * 1000 : 0 };
  }
  if (durationType === "distance" && distance) {
    if (duration) return { sec: duration, m: distance }; // both known — use literally
    const pace = resolvePace(targetZone, paceLow, paceHigh, paceZones);
    return { sec: (distance / 1000) * pace, m: distance };
  }
  return { sec: 0, m: 0 };
}

export function estimateSections(sections: EstimatableSection[], paceZones?: PaceZoneRanges) {
  let totalSec = 0;
  let activeSec = 0; // totalSec minus rest segments — the actual work/interval time
  let totalM = 0;
  const zoneSec: Record<string, number> = {};

  for (const s of sections) {
    const reps = s.repetitions ?? 1;

    const active = resolveSegment(s.durationType, s.duration, s.distance, s.targetZone, s.targetPaceLow, s.targetPaceHigh, paceZones);
    const rest = s.restDurationType
      ? resolveSegment(s.restDurationType, s.restDuration, s.restDistance, s.restTargetZone, null, null, paceZones)
      : { sec: 0, m: 0 };

    totalSec += (active.sec + rest.sec) * reps;
    activeSec += active.sec * reps;
    totalM += (active.m + rest.m) * reps;

    if (s.targetZone && active.sec > 0) {
      const z = `z${s.targetZone}`;
      zoneSec[z] = (zoneSec[z] ?? 0) + active.sec * reps;
    }
    if (s.restTargetZone && rest.sec > 0) {
      const z = `z${s.restTargetZone}`;
      zoneSec[z] = (zoneSec[z] ?? 0) + rest.sec * reps;
    }
  }

  return { totalSec, activeSec, totalM, zoneSec };
}

// Shape persisted on WorkoutTemplate.estimatedDuration/estimatedDistance/estimatedZoneDistribution.
export function computeTemplateEstimate(sections: EstimatableSection[], paceZones?: PaceZoneRanges) {
  const { totalSec, totalM, zoneSec } = estimateSections(sections, paceZones);
  return {
    estimatedDuration: totalSec > 0 ? Math.round(totalSec) : null,
    estimatedDistance: totalM > 0 ? totalM : null,
    estimatedZoneDistribution: Object.keys(zoneSec).length > 0 ? zoneSec : null,
  };
}
