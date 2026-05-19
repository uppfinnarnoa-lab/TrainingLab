"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatDuration } from "@/lib/utils";

const ZONE_COLORS = ["#94A3B8", "#6EE7B7", "#FBBF24", "#F97316", "#EF4444"];
const ZONE_LABELS = ["Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];

interface Props {
  zoneSeconds: Record<string, number>;
}

export function HRZonesChart({ zoneSeconds }: Props) {
  const total = Object.values(zoneSeconds).reduce((s, v) => s + v, 0);

  const data = ["z1", "z2", "z3", "z4", "z5"]
    .map((z, i) => ({
      name: ZONE_LABELS[i],
      value: zoneSeconds[z] ?? 0,
      pct: total > 0 ? Math.round(((zoneSeconds[z] ?? 0) / total) * 100) : 0,
      color: ZONE_COLORS[i],
    }))
    .filter(d => d.value > 0);

  if (data.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No heart rate data in recent activities.</p>;
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={45} outerRadius={72} paddingAngle={2} startAngle={90} endAngle={-270}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
            formatter={(v: number, name: string) => [formatDuration(v), name]}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="flex-1 space-y-1.5">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-xs text-primary flex-1">{d.name}</span>
            <span className="text-xs font-mono text-muted">{formatDuration(d.value)}</span>
            <span className="text-xs font-semibold text-primary w-8 text-right">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
