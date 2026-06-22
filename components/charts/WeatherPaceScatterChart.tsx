"use client";

import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { WeatherScatterPoint } from "@/app/(dashboard)/stats/page";

interface Props {
  data: WeatherScatterPoint[];
  xLabel: string;     // e.g. "Temperatur (°C)"
  xUnit: string;       // e.g. "°C"
  color: string;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, xUnit }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as WeatherScatterPoint;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{d.x}{xUnit}</p>
      <p className="text-muted">{d.paceDeltaSec > 0 ? "+" : ""}{d.paceDeltaSec}s/km vs median</p>
    </div>
  );
}

export function WeatherPaceScatterChart({ data, xLabel, xUnit, color }: Props) {
  if (data.length < 8) {
    return <p className="text-xs text-muted py-4 text-center">Not enough data yet.</p>;
  }

  const reg = linearRegression(data.map(p => ({ x: p.x, y: p.paceDeltaSec })));
  const xs = data.map(p => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const trendLine = reg
    ? [{ x: minX, y: reg.slope * minX + reg.intercept }, { x: maxX, y: reg.slope * maxX + reg.intercept }]
    : [];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted uppercase tracking-wide">{xLabel} vs. relativt tempo</p>
        {reg && (
          <p className="text-[10px] text-muted">
            {reg.slope > 0 ? "+" : ""}{(reg.slope * 5).toFixed(1)}s/km per 5{xUnit}
          </p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickFormatter={v => `${v}${xUnit}`}
            axisLine={false}
            tickLine={false}
          />
          {/* Reversed: faster (negative delta) appears higher, matching other pace charts */}
          <YAxis
            dataKey="paceDeltaSec"
            type="number"
            domain={["auto", "auto"]}
            reversed
            tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickFormatter={v => `${v > 0 ? "+" : ""}${v}s`}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip content={<CustomTooltip xUnit={xUnit} />} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Scatter data={data} dataKey="paceDeltaSec" fill={color} fillOpacity={0.45} isAnimationActive={false} />
          {trendLine.length === 2 && (
            <Line data={trendLine} dataKey="y" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
