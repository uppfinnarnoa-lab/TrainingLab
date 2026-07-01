"use client";

import { ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface ChatChartSpec {
  type: "line" | "bar";
  xLabel?: string;
  series: { name: string; data: { x: string | number; y: number }[] }[];
}

const COLORS = ["#6EE7B7", "#F87171", "#818CF8", "#FBBF24"];

export function ChatChart({ spec }: { spec: ChatChartSpec }) {
  const xValues = spec.series[0]?.data.map(d => d.x) ?? [];
  const merged = xValues.map((x, i) => {
    const row: Record<string, string | number> = { x };
    spec.series.forEach(s => { row[s.name] = s.data[i]?.y; });
    return row;
  });
  const Chart = spec.type === "bar" ? BarChart : LineChart;
  return (
    <div className="rounded-xl bg-surface-2 border border-border p-3" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} />
          <Tooltip />
          {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {spec.series.map((s, i) => spec.type === "bar"
            ? <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            : <Line key={s.name} dataKey={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function tryParseChatChart(jsonText: string): ChatChartSpec | null {
  try {
    const parsed = JSON.parse(jsonText) as ChatChartSpec;
    if (parsed.type && Array.isArray(parsed.series)) return parsed;
    return null;
  } catch {
    return null;
  }
}
