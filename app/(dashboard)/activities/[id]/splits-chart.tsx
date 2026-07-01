"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface Split {
  split: number | string;
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
}

interface Props {
  splits: Split[];
  avgSpeedMs: number;
  isLaps?: boolean;
  color?: string;
}

type XMode = "distance" | "time";

function secPerKmStr(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Non-linear exponent: makes fastest laps dramatically taller
const POWER = 2.8;

export function SplitsChart({ splits, avgSpeedMs, isLaps, color = "#7DD3FC" }: Props) {
  const [xMode, setXMode] = useState<XMode>("time");

  const validSplits = splits.filter(s => s.average_speed > 0 && s.moving_time > 0 && s.distance > 10);
  if (validSplits.length < 2) return null;

  const avgSecPerKm  = avgSpeedMs > 0 ? 1000 / avgSpeedMs : 300;
  const paces        = validSplits.map(s => 1000 / s.average_speed);

  // Scale reference: P10–P90, not raw min/max. A single GPS-glitch or paused-lap
  // outlier would otherwise stretch the whole axis and crush every real lap down
  // to the height floor (and drag the avg-pace line down into the x-axis labels).
  const sortedPaces   = [...paces].sort((a, b) => a - b);
  const scaleFastPace = sortedPaces[Math.max(0, Math.floor(sortedPaces.length * 0.10))];
  const scaleSlowPace = sortedPaces[Math.min(sortedPaces.length - 1, Math.floor(sortedPaces.length * 0.90))];
  const paceRange     = Math.max(scaleSlowPace - scaleFastPace, 5);

  const totalTimeSec = validSplits.reduce((s, sp) => s + sp.moving_time, 0);
  const totalDistM   = validSplits.reduce((s, sp) => s + sp.distance, 0);

  const chartHeight  = 120;
  // Show at most 8 X-axis labels
  const labelEvery   = Math.max(1, Math.ceil(validSplits.length / 8));

  const bars = useMemo(() => {
    let cumTimeSec = 0;
    let cumDistM   = 0;
    return validSplits.map((sp, i) => {
      const pace = 1000 / sp.average_speed;
      const widthPct = xMode === "time"
        ? (sp.moving_time / totalTimeSec) * 100
        : (sp.distance   / totalDistM)   * 100;

      // 0 = slowest, 1 = fastest — clamped to the P10–P90 scale so an outlier lap
      // outside that range renders at the floor/ceiling instead of NaN or overflow.
      const normalizedSpeed = Math.max(0, Math.min(1, (scaleSlowPace - pace) / paceRange));

      // Power curve: slow laps compressed toward zero, fast laps at full height
      const heightFrac = Math.max(0.04, Math.pow(normalizedSpeed, POWER));

      // Alpha: 18% for slowest → 100% for fastest
      const alpha    = Math.round((0.18 + 0.82 * normalizedSpeed) * 255);
      const alphaHex = alpha.toString(16).padStart(2, "0");

      cumTimeSec += sp.moving_time;
      cumDistM   += sp.distance;

      const showLabel = i % labelEvery === 0 || i === validSplits.length - 1;
      const label = showLabel
        ? (xMode === "time"
            ? fmtDuration(cumTimeSec)
            : `${(cumDistM / 1000).toFixed(1)}k`)
        : "";

      return { sp, pace, widthPct, heightFrac, alphaHex, label };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSplits, xMode, totalTimeSec, totalDistM, scaleFastPace, scaleSlowPace, paceRange, labelEvery]);

  // Avg pace line: position in the same clamped non-linear scale as the bars
  const avgNorm     = Math.max(0, Math.min(1, (scaleSlowPace - avgSecPerKm) / paceRange));
  const avgLineFrac = Math.pow(avgNorm, POWER);

  return (
    <div>
      {/* Header + toggle */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          {isLaps ? "Laps" : "Splits"} — height = pace · width = {xMode === "time" ? "time" : "distance"}
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
          <button
            onClick={() => setXMode("distance")}
            className={cn("px-2.5 py-1 rounded-md transition-colors font-medium",
              xMode === "distance" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
          >
            Distance
          </button>
          <button
            onClick={() => setXMode("time")}
            className={cn("px-2.5 py-1 rounded-md transition-colors font-medium",
              xMode === "time" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
          >
            Time
          </button>
        </div>
      </div>

      <div className="relative" style={{ height: chartHeight + 28 }}>
        {/* Baseline */}
        <div className="absolute bottom-7 left-0 right-10 border-b border-border/50" />

        {/* Average pace dashed line — base offset (28) matches the bars' own
            "bottom-7" baseline (Tailwind spacing token 7 = 28px, not 7px) */}
        <div
          className="absolute left-0 right-10 border-b border-dashed border-accent/50 pointer-events-none"
          style={{ bottom: 28 + chartHeight * avgLineFrac }}
          title={`Avg pace: ${secPerKmStr(avgSecPerKm)}/km`}
        />

        {/* Bars — right-10 reserves space for pace scale labels */}
        <div className="absolute bottom-7 left-0 right-10 flex items-end" style={{ gap: "1px" }}>
          {bars.map(({ sp, pace, widthPct, heightFrac, alphaHex }) => (
            <div
              key={sp.split}
              className="relative shrink-0 rounded-t-sm cursor-default group/bar"
              style={{
                width: `calc(${widthPct}% - 1px)`,
                height: `${heightFrac * chartHeight}px`,
                backgroundColor: `${color}${alphaHex}`,
                borderTop: `2px solid ${color}${alphaHex}`,
              }}
            >
              {/* Hover tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/bar:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-center whitespace-nowrap shadow-xl">
                  <p className="font-semibold font-mono text-primary">{secPerKmStr(pace)}/km</p>
                  <p className="text-muted">{isLaps ? "Lap" : "km"} {sp.split}</p>
                  <p className="text-muted">{(sp.distance / 1000).toFixed(2)} km · {fmtDuration(sp.moving_time)}</p>
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

        {/* Pace scale: fastest at top, slowest at bottom (P10–P90 range — matches bar scale) */}
        <div className="absolute right-0 top-0 bottom-7 flex flex-col justify-between pointer-events-none pr-1">
          <span className="text-[9px] text-muted font-mono leading-none">{secPerKmStr(scaleFastPace)}</span>
          <span className="text-[9px] text-muted font-mono leading-none">{secPerKmStr(scaleSlowPace)}</span>
        </div>

        {/* X-axis labels — right-10 matches bars container */}
        <div className="absolute bottom-0 left-0 right-10 flex">
          {bars.map(({ sp, widthPct, label }) => (
            <div key={sp.split} style={{ width: `${widthPct}%` }}
              className="shrink-0 text-center text-[9px] text-muted truncate">
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
