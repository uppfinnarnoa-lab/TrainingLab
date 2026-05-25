"use client";

import { formatPace } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Split {
  split: number;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  average_speed: number;
  elevation_difference?: number;
}

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SplitsTable({ splits, isLaps }: { splits: Split[]; isLaps?: boolean }) {
  if (!splits || splits.length === 0) return null;

  const paces = splits.map(s => s.moving_time / (s.distance / 1000));
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const range = maxPace - minPace || 1;

  // Cumulative elapsed time per row
  let cumSec = 0;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2">
        <p className="text-sm font-semibold text-primary">{isLaps ? "Laps" : "Splits"}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2 text-xs text-muted font-medium">{isLaps ? "Lap" : "km"}</th>
            {isLaps && <th className="text-right px-4 py-2 text-xs text-muted font-medium">Dist</th>}
            <th className="text-right px-4 py-2 text-xs text-muted font-medium">Pace</th>
            {isLaps && <th className="text-right px-4 py-2 text-xs text-muted font-medium">Lap time</th>}
            {isLaps && <th className="text-right px-4 py-2 text-xs text-muted font-medium">Elapsed</th>}
            <th className="px-4 py-2 w-28" />
            <th className="text-right px-4 py-2 text-xs text-muted font-medium">HR</th>
            <th className="text-right px-4 py-2 text-xs text-muted font-medium">Elev</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {splits.map((s, i) => {
            const pace = s.moving_time / (s.distance / 1000);
            const paceStr = formatPace(s.average_speed);
            const pct = Math.round(((maxPace - pace) / range) * 100);
            const isFastest = pace === minPace;
            const distKm = Math.round(s.distance / 10) / 100;
            cumSec += s.moving_time;
            return (
              <tr key={i} className="hover:bg-surface-2 transition-colors">
                <td className="px-4 py-2.5 font-mono text-muted">{s.split}</td>
                {isLaps && <td className="px-4 py-2.5 text-right font-mono text-muted">{distKm} km</td>}
                <td className={cn("px-4 py-2.5 text-right font-mono font-semibold",
                  isFastest ? "text-accent" : "text-primary")}>
                  {paceStr}
                </td>
                {isLaps && <td className="px-4 py-2.5 text-right font-mono text-muted">{fmtTime(s.moving_time)}</td>}
                {isLaps && <td className="px-4 py-2.5 text-right font-mono text-muted">{fmtTime(cumSec)}</td>}
                <td className="px-4 py-2.5">
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.max(pct, 5)}%` }} />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted">
                  {s.average_heartrate ? `${Math.round(s.average_heartrate)}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted">
                  {s.elevation_difference != null && s.elevation_difference !== 0
                    ? `${isLaps ? "" : s.elevation_difference > 0 ? "+" : ""}${Math.round(s.elevation_difference)}m`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
