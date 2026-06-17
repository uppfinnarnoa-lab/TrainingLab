"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
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

export function GarminWellnessChart({ data }: Props) {
  const hasData = data.some(d => d.bodyBattery != null || d.stressAvg != null || d.trainingReadiness != null);
  if (!hasData) {
    return <p className="text-xs text-muted py-4 text-center">No Body Battery / stress / readiness data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
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
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          labelFormatter={(v: string) => format(parseISO(v), "EEE d MMM yyyy")}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="bodyBattery"       name="Body Battery" stroke="#34D399" strokeWidth={2}   dot={false} connectNulls />
        <Line type="monotone" dataKey="stressAvg"         name="Stress"       stroke="var(--error)" strokeWidth={1.5} dot={false} connectNulls />
        <Line type="monotone" dataKey="trainingReadiness" name="Readiness"    stroke="#818CF8" strokeWidth={1.5} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
