// Canonical race-distance presets — shared between manual entry (races-client.tsx)
// and automatic PB detection (lib/races/pb-detection.ts) so both produce the same
// `distance` label for the same `distanceM`, keeping manual and auto-detected
// results in the same per-distance history bucket on the Races page.
//
// Covers both common race distances and every distance Strava computes a
// `bestEffort` for (400m, 800m, 1K, Mile, 2 Mile, 5K, 10K, 15K, 10 Mile, 20K,
// Half Marathon, 30K, Marathon) plus a few extra common race distances
// (1500m, 2K, 3K) that Strava doesn't track as a bestEffort but users often
// race and enter manually.
export interface DistancePreset {
  label: string;
  meters: number;
}

export const RACE_DISTANCE_PRESETS: DistancePreset[] = [
  { label: "400m",          meters: 400 },
  { label: "800m",          meters: 800 },
  { label: "1K",            meters: 1000 },
  { label: "1500m",         meters: 1500 },
  { label: "Mile",          meters: 1609 },
  { label: "2K",            meters: 2000 },
  { label: "3K",            meters: 3000 },
  { label: "2 Mile",        meters: 3219 },
  { label: "5K",            meters: 5000 },
  { label: "10K",           meters: 10000 },
  { label: "15K",           meters: 15000 },
  { label: "10 Mile",       meters: 16090 },
  { label: "20K",           meters: 20000 },
  { label: "Half Marathon", meters: 21097 },
  { label: "30K",           meters: 30000 },
  { label: "Marathon",      meters: 42195 },
];

// Strava's best-effort distances are computed from an exact GPS-interpolated
// segment of that nominal length, so a tight absolute tolerance is enough —
// no need for a percentage-based tolerance here (that would risk two adjacent
// presets, e.g. 1609m Mile vs. 1500m, becoming ambiguous at longer distances).
const DISTANCE_MATCH_TOLERANCE_M = 5;

export function matchTrackedDistance(meters: number): DistancePreset | null {
  return RACE_DISTANCE_PRESETS.find(d => Math.abs(d.meters - meters) <= DISTANCE_MATCH_TOLERANCE_M) ?? null;
}
