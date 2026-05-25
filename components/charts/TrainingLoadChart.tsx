"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { DailyLoad } from "@/lib/fitness/training-load";

interface Props {
  curve: DailyLoad[];
}

// Show every 7th label to avoid crowding
function tickFormatter(date: string, index: number) {
  if (index % 7 !== 0) return "";
  return format(parseISO(date), "d MMM");
}

export function TrainingLoadChart({ curve }: Props) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          labelFormatter={(v: string) => format(parseISO(v), "EEE d MMM yyyy")}
          formatter={(v: number, name: string) => [v.toFixed(1), name]}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {/* TSB shading zones */}
        <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
        <Line dataKey="ctl" name="CTL (fitness)" stroke="#6EE7B7" strokeWidth={2} dot={false} />
        <Line dataKey="atl" name="ATL (fatigue)" stroke="#F87171" strokeWidth={2} dot={false} />
        <Line dataKey="tsb" name="TSB (form)" stroke="#818CF8" strokeWidth={1.5} dot={false} strokeDasharray="5 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}
