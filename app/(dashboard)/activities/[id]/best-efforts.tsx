"use client";

import { formatPace } from "@/lib/utils";

interface BestEffort {
  name: string;
  distance: number;
  elapsed_time: number;
}

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BestEffortsTable({ bestEfforts }: { bestEfforts: BestEffort[] }) {
  if (!bestEfforts || bestEfforts.length === 0) return null;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2">
        <p className="text-sm font-semibold text-primary">Best efforts (this activity)</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2 text-xs text-muted font-medium">Distance</th>
            <th className="text-right px-4 py-2 text-xs text-muted font-medium">Time</th>
            <th className="text-right px-4 py-2 text-xs text-muted font-medium">Pace</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bestEfforts.map((e, i) => {
            const speedMs = e.distance / e.elapsed_time;
            return (
              <tr key={i} className="hover:bg-surface-2 transition-colors">
                <td className="px-4 py-2.5 text-primary font-medium">{e.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-primary font-semibold">
                  {fmtTime(e.elapsed_time)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted">
                  {speedMs > 0 ? `${formatPace(speedMs)}/km` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
