"use client";

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { format, parseISO, addMonths } from "date-fns";
import { cn } from "@/lib/utils";

export interface LTPacePoint {
  month: string;
  lt1PaceSecPerKm: number;
  lt2PaceSecPerKm: number;
  r2: number;
}

interface Props {
  data: LTPacePoint[];
  currentLT1?: number; // currently calibrated LT1 pace (sec/km) for reference line
  currentLT2?: number; // currently calibrated LT2 pace (sec/km) for reference line
}

// Match planner zone colors: LT2 = zone 4 (orange), LT1 = zone 3 (amber)
const LT2_COLOR = "#F97316";
const LT1_COLOR = "#FBBF24";

type Range = "1y" | "2y" | "all";
const RANGES: { value: Range; label: string; months: number | null }[] = [
  { value: "1y",  label: "1Y",  months: 12 },
  { value: "2y",  label: "2Y",  months: 24 },
  { value: "all", label: "All", months: null },
];

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function linearRegressionSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  const num = ys.reduce((s, v, i) => s + (i - mx) * (v - my), 0);
  const den = ys.reduce((s, _, i) => s + (i - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as LTPacePoint & { projected?: boolean };
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="font-semibold text-primary">{label}{d.projected ? " (prognos)" : ""}</p>
      <p style={{ color: LT2_COLOR }}>LT2: {formatPace(d.lt2PaceSecPerKm)}/km</p>
      <p style={{ color: LT1_COLOR }}>LT1: {formatPace(d.lt1PaceSecPerKm)}/km</p>
      {!d.projected && <p className="text-muted">R²: {d.r2.toFixed(2)}</p>}
    </div>
  );
}

export function LTPaceTrendChart({ data, currentLT1, currentLT2 }: Props) {
  const [range, setRange] = useState<Range>("all");

  const rangeFiltered = useMemo(() => {
    const r = RANGES.find(x => x.value === range);
    if (!r?.months) return data;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - r.months);
    const cutoffStr = format(cutoff, "yyyy-MM");
    return data.filter(d => d.month >= cutoffStr);
  }, [data, range]);

  // 3-month forward projection from the last 6 data points
  const projected = useMemo(() => {
    const recent = rangeFiltered.slice(-6);
    if (recent.length < 3) return [];
    const slope1 = linearRegressionSlope(recent.map(p => p.lt1PaceSecPerKm));
    const slope2 = linearRegressionSlope(recent.map(p => p.lt2PaceSecPerKm));
    const last = recent[recent.length - 1];
    const lastDate = parseISO(last.month + "-01");
    return [1, 2, 3].map(m => ({
      month: format(addMonths(lastDate, m), "yyyy-MM"),
      lt1PaceSecPerKm: Math.round(last.lt1PaceSecPerKm + slope1 * m),
      lt2PaceSecPerKm: Math.round(last.lt2PaceSecPerKm + slope2 * m),
      r2: 0,
      projected: true,
    }));
  }, [rangeFiltered]);

  const allPoints = useMemo(() => [...rangeFiltered, ...projected], [rangeFiltered, projected]);

  if (data.length === 0) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        Ingen data — kräver tillräckligt med laps per månadsruta.
      </p>
    );
  }

  const allPaces = allPoints.flatMap(p => [p.lt1PaceSecPerKm, p.lt2PaceSecPerKm]);
  if (currentLT1) allPaces.push(currentLT1);
  if (currentLT2) allPaces.push(currentLT2);
  const minPace = Math.min(...allPaces) - 5;
  const maxPace = Math.max(...allPaces) + 5;

  const lastReal = rangeFiltered.at(-1);
  const improving = projected.length >= 2 &&
    projected[projected.length - 1].lt2PaceSecPerKm < (lastReal?.lt2PaceSecPerKm ?? Infinity);

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
          {lastReal && (
            <p className="text-xs text-muted">
              LT2: <span className="font-mono" style={{ color: LT2_COLOR }}>{formatPace(lastReal.lt2PaceSecPerKm)}/km</span>
              {" · "}
              LT1: <span className="font-mono" style={{ color: LT1_COLOR }}>{formatPace(lastReal.lt1PaceSecPerKm)}/km</span>
              {" · "}
              <span className="text-muted">R²: {lastReal.r2.toFixed(2)}</span>
            </p>
          )}
          {projected.length >= 2 && (
            <p className={`text-[10px] mt-0.5 ${improving ? "text-accent" : "text-orange-400"}`}>
              3-månadersprognos: {improving ? "förbättring" : "platå/försämring"}
            </p>
          )}
          <p className="text-[10px] text-muted mt-0.5">
            Rullande 90-dagarsfönster · lägre sek/km = snabbare · streckad = prognos
          </p>
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
          För lite data i valt tidsintervall.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={allPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              tickFormatter={v => { try { return format(parseISO(v + "-01"), "MMM yy"); } catch { return v; } }}
              interval="preserveStartEnd"
            />
            {/* Y-axis inverted: faster pace (lower sec/km) appears higher */}
            <YAxis
              domain={[minPace, maxPace]}
              reversed
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              tickFormatter={v => formatPace(v)}
              width={42}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Reference lines for currently calibrated zones */}
            {currentLT2 && (
              <ReferenceLine y={currentLT2} stroke={LT2_COLOR} strokeDasharray="4 4" strokeOpacity={0.4}
                label={{ value: "Kal LT2", position: "insideTopRight", fontSize: 9, fill: LT2_COLOR }} />
            )}
            {currentLT1 && (
              <ReferenceLine y={currentLT1} stroke={LT1_COLOR} strokeDasharray="4 4" strokeOpacity={0.4}
                label={{ value: "Kal LT1", position: "insideTopRight", fontSize: 9, fill: LT1_COLOR }} />
            )}

            {/* LT2 — solid line, orange (zone 4) */}
            <Line
              type="monotone"
              dataKey="lt2PaceSecPerKm"
              stroke={LT2_COLOR}
              strokeWidth={2}
              dot={(props) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { cx, cy, payload } = props as any;
                if (payload.projected) return <g key={`lt2-${cx}`} />;
                return <circle key={`lt2-${cx}`} cx={cx} cy={cy} r={3} fill={LT2_COLOR} stroke="none" />;
              }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              name="LT2"
            />
            {/* LT1 — dashed line, amber (zone 3) */}
            <Line
              type="monotone"
              dataKey="lt1PaceSecPerKm"
              stroke={LT1_COLOR}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={(props) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { cx, cy, payload } = props as any;
                if (payload.projected) return <g key={`lt1-${cx}`} />;
                return <circle key={`lt1-${cx}`} cx={cx} cy={cy} r={2.5} fill={LT1_COLOR} stroke="none" />;
              }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              name="LT1"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
