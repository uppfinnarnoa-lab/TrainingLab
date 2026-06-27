"use client";

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

export interface VO2maxPoint {
  month: string;
  vdot: number;
}

interface Props {
  data: VO2maxPoint[];
}

type Range = "1y" | "2y" | "all";
const RANGES: { value: Range; label: string; months: number | null }[] = [
  { value: "1y",  label: "1Y",  months: 12 },
  { value: "2y",  label: "2Y",  months: 24 },
  { value: "all", label: "All", months: null },
];

function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (den === 0) return null;
  const b = num / den;
  const a = my - b * mx;
  return { a, b };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as VO2maxPoint;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{label}</p>
      <p className="text-accent">VDOT: {d.vdot.toFixed(1)}</p>
    </div>
  );
}

export function VO2maxTrendChart({ data }: Props) {
  const [range, setRange] = useState<Range>("all");

  const rangeFiltered = useMemo(() => {
    const r = RANGES.find(x => x.value === range);
    if (!r?.months) return data;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - r.months);
    const cutoffStr = format(cutoff, "yyyy-MM");
    return data.filter(d => d.month >= cutoffStr);
  }, [data, range]);

  const reg = useMemo(() => {
    const pts = rangeFiltered.map((d, i) => ({ x: i, y: d.vdot }));
    return linearRegression(pts);
  }, [rangeFiltered]);

  const withTrend = useMemo(() =>
    rangeFiltered.map((d, i) => ({
      ...d,
      trendVdot: reg ? reg.a + reg.b * i : undefined,
    })),
    [rangeFiltered, reg]
  );

  if (data.length === 0) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        No data — requires enough race PBs or quality runs per monthly period.
      </p>
    );
  }

  const allVdots = rangeFiltered.map(d => d.vdot);
  const minVdot = Math.min(...allVdots) - 1;
  const maxVdot = Math.max(...allVdots) + 1;
  const improving = reg ? reg.b > 0 : false;

  const availableRanges = RANGES.filter(r => {
    if (!r.months) return true;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - r.months);
    const cutoffStr = format(cutoff, "yyyy-MM");
    return data.some(d => d.month >= cutoffStr);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          {reg && rangeFiltered.length >= 2 && (
            <p className={`text-xs font-medium ${improving ? "text-accent" : "text-orange-400"}`}>
              Trend: {improving ? "+" : ""}{(reg.b * rangeFiltered.length).toFixed(1)} VDOT over the period
            </p>
          )}
          <p className="text-[10px] text-muted mt-0.5">Higher VDOT = better aerobic fitness</p>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-border p-0.5">
          {availableRanges.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded transition-colors",
                range === r.value ? "bg-accent/15 text-accent" : "text-muted hover:text-primary"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {rangeFiltered.length < 3 ? (
        <p className="text-xs text-muted py-4 text-center">
          Not enough data in selected period.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={withTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              tickFormatter={v => { try { return format(parseISO(v + "-01"), "MMM yy"); } catch { return v; } }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minVdot, maxVdot]}
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              tickFormatter={v => v.toFixed(0)}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="vdot"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--accent)" }}
              activeDot={{ r: 5 }}
              name="VDOT"
            />
            {reg && (
              <Line
                type="linear"
                dataKey="trendVdot"
                stroke="var(--muted)"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                name="Trend"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
