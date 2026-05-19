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
  paceSecKm: number | null;
  heartrate: number | null;
  altitude: number | null;
}

type Serie = "pace" | "heartrate" | "altitude";

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

export function ActivityCharts({ activityId }: { activityId: string }) {
  const [data, setData]       = useState<StreamPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [visible, setVisible] = useState<Set<Serie>>(new Set(["pace", "heartrate"]));
  const [hasAlt, setHasAlt]   = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${activityId}/streams`)
      .then(r => r.json())
      .then(raw => {
        if (raw.error) { setError(true); return; }
        const dist = (raw.distance?.data as number[]) ?? [];
        const hr   = (raw.heartrate?.data as number[]) ?? [];
        const vel  = (raw.velocity_smooth?.data as number[]) ?? [];
        const alt  = (raw.altitude?.data as number[]) ?? [];
        if (dist.length === 0) { setError(true); return; }

        const altPresent = alt.some(v => v != null);
        setHasAlt(altPresent);

        const active = new Set<Serie>(["pace"]);
        if (hr.some(v => v > 30)) active.add("heartrate");
        if (altPresent)           active.add("altitude");
        setVisible(active);

        const step = Math.max(1, Math.floor(dist.length / 400));
        const points: StreamPoint[] = [];
        for (let i = 0; i < dist.length; i += step) {
          const v = vel[i];
          const pace = v && v > 0.5 ? Math.round(1000 / v) : null;
          points.push({
            distKm:    Math.round(dist[i] / 10) / 100,
            paceSecKm: pace && pace > 60 && pace < 600 ? pace : null,
            heartrate: hr[i] > 30 ? hr[i] : null,
            altitude:  altPresent && alt[i] != null ? Math.round(alt[i]) : null,
          });
        }
        setData(points);
      })
      .catch(() => setError(true))
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

  if (error || data.length === 0) return (
    <p className="text-sm text-muted py-4">
      Stream data not available — requires Strava connection and GPS data.
    </p>
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-surface border border-border rounded-xl px-3 py-2 text-xs shadow-xl space-y-1">
        <p className="font-semibold text-muted">{label} km</p>
        {payload.map((p: { dataKey: string; value: number; color: string }) => {
          let display = "";
          if (p.dataKey === "paceSecKm") display = formatPaceStr(p.value) + "/km";
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

      {/* Overlaid chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="distKm" tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickFormatter={v => `${v}km`} axisLine={false} tickLine={false} />

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

          {/* Elevation as shaded area behind the lines */}
          {visible.has("altitude") && hasAlt && (
            <Area yAxisId="alt" type="monotone" dataKey="altitude"
              stroke="none" fill="#818CF8" fillOpacity={0.12}
              dot={false} connectNulls isAnimationActive={false} />
          )}

          {visible.has("pace") && (
            <Line yAxisId="pace" type="monotone" dataKey="paceSecKm"
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
