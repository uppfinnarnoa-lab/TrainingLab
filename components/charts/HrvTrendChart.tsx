"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
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

function balanceColor(balance: string | null | undefined) {
  if (balance === "Low" || balance === "Unbalanced") return "var(--error)";
  if (balance === "Balanced") return "var(--accent)";
  return "var(--text-muted)";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HrvDot(props: any) {
  const { cx, cy, payload } = props;
  if (payload.hrvNightly == null) return null;
  return <circle cx={cx} cy={cy} r={3} fill={balanceColor(payload.hrvBalance)} stroke="none" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as GarminWellnessPoint;
  if (d.hrvNightly == null) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{format(parseISO(label), "EEE d MMM yyyy")}</p>
      <p style={{ color: balanceColor(d.hrvBalance) }}>HRV: {Math.round(d.hrvNightly)} ms{d.hrvBalance ? ` — ${d.hrvBalance}` : ""}</p>
    </div>
  );
}

export function HrvTrendChart({ data }: Props) {
  const hasData = data.some(d => d.hrvNightly != null);
  if (!hasData) {
    return <p className="text-xs text-muted py-4 text-center">No HRV data yet.</p>;
  }

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
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="hrvNightly" name="HRV (ms)" stroke="var(--text-muted)" strokeWidth={1.5} dot={<HrvDot />} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
