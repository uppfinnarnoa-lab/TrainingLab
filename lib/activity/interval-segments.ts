// lib/activity/interval-segments.ts
import { INTERVAL_PACE_THRESHOLD_SEC_PER_KM } from "./interval-detection";

export interface MergedSegment {
  label: string;
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
  lapCount: number;
}

interface RawLap {
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
}

export function mergeLapsIntoSegments(
  laps: RawLap[],
  thresholdSecPerKm: number = INTERVAL_PACE_THRESHOLD_SEC_PER_KM,
): MergedSegment[] {
  if (laps.length === 0) return [];

  type SegmentState = "easy" | "work";

  interface OpenSegment {
    state: SegmentState;
    laps: RawLap[];
    totalDistance: number;
    totalTime: number;
  }

  const closed: OpenSegment[] = [];
  let current: OpenSegment = { state: "easy", laps: [], totalDistance: 0, totalTime: 0 };

  for (const lap of laps) {
    const lapPaceSec = lap.average_speed > 0 ? 1000 / lap.average_speed : Infinity;
    const currentAvgPace = current.totalTime > 0 && current.totalDistance > 0
      ? (current.totalTime / current.totalDistance) * 1000
      : Infinity;

    if (current.state === "easy" && currentAvgPace - lapPaceSec >= thresholdSecPerKm) {
      // Switching to work — close easy, open work
      if (current.laps.length > 0) closed.push(current);
      current = { state: "work", laps: [], totalDistance: 0, totalTime: 0 };
    } else if (current.state === "work" && lapPaceSec - currentAvgPace >= thresholdSecPerKm) {
      // Switching to easy — close work, open easy
      if (current.laps.length > 0) closed.push(current);
      current = { state: "easy", laps: [], totalDistance: 0, totalTime: 0 };
    }

    current.laps.push(lap);
    current.totalDistance += lap.distance;
    current.totalTime += lap.moving_time;
  }

  if (current.laps.length > 0) closed.push(current);

  // Label segments positionally
  let workCount = 0;
  let easyCount = 0;
  const firstWorkIndex = closed.findIndex(s => s.state === "work");
  const lastWorkIndex = closed.reduce((li, s, i) => (s.state === "work" ? i : li), -1);

  return closed.map((seg, idx) => {
    const totalTime = seg.laps.reduce((s, l) => s + l.moving_time, 0);
    const totalDist = seg.laps.reduce((s, l) => s + l.distance, 0);
    const avgSpeed = totalTime > 0 ? totalDist / totalTime : 0;

    // Time-weighted HR average
    const lapsWithHR = seg.laps.filter(l => l.average_heartrate != null && l.moving_time > 0);
    const avgHR = lapsWithHR.length > 0
      ? lapsWithHR.reduce((s, l) => s + l.average_heartrate! * l.moving_time, 0) /
        lapsWithHR.reduce((s, l) => s + l.moving_time, 0)
      : undefined;

    const elevDiff = seg.laps.some(l => l.elevation_difference != null)
      ? seg.laps.reduce((s, l) => s + (l.elevation_difference ?? 0), 0)
      : undefined;

    let label: string;
    if (seg.state === "easy") {
      if (firstWorkIndex === -1) {
        // No work segments at all — just call them all "Lap N"
        easyCount++;
        label = `Lap ${easyCount}`;
      } else if (idx < firstWorkIndex) {
        label = "Uppvärmning";
      } else if (idx > lastWorkIndex) {
        label = "Nedvarvning";
      } else {
        easyCount++;
        label = `Vila ${easyCount}`;
      }
    } else {
      workCount++;
      label = `Intervall ${workCount}`;
    }

    return {
      label,
      distance: totalDist,
      moving_time: totalTime,
      average_speed: avgSpeed,
      average_heartrate: avgHR,
      elevation_difference: elevDiff,
      lapCount: seg.laps.length,
    };
  });
}
