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

const DEFAULT_PACE_SEC_PER_KM = 360; // 6:00/km — used only when a distance segment has no target pace set

function segmentSeconds(
  durationType: "time" | "distance" | "open" | undefined,
  duration: number | null | undefined,
  distance: number | null | undefined,
  paceLow: number | null | undefined,
  paceHigh: number | null | undefined,
): number {
  if (durationType === "time" && duration) return duration;
  if (durationType === "distance" && distance) {
    const pace = paceHigh ? ((paceLow ?? paceHigh) + paceHigh) / 2 : DEFAULT_PACE_SEC_PER_KM;
    return (distance / 1000) * pace;
  }
  return 0;
}

export function estimateSections(sections: EstimatableSection[]) {
  let totalSec = 0;
  let totalM = 0;
  const zoneSec: Record<string, number> = {};

  for (const s of sections) {
    const reps = s.repetitions ?? 1;

    const activeSec = segmentSeconds(s.durationType, s.duration, s.distance, s.targetPaceLow, s.targetPaceHigh);
    const activeM = s.durationType === "distance" && s.distance ? s.distance : 0;

    const restSec = s.restDurationType
      ? segmentSeconds(s.restDurationType, s.restDuration, s.restDistance, null, null)
      : 0;
    const restM = s.restDurationType === "distance" && s.restDistance ? s.restDistance : 0;

    totalSec += (activeSec + restSec) * reps;
    totalM += (activeM + restM) * reps;

    if (s.targetZone && activeSec > 0) {
      const z = `z${s.targetZone}`;
      zoneSec[z] = (zoneSec[z] ?? 0) + activeSec * reps;
    }
    if (s.restTargetZone && restSec > 0) {
      const z = `z${s.restTargetZone}`;
      zoneSec[z] = (zoneSec[z] ?? 0) + restSec * reps;
    }
  }

  return { totalSec, totalM, zoneSec };
}

// Shape persisted on WorkoutTemplate.estimatedDuration/estimatedDistance/estimatedZoneDistribution.
export function computeTemplateEstimate(sections: EstimatableSection[]) {
  const { totalSec, totalM, zoneSec } = estimateSections(sections);
  return {
    estimatedDuration: totalSec > 0 ? Math.round(totalSec) : null,
    estimatedDistance: totalM > 0 ? totalM : null,
    estimatedZoneDistribution: Object.keys(zoneSec).length > 0 ? zoneSec : null,
  };
}
