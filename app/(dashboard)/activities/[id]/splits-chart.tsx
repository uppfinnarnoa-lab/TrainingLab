"use client";

/**
 * Splits chart — Strava-style lap view:
 * - Bar HEIGHT = relative pace (faster = taller, inverted axis)
 * - Bar WIDTH  = proportional to time (slower km = wider bar)
 * - Colour encodes pace vs activity average
 * - Dynamic scale: min/max derived from THIS activity's pace range
 */

import { useMemo } from "react";

interface Split {
  split: number;
  distance: number;       // meters
  moving_time: number;    // seconds
  average_speed: number;  // m/s
  average_heartrate?: number;
  elevation_difference?: number;
}

interface Props {
  splits: Split[];
  avgSpeedMs: number;
  isLaps?: boolean;
}

function secPerKmStr(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SplitsChart({ splits, avgSpeedMs, isLaps }: Props) {
  const validSplits = splits.filter(s => s.average_speed > 0 && s.moving_time > 0 && s.distance > 200);
  if (validSplits.length < 2) return null;

  const avgSecPerKm  = avgSpeedMs > 0 ? 1000 / avgSpeedMs : 300;
  const paces        = validSplits.map(s => 1000 / s.average_speed);
  const minPace      = Math.min(...paces);
  const maxPace      = Math.max(...paces);
  // Padding so fastest/slowest bars don't touch the ceiling/floor
  const scalePad     = Math.max((maxPace - minPace) * 0.15, 10);
  const scaleMin     = minPace - scalePad;
  const scaleMax     = maxPace + scalePad;
  const scaleRange   = scaleMax - scaleMin;
  const totalTimeSec = validSplits.reduce((s, sp) => s + sp.moving_time, 0);

  const chartHeight  = 100; // px

  const bars = useMemo(() => validSplits.map(sp => {
    const pace     = 1000 / sp.average_speed;
    const widthPct = (sp.moving_time / totalTimeSec) * 100;
    // Invert: faster pace (lower sec/km) = taller bar
    const heightPct = Math.max(2, Math.min(100, ((scaleMax - pace) / scaleRange) * 100));
    const delta = pace - avgSecPerKm;
    const color = delta < -8 ? "#6EE7B7" : delta > 8 ? "#F87171" : "#818CF8";
    return { sp, pace, widthPct, heightPct, color };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [validSplits, totalTimeSec, scaleMax, scaleRange, avgSecPerKm]);

  // Avg pace line: exact position in the same coordinate space
  const avgLineHeightPct = Math.max(2, Math.min(98, ((scaleMax - avgSecPerKm) / scaleRange) * 100));

  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
        {isLaps ? "Laps" : "Splits"} — bredd = tid · höjd = tempo
      </p>

      <div className="relative" style={{ height: chartHeight + 28 }}>
        {/* Baseline */}
        <div className="absolute bottom-7 left-0 right-0 border-b border-border/50" />

        {/* Average pace dashed line — correctly computed from scale */}
        <div
          className="absolute left-0 right-0 border-b border-dashed border-accent/50 pointer-events-none"
          style={{ bottom: 7 + chartHeight * (avgLineHeightPct / 100) }}
          title={`Snittempo: ${secPerKmStr(avgSecPerKm)}/km`}
        />

        {/* Bars */}
        <div className="absolute bottom-7 left-0 right-0 flex items-end" style={{ gap: "1px" }}>
          {bars.map(({ sp, pace, widthPct, heightPct, color }) => (
            <div key={sp.split}
              className="relative shrink-0 rounded-t-sm transition-all cursor-default group/bar"
              style={{
                width: `calc(${widthPct}% - 1px)`,
                height: `${(heightPct / 100) * chartHeight}px`,
                backgroundColor: `${color}85`,
                borderTop: `2px solid ${color}`,
              }}
            >
              {/* Hover tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/bar:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-center whitespace-nowrap shadow-xl">
                  <p className="font-semibold font-mono text-primary">{secPerKmStr(pace)}/km</p>
                  <p className="text-muted">{isLaps ? "Lap" : "km"} {sp.split}</p>
                  {sp.average_heartrate && (
                    <p className="text-muted">{Math.round(sp.average_heartrate)} bpm</p>
                  )}
                  {sp.elevation_difference != null && sp.elevation_difference !== 0 && (
                    <p className="text-muted">{sp.elevation_difference > 0 ? "+" : ""}{Math.round(sp.elevation_difference)} m</p>
                  )}
                </div>
                <div className="w-2 h-2 bg-surface border-b border-r border-border rotate-45 -mt-1" />
              </div>
            </div>
          ))}
        </div>

        {/* Pace scale: fastest at top, slowest at bottom */}
        <div className="absolute right-0 top-0 bottom-7 flex flex-col justify-between pointer-events-none pr-1">
          <span className="text-[9px] text-muted font-mono leading-none">{secPerKmStr(scaleMin)}</span>
          <span className="text-[9px] text-muted font-mono leading-none">{secPerKmStr(scaleMax)}</span>
        </div>

        {/* km labels */}
        <div className="absolute bottom-0 left-0 right-0 flex">
          {bars.map(({ sp, widthPct }) => (
            <div key={sp.split} style={{ width: `${widthPct}%` }}
              className="shrink-0 text-center text-[9px] text-muted truncate">
              {sp.split}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px] text-muted flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: "#6EE7B785", borderTop: "2px solid #6EE7B7" }} />
          Snabbare
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: "#818CF885", borderTop: "2px solid #818CF8" }} />
          Snittempo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: "#F8717185", borderTop: "2px solid #F87171" }} />
          Långsammare
        </span>
        <span className="ml-auto opacity-60">Håll muspekaren för detaljer</span>
      </div>
    </div>
  );
}
