// Race distance definitions and pace formatting utilities.

export const RACE_DISTANCES: { label: string; meters: number }[] = [
  { label: "800m",          meters: 800 },
  { label: "1500m",         meters: 1500 },
  { label: "Mile",          meters: 1609 },
  { label: "3K",            meters: 3000 },
  { label: "5K",            meters: 5000 },
  { label: "10K",           meters: 10000 },
  { label: "15K",           meters: 15000 },
  { label: "Half Marathon", meters: 21097 },
  { label: "Marathon",      meters: 42195 },
];

export function secPerKmToPaceStr(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return "–";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

export function secToTimeStr(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
