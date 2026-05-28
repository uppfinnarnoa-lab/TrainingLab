"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";

interface DataPoint {
  month: string;
  lt1HR: number;
  lt2HR: number;
  maxHR: number;
}

interface Props {
  data: DataPoint[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value} bpm</p>
      ))}
    </div>
  );
}

export function HRZoneHistoryChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        No data — requires ≥ 40 runs per 6-month window.
      </p>
    );
  }

  const allHR = data.flatMap(d => [d.lt1HR, d.lt2HR, d.maxHR]);
  const minHR = Math.floor(Math.min(...allHR) / 5) * 5 - 5;
  const maxHRVal = Math.ceil(Math.max(...allHR) / 5) * 5 + 5;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "var(--text-primary)" }}
          tickFormatter={v => { try { return format(parseISO(v + "-01"), "MMM yy"); } catch { return v; } }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minHR, maxHRVal]}
          tick={{ fontSize: 10, fill: "var(--text-primary)" }}
          tickFormatter={v => `${v}`}
          width={32}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
        <Line
          type="monotone"
          dataKey="lt1HR"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--accent)" }}
          activeDot={{ r: 5 }}
          name="LT1 HR"
        />
        <Line
          type="monotone"
          dataKey="lt2HR"
          stroke="var(--warning)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--warning)" }}
          activeDot={{ r: 5 }}
          name="LT2 HR"
        />
        <Line
          type="monotone"
          dataKey="maxHR"
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          name="Max HR"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
