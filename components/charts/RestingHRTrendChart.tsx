"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
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

export function RestingHRTrendChart({ data }: Props) {
  const values = data.map(d => d.restingHR).filter((v): v is number => v != null);
  if (values.length === 0) {
    return <p className="text-xs text-muted py-4 text-center">No resting heart rate data yet.</p>;
  }
  const baseline = Math.round(values.reduce((s, v) => s + v, 0) / values.length);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v, i) => tickFormatter(v, i, data.length)}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          labelFormatter={(v: string) => format(parseISO(v), "EEE d MMM yyyy")}
          formatter={(v: number) => [`${v} bpm`, "Resting HR"]}
        />
        <ReferenceLine y={baseline} stroke="var(--text-muted)" strokeDasharray="5 3" label={{ value: `avg ${baseline}`, fontSize: 10, fill: "var(--text-muted)", position: "insideTopLeft" }} />
        <Line type="monotone" dataKey="restingHR" name="Resting HR" stroke="#60A5FA" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
