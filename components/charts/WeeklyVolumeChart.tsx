"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import { format, parseISO } from "date-fns";

// Fallback only — used when the sport has no real SportCategory match (sportColors prop).
const SPORT_COLORS: Record<string, string> = {
  "Running":       "#10B981",
  "Orienteering":  "#059669",
  "Cycling":       "#6366F1",
  "Nordic Skiing": "#38BDF8",
  "Roller Skiing": "#0EA5E9",
  "Strength":      "#F87171",
};

interface Props {
  weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>>;
  mode?: "distance" | "time";
  sportColors?: Record<string, string>;
}

export function WeeklyVolumeChart({ weeklyVolumes, mode = "distance", sportColors = {} }: Props) {
  const sports = Array.from(
    new Set(Object.values(weeklyVolumes).flatMap(w => Object.keys(w)))
  ).sort();

  const weeks = Object.keys(weeklyVolumes).sort();
  const data = weeks.map(week => {
    const row: Record<string, number | string> = {
      week: format(parseISO(week), "d MMM"),
    };
    let total = 0;
    for (const sport of sports) {
      const val = mode === "distance"
        ? Math.round((weeklyVolumes[week][sport]?.km ?? 0) * 10) / 10
        : Math.round((weeklyVolumes[week][sport]?.timeSec ?? 0) / 3600 * 10) / 10;
      row[sport] = val;
      total += val;
    }
    row.total = Math.round(total * 10) / 10;
    return row;
  });

  // 4-week rolling average
  const rolling = data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - 3), i + 1);
    const avg = slice.reduce((s, d) => s + (d.total as number), 0) / slice.length;
    return Math.round(avg * 10) / 10;
  });
  const chartData = data.map((d, i) => ({ ...d, rolling: rolling[i] }));

  const yLabel = mode === "distance" ? "km" : "hours";

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} unit={` ${yLabel}`} width={52} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          formatter={(v: number, name: string) => [`${v} ${yLabel}`, name]}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {sports.map(sport => (
          <Bar key={sport} dataKey={sport} stackId="a" fill={sportColors[sport.toLowerCase()] ?? SPORT_COLORS[sport] ?? "#94A3B8"} radius={sports.indexOf(sport) === sports.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        ))}
        <Line dataKey="rolling" type="monotone" stroke="var(--accent-2)" strokeWidth={2} dot={false} name="4-week avg" strokeDasharray="5 3" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
