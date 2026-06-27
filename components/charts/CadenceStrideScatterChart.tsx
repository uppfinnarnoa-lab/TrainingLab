"use client";

import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CadenceScatterPoint } from "@/lib/fitness/secondary-analytics";

interface Props {
  data: CadenceScatterPoint[];
  metric: "spm" | "strideM";
}

const COLORS = { recent: "#6EE7B7", older: "#94A3B8" };
const LABELS = { recent: "Senaste 8 veckorna", older: "8–16 veckor sedan" };

function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (den < 0.01) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, metric }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as CadenceScatterPoint;
  const value = metric === "spm" ? `${d.spm} spm` : `${d.strideM.toFixed(2)} m`;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{formatPace(d.paceSecPerKm)}/km</p>
      <p className="text-muted">{value} — {LABELS[d.period]}</p>
    </div>
  );
}

export function CadenceStrideScatterChart({ data, metric }: Props) {
  if (data.length < 8) {
    return <p className="text-xs text-muted py-4 text-center">Not enough data yet.</p>;
  }

  const recent = data.filter(d => d.period === "recent");
  const older = data.filter(d => d.period === "older");
  const paces = data.map(d => d.paceSecPerKm);
  const minPace = Math.min(...paces), maxPace = Math.max(...paces);

  function trendFor(points: CadenceScatterPoint[]) {
    if (points.length < 5) return [];
    const reg = linearRegression(points.map(p => ({ x: p.paceSecPerKm, y: p[metric] })));
    if (!reg) return [];
    return [
      { paceSecPerKm: minPace, [metric]: reg.slope * minPace + reg.intercept },
      { paceSecPerKm: maxPace, [metric]: reg.slope * maxPace + reg.intercept },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[];
  }
  const recentTrend = trendFor(recent);
  const olderTrend = trendFor(older);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="paceSecPerKm"
          type="number"
          domain={["auto", "auto"]}
          reversed
          tick={{ fontSize: 10, fill: "var(--text-muted)" }}
          tickFormatter={v => `${formatPace(v)}/km`}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          dataKey={metric}
          type="number"
          domain={["auto", "auto"]}
          tick={{ fontSize: 10, fill: "var(--text-muted)" }}
          tickFormatter={v => metric === "spm" ? `${v}` : v.toFixed(2)}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip metric={metric} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => LABELS[v as "recent" | "older"]} />
        <Scatter name="older" data={older} dataKey={metric} fill={COLORS.older} fillOpacity={0.4} isAnimationActive={false} />
        <Scatter name="recent" data={recent} dataKey={metric} fill={COLORS.recent} fillOpacity={0.55} isAnimationActive={false} />
        {olderTrend.length === 2 && (
          <Line data={olderTrend} dataKey={metric} stroke={COLORS.older} strokeWidth={1.5} strokeDasharray="4 3" dot={false} legendType="none" isAnimationActive={false} />
        )}
        {recentTrend.length === 2 && (
          <Line data={recentTrend} dataKey={metric} stroke={COLORS.recent} strokeWidth={2} dot={false} legendType="none" isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
