"use client";

import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { GarminWellnessPoint } from "@/app/(dashboard)/stats/page";

interface Props {
  data: GarminWellnessPoint[];
}

function tickFormatter(date: string, index: number, totalPoints: number) {
  const interval = totalPoints > 70 ? 14 : totalPoints > 30 ? 7 : 3;
  if (index % interval !== 0) return "";
  return format(parseISO(date), "d MMM");
}

export function SleepTrendChart({ data }: Props) {
  const hasData = data.some(d => d.sleepDeepH != null || d.sleepScore != null);
  if (!hasData) {
    return <p className="text-xs text-muted py-4 text-center">No sleep data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v, i) => tickFormatter(v, i, data.length)}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis
          yAxisId="hours"
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          width={32}
          label={{ value: "hours", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-muted)" }}
        />
        <YAxis
          yAxisId="score"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          labelFormatter={(v: string) => format(parseISO(v), "EEE d MMM yyyy")}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Area yAxisId="hours" type="monotone" dataKey="sleepDeepH"  stackId="sleep" name="Deep"  stroke="#4C51BF" fill="#4C51BF" fillOpacity={0.8} />
        <Area yAxisId="hours" type="monotone" dataKey="sleepLightH" stackId="sleep" name="Light" stroke="#60A5FA" fill="#60A5FA" fillOpacity={0.7} />
        <Area yAxisId="hours" type="monotone" dataKey="sleepRemH"   stackId="sleep" name="REM"   stroke="#34D399" fill="#34D399" fillOpacity={0.7} />
        <Area yAxisId="hours" type="monotone" dataKey="sleepAwakeH" stackId="sleep" name="Awake" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.6} />
        <Line yAxisId="score" type="monotone" dataKey="sleepScore" name="Sleep score" stroke="var(--accent)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
