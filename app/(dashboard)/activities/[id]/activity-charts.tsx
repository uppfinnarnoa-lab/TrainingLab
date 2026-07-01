"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreamPoint {
  distKm: number;
  timeSec: number;
  paceSecKm: number | null;
  paceSmoothSecKm: number | null;
  heartrate: number | null;
  altitude: number | null;
}

type Serie = "pace" | "heartrate" | "altitude";
type XMode = "distance" | "time";
type PaceMode = "raw" | "smoothed";

// Centered moving average over `window` samples — smooths out the
// second-to-second jitter in instant pace without flattening real trends.
function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j];
      if (v != null) { sum += v; count++; }
    }
    return count > 0 ? sum / count : null;
  });
}

const SERIES_CONFIG: Record<Serie, { label: string; color: string }> = {
  pace:      { label: "Pace",       color: "#6EE7B7" },
  heartrate: { label: "Heart rate", color: "#F87171" },
  altitude:  { label: "Elevation",  color: "#818CF8" },
};

function formatPaceStr(secPerKm: number) {
  if (!secPerKm || secPerKm < 60 || secPerKm > 600) return "";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimeAxis(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}m`;
}

export function ActivityCharts({ activityId }: { activityId: string }) {
  const [data, setData]       = useState<StreamPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<"rate_limited" | "daily_limit" | "strava_error" | "no_data" | null>(null);
  const [visible, setVisible] = useState<Set<Serie>>(new Set(["pace", "heartrate"]));
  const [hasAlt, setHasAlt]   = useState(false);
  const [xMode, setXMode]     = useState<XMode>("distance");
  const [paceMode, setPaceMode] = useState<PaceMode>("raw");

  useEffect(() => {
    fetch(`/api/activities/${activityId}/streams`)
      .then(r => r.json())
      .then(raw => {
        if (raw.error) { setError(raw.reason ?? "strava_error"); return; }
        const dist = (raw.distance?.data as number[]) ?? [];
        const time = (raw.time?.data as number[]) ?? [];
        const hr   = (raw.heartrate?.data as number[]) ?? [];
        const vel  = (raw.velocity_smooth?.data as number[]) ?? [];
        const alt  = (raw.altitude?.data as number[]) ?? [];
        if (dist.length === 0) { setError("no_data"); return; }

        const altPresent = alt.some(v => v != null);
        setHasAlt(altPresent);

        const active = new Set<Serie>(["pace"]);
        if (hr.some(v => v > 30)) active.add("heartrate");
        if (altPresent)           active.add("altitude");
        setVisible(active);

        // Smooth velocity (not pace directly — averaging 1/v is skewed) over a
        // ~21-sample window before converting to pace, for the "smoothed" view.
        const smoothVel = movingAverage(vel.map(v => (v && v > 0.5 ? v : null)), 21);

        const step = Math.max(1, Math.floor(dist.length / 400));
        const points: StreamPoint[] = [];
        for (let i = 0; i < dist.length; i += step) {
          const v = vel[i];
          const pace = v && v > 0.5 ? Math.round(1000 / v) : null;
          const sv = smoothVel[i];
          const paceSmooth = sv ? Math.round(1000 / sv) : null;
          points.push({
            distKm:          Math.round(dist[i] / 10) / 100,
            timeSec:         time[i] ?? 0,
            paceSecKm:       pace       && pace       > 60 && pace       < 600 ? pace       : null,
            paceSmoothSecKm: paceSmooth && paceSmooth > 60 && paceSmooth < 600 ? paceSmooth : null,
            heartrate: hr[i] > 30 ? hr[i] : null,
            altitude:  altPresent && alt[i] != null ? Math.round(alt[i]) : null,
          });
        }
        setData(points);
      })
      .catch(() => setError("strava_error"))
      .finally(() => setLoading(false));
  }, [activityId]);

  function toggle(s: Serie) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(s)) { if (next.size > 1) next.delete(s); }
      else next.add(s);
      return next;
    });
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-muted py-6">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">Loading stream data from Strava…</span>
    </div>
  );

  if (error || data.length === 0) {
    const msg = error === "rate_limited" || error === "daily_limit"
      ? "Strava-hastighetsgränsen är tillfälligt nådd — försök igen om en stund."
      : error === "no_data"
      ? "Stream-data saknas för detta pass — kräver GPS-data från Strava."
      : "Kunde inte hämta stream-data från Strava just nu.";
    return <p className="text-sm text-muted py-4">{msg}</p>;
  }

  const xKey = xMode === "distance" ? "distKm" : "timeSec";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const xLabel = xMode === "distance" ? `${label} km` : formatTimeAxis(label);
    return (
      <div className="bg-surface border border-border rounded-xl px-3 py-2 text-xs shadow-xl space-y-1">
        <p className="font-semibold text-muted">{xLabel}</p>
        {payload.map((p: { dataKey: string; value: number; color: string }) => {
          let display = "";
          if (p.dataKey === "paceSecKm" || p.dataKey === "paceSmoothSecKm") display = formatPaceStr(p.value) + "/km";
          if (p.dataKey === "heartrate") display = `${p.value} bpm`;
          if (p.dataKey === "altitude")  display = `${p.value} m`;
          if (!display) return null;
          return <p key={p.dataKey} style={{ color: p.color }} className="font-mono">{display}</p>;
        })}
      </div>
    );
  };

  const visibleSeries = (Object.keys(SERIES_CONFIG) as Serie[])
    .filter(s => s !== "altitude" || hasAlt);

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        {/* Series toggles */}
        <div className="flex flex-wrap gap-2">
          {visibleSeries.map(s => {
            const cfg = SERIES_CONFIG[s];
            const on  = visible.has(s);
            return (
              <button key={s} onClick={() => toggle(s)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all",
                  on ? "border-transparent" : "border-border text-muted hover:text-primary"
                )}
                style={on ? { backgroundColor: `${cfg.color}25`, color: cfg.color, borderColor: `${cfg.color}60` } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                {cfg.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pace smoothing toggle */}
          {visible.has("pace") && (
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
              <button
                onClick={() => setPaceMode("raw")}
                className={cn("px-2.5 py-1 rounded-md transition-colors font-medium",
                  paceMode === "raw" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
              >
                Raw pace
              </button>
              <button
                onClick={() => setPaceMode("smoothed")}
                className={cn("px-2.5 py-1 rounded-md transition-colors font-medium",
                  paceMode === "smoothed" ? "bg-accent/15 text-accent" : "text-muted hover:text-primary")}
              >
                Smoothed
              </button>
            </div>
          )}
          {/* X-axis toggle */}
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
      </div>

      {/* Overlaid chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickFormatter={xMode === "distance" ? v => `${v}km` : formatTimeAxis}
            axisLine={false} tickLine={false} minTickGap={48} />

          {visible.has("pace") && (
            <YAxis yAxisId="pace" orientation="left" reversed
              tick={{ fontSize: 10, fill: "#6EE7B7", fontFamily: "monospace" }}
              tickFormatter={v => formatPaceStr(v)}
              axisLine={false} tickLine={false} width={44}
              domain={["dataMin - 15", "dataMax + 15"]} />
          )}

          {visible.has("heartrate") && (
            <YAxis yAxisId="hr"
              orientation={visible.has("pace") ? "right" : "left"}
              tick={{ fontSize: 10, fill: "#F87171" }}
              axisLine={false} tickLine={false} width={34}
              domain={["dataMin - 5", "dataMax + 5"]} />
          )}

          {visible.has("altitude") && hasAlt && (
            <YAxis yAxisId="alt" hide domain={["dataMin - 5", "dataMax + 20"]} />
          )}

          <Tooltip content={<CustomTooltip />} />

          {visible.has("altitude") && hasAlt && (
            <Area yAxisId="alt" type="monotone" dataKey="altitude"
              stroke="none" fill="#818CF8" fillOpacity={0.12}
              dot={false} connectNulls isAnimationActive={false} />
          )}

          {visible.has("pace") && (
            <Line yAxisId="pace" type="monotone" dataKey={paceMode === "smoothed" ? "paceSmoothSecKm" : "paceSecKm"}
              stroke="#6EE7B7" strokeWidth={1.8} dot={false} connectNulls
              isAnimationActive={false} />
          )}

          {visible.has("heartrate") && (
            <Line yAxisId="hr" type="monotone" dataKey="heartrate"
              stroke="#F87171" strokeWidth={1.8} dot={false} connectNulls
              isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
