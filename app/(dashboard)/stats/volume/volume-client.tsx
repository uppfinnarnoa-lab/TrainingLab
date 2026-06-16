"use client";

import { useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type VolumeRecord = {
  year: number;
  month: number;
  sport: string;
  km: number;
  timeSec: number;
};

export type WeeklyRecord = {
  weekStart: string;  // "YYYY-MM-DD" Monday
  year: number;
  isoWeek: number;    // 1–53
  sport: string;
  km: number;
  timeSec: number;
};

interface Props {
  records: VolumeRecord[];
  weeklyRecords: WeeklyRecord[];
  sports: string[];
  availableYears: number[];
}

type ViewMode = "yearly" | "cumulative" | "sports" | "period" | "weekly";
type Metric = "distance" | "time";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEAR_COLORS = ["#818CF8","#6EE7B7","#F472B6","#FBBF24","#60A5FA","#F87171"];
const SPORT_COLORS: Record<string, string> = {
  Running: "#6EE7B7",
  Orienteering: "#F472B6",
  Cycling: "#FBBF24",
  Skiing: "#60A5FA",
  "Roller Skiing": "#A78BFA",
  Strength: "#F97316",
};

function yearColor(year: number, availableYears: number[]): string {
  return YEAR_COLORS[availableYears.indexOf(year) % YEAR_COLORS.length];
}

function fmtVal(v: number, metric: Metric): string {
  if (metric === "time") {
    const h = Math.floor(v);
    const m = Math.round((v - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(v)} km`;
}

function fmtShort(v: number, metric: Metric): string {
  return metric === "time" ? `${v.toFixed(1)}h` : `${Math.round(v)} km`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  metric: Metric;
  compareMode?: boolean;
}

function ChartTooltip({ active, payload, label, metric }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const vals = sorted.map(p => p.value ?? 0).filter(v => v > 0);
  const delta = vals.length >= 2
    ? Math.round(((vals[0] - vals[vals.length - 1]) / vals[vals.length - 1]) * 100)
    : null;
  return (
    <div className="rounded-xl border border-border bg-surface shadow-lg px-3 py-2 space-y-1 text-xs">
      <p className="font-semibold text-primary">{label}</p>
      {sorted.map(p => p.value != null && p.value > 0 ? (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-mono font-semibold text-primary">{fmtShort(p.value, metric)}</span>
        </div>
      ) : null)}
      {delta !== null && (
        <p className="text-muted pt-0.5 border-t border-border">
          Δ <span style={{ color: delta >= 0 ? "#6EE7B7" : "#F87171" }}>{delta >= 0 ? "+" : ""}{delta}%</span>
        </p>
      )}
    </div>
  );
}

export function VolumeClient({ records, weeklyRecords, sports, availableYears }: Props) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [viewMode, setViewMode] = useState<ViewMode>("yearly");
  const [metric, setMetric] = useState<Metric>("distance");
  const [selectedYears, setSelectedYears] = useState<number[]>(availableYears.slice(-3));
  const [singleYear, setSingleYear] = useState<number>(availableYears.at(-2) ?? currentYear);
  const [monthFrom, setMonthFrom] = useState(1);
  const [monthTo, setMonthTo] = useState(12);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [periodA, setPeriodA] = useState({ start: `${currentYear - 1}-01`, end: `${currentYear - 1}-12` });
  const [periodB, setPeriodB] = useState({ start: `${currentYear}-01`, end: `${currentYear}-${String(currentMonth).padStart(2, "0")}` });

  // Weekly mode state
  const [weeklySubMode, setWeeklySubMode] = useState<"timeline" | "seasonal">("timeline");
  const [weekRangeFrom, setWeekRangeFrom] = useState(`${currentYear - 1}-${String(currentMonth).padStart(2, "0")}`);
  const [weekRangeTo, setWeekRangeTo] = useState(`${currentYear}-${String(currentMonth).padStart(2, "0")}`);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getValue = (r: { km: number; timeSec: number }) =>
    metric === "time" ? r.timeSec / 3600 : r.km;

  const sportList = selectedSports.length > 0 ? selectedSports : sports;

  const monthVal = (year: number, month: number) =>
    records
      .filter(r => r.year === year && r.month === month && sportList.includes(r.sport))
      .reduce((s, r) => s + getValue(r), 0);

  // Approximate current ISO week (day-of-year ÷ 7, capped at 52)
  const currentIsoWeek = Math.min(52, Math.ceil(
    (new Date(currentYear, currentMonth - 1, new Date().getDate()).getTime() -
     new Date(currentYear, 0, 1).getTime()) / 604800000 + 1
  ));

  // When the current year is selected, cap all years at the current month so
  // comparisons are fair (Jan–May 2026 vs Jan–May 2024, not Jan–May vs full year)
  const yearlyYtdMode = selectedYears.includes(currentYear);
  const effectiveMonthTo = yearlyYtdMode ? Math.min(monthTo, currentMonth) : monthTo;

  // ── Yearly chart data ──────────────────────────────────────────────────────
  const yearlyData = useMemo(() => {
    const months = Array.from({ length: effectiveMonthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    return months.map(m => {
      const entry: Record<string, number | string> = { month: MONTHS[m - 1] };
      for (const yr of selectedYears) {
        entry[String(yr)] = Math.round(monthVal(yr, m) * 10) / 10;
      }
      return entry;
    });
  }, [records, selectedYears, monthFrom, effectiveMonthTo, metric, selectedSports]);

  const yearlySummaries = useMemo(() => selectedYears.map(yr => {
    const months = Array.from({ length: effectiveMonthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    const vals = months.map(m => monthVal(yr, m));
    const total = vals.reduce((s, v) => s + v, 0);
    const avg = months.length > 0 ? total / months.length : 0;
    const bestIdx = vals.indexOf(Math.max(...vals));
    return {
      year: yr,
      total,
      avg,
      bestMonth: MONTHS[monthFrom + bestIdx - 1],
      color: yearColor(yr, availableYears),
    };
  }), [records, selectedYears, monthFrom, effectiveMonthTo, metric, selectedSports]);

  const avgLine = useMemo(() => {
    if (yearlySummaries.length === 0) return null;
    return yearlySummaries.reduce((s, y) => s + y.avg, 0) / yearlySummaries.length;
  }, [yearlySummaries]);

  // ── Cumulative chart data ──────────────────────────────────────────────────
  const cumulativeData = useMemo(() => {
    return MONTHS.map((name, i) => {
      const m = i + 1;
      const entry: Record<string, number | string | null> = { month: name };
      for (const yr of selectedYears) {
        if (yr === currentYear && m > currentMonth) {
          entry[String(yr)] = null;
        } else {
          entry[String(yr)] = Math.round(
            Array.from({ length: m }, (_, j) => monthVal(yr, j + 1)).reduce((s, v) => s + v, 0) * 10
          ) / 10;
        }
      }
      return entry;
    });
  }, [records, selectedYears, metric, selectedSports, currentYear, currentMonth]);

  // ── Sports breakdown chart data ────────────────────────────────────────────
  const sportsData = useMemo(() => {
    const months = Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    return months.map(m => {
      const entry: Record<string, number | string> = { month: MONTHS[m - 1] };
      for (const s of sportList) {
        const v = records.filter(r => r.year === singleYear && r.month === m && r.sport === s)
          .reduce((sum, r) => sum + getValue(r), 0);
        entry[s] = Math.round(v * 10) / 10;
      }
      return entry;
    });
  }, [records, singleYear, sportList, monthFrom, monthTo, metric]);

  const sportsSummary = useMemo(() => {
    const months = Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    const result = sportList.map(s => {
      const total = months.reduce((sum, m) =>
        sum + records.filter(r => r.year === singleYear && r.month === m && r.sport === s)
          .reduce((ss, r) => ss + getValue(r), 0), 0);
      return { sport: s, total, color: SPORT_COLORS[s] ?? "#94A3B8" };
    }).filter(s => s.total > 0.1).sort((a, b) => b.total - a.total);
    const grandTotal = result.reduce((s, r) => s + r.total, 0);
    return result.map(r => ({ ...r, pct: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0 }));
  }, [records, singleYear, sportList, monthFrom, monthTo, metric]);

  // ── Period comparison ──────────────────────────────────────────────────────
  const parseYM = (s: string) => { const [y, m] = s.split("-").map(Number); return { y, m }; };
  const periodMonths = (start: { y: number; m: number }, end: { y: number; m: number }) => {
    const out: { year: number; month: number }[] = [];
    let { y, m } = start;
    while (y < end.y || (y === end.y && m <= end.m)) {
      out.push({ year: y, month: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };

  // Auto-label: "2025" for full year, "Jan–Jun 2025" for partial, "Jan 2024 – Jun 2025" for multi-year
  const periodLabel = (start: string, end: string): string => {
    const [sy, sm] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    if (sy === ey) return sm === 1 && em === 12 ? String(sy) : `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${sy}`;
    return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
  };
  const labelA = periodLabel(periodA.start, periodA.end);
  const labelB = periodLabel(periodB.start, periodB.end);

  // YTD equalization: when comparing periods of different lengths, trim both to the shorter one.
  // This prevents the common misleading case of comparing a full year vs a partial current year.
  const currentYM = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const countMonths = (start: string, end: string) => periodMonths(parseYM(start), parseYM(end)).length;
  const aLen = countMonths(periodA.start, periodA.end);
  const bLen = countMonths(periodB.start, periodB.end);
  const ytdEqualized = aLen !== bLen;
  const compareLen = Math.min(aLen, bLen);
  const trimmed = (start: string) => {
    const ms = periodMonths(parseYM(start), { y: 9999, m: 12 }).slice(0, compareLen);
    return ms;
  };

  const periodData = useMemo(() => {
    const aM = trimmed(periodA.start);
    const bM = trimmed(periodB.start);
    const len = Math.max(aM.length, bM.length);
    return Array.from({ length: len }, (_, i) => {
      const am = aM[i], bm = bM[i];
      const entry: Record<string, number | string> = {
        month: am ? MONTHS[am.month - 1] : (bm ? MONTHS[bm.month - 1] : String(i + 1)),
      };
      if (am) entry[labelA] = Math.round(monthVal(am.year, am.month) * 10) / 10;
      if (bm) entry[labelB] = Math.round(monthVal(bm.year, bm.month) * 10) / 10;
      return entry;
    });
  }, [records, periodA, periodB, metric, selectedSports, compareLen]);

  const periodSummaries = useMemo(() => {
    const aM = trimmed(periodA.start);
    const bM = trimmed(periodB.start);
    const periodKm = (months: { year: number; month: number }[]) =>
      months.reduce((s, { year, month }) =>
        s + records.filter(r => r.year === year && r.month === month && sportList.includes(r.sport))
          .reduce((ss, r) => ss + r.km, 0), 0);
    const periodSessions = (months: { year: number; month: number }[]) =>
      months.reduce((s, { year, month }) =>
        s + records.filter(r => r.year === year && r.month === month && sportList.includes(r.sport)).length, 0);
    return [
      {
        label: labelA,
        total: aM.reduce((s, { year, month }) => s + monthVal(year, month), 0),
        color: YEAR_COLORS[0],
        km: periodKm(aM),
        sessions: periodSessions(aM),
        tss: 0,
      },
      {
        label: labelB,
        total: bM.reduce((s, { year, month }) => s + monthVal(year, month), 0),
        color: YEAR_COLORS[1],
        km: periodKm(bM),
        sessions: periodSessions(bM),
        tss: 0,
      },
    ];
  }, [records, periodA, periodB, metric, selectedSports, compareLen]);

  // ── Weekly data ────────────────────────────────────────────────────────────
  const getWValue = (r: WeeklyRecord) => metric === "time" ? r.timeSec / 3600 : r.km;
  const sportListW = selectedSports.length > 0 ? selectedSports : sports;

  const weeklyTimelineData = useMemo(() => {
    const fromD = new Date(weekRangeFrom + "-01");
    const toD   = new Date(weekRangeTo + "-01");
    toD.setMonth(toD.getMonth() + 1);
    const byWeek = new Map<string, Record<string, number>>();
    for (const r of weeklyRecords) {
      const d = new Date(r.weekStart + "T12:00:00Z");
      if (d < fromD || d >= toD) continue;
      if (!sportListW.includes(r.sport)) continue;
      if (!byWeek.has(r.weekStart)) byWeek.set(r.weekStart, {});
      const e = byWeek.get(r.weekStart)!;
      e[r.sport] = (e[r.sport] ?? 0) + getWValue(r);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ws, sports]) => {
      const d = new Date(ws + "T12:00:00Z");
      const lbl = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const total = Object.values(sports).reduce((s, v) => s + v, 0);
      return { week: lbl, total: Math.round(total * 10) / 10, ...Object.fromEntries(Object.entries(sports).map(([s, v]) => [s, Math.round(v * 10) / 10])) };
    });
  }, [weeklyRecords, weekRangeFrom, weekRangeTo, metric, selectedSports, sports]);

  // Seasonal: align week 1-52 across selected years.
  // Cap at currentIsoWeek only when comparing with the current year.
  const weeklySeasonalYtdMode = selectedYears.includes(currentYear);
  const weekCap = weeklySeasonalYtdMode ? currentIsoWeek : 52;

  const weeklySeasonalData = useMemo(() => {
    return Array.from({ length: weekCap }, (_, i) => {
      const wn = i + 1;
      const entry: Record<string, number | string> = { week: `W${wn}` };
      for (const yr of selectedYears) {
        const total = weeklyRecords
          .filter(r => r.year === yr && r.isoWeek === wn && sportListW.includes(r.sport))
          .reduce((s, r) => s + getWValue(r), 0);
        entry[String(yr)] = Math.round(total * 10) / 10;
      }
      return entry;
    });
  }, [weeklyRecords, selectedYears, metric, selectedSports, sports, weekCap]);

  const weeklyTimelineSummary = useMemo(() => {
    const total = weeklyTimelineData.reduce((s, d) => s + (d.total as number), 0);
    const avg = weeklyTimelineData.length > 0 ? total / weeklyTimelineData.length : 0;
    const peak = weeklyTimelineData.reduce((mx, d) => Math.max(mx, d.total as number), 0);
    return { total, avg, peak, weeks: weeklyTimelineData.length };
  }, [weeklyTimelineData]);

  // ── Shared controls ────────────────────────────────────────────────────────
  const toggleYear = (yr: number) =>
    setSelectedYears(prev => prev.includes(yr) ? prev.filter(y => y !== yr) : [...prev, yr].sort());

  const MODES: { id: ViewMode; label: string }[] = [
    { id: "yearly",     label: "Year vs Year" },
    { id: "cumulative", label: "Cumulative" },
    { id: "weekly",     label: "Weekly" },
    { id: "sports",     label: "Sports" },
    { id: "period",     label: "Periods" },
  ];

  const tickFmt = (v: number) => metric === "time" ? `${v}h` : `${v} km`;

  const sharedSportFilter = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-muted uppercase tracking-wide">Sport</span>
      <button onClick={() => setSelectedSports([])}
        className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
          selectedSports.length === 0 ? "bg-accent/10 text-accent border-accent/20" : "border-border text-muted hover:text-primary")}>
        All
      </button>
      {sports.map(s => (
        <button key={s} onClick={() => setSelectedSports(prev =>
          prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
          className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
            selectedSports.includes(s) ? "bg-accent/10 text-accent border-accent/20" : "border-border text-muted hover:text-primary")}>
          {s}
        </button>
      ))}
    </div>
  );

  const monthRangeFilter = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-muted uppercase tracking-wide">Month range</span>
      <select value={monthFrom} onChange={e => setMonthFrom(Number(e.target.value))}
        className="text-xs rounded-lg border border-border bg-surface px-2 py-1 text-primary">
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <span className="text-xs text-muted">–</span>
      <select value={monthTo} onChange={e => setMonthTo(Number(e.target.value))}
        className="text-xs rounded-lg border border-border bg-surface px-2 py-1 text-primary">
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
    </div>
  );

  const metricToggle = (
    <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs w-fit">
      {(["distance", "time"] as Metric[]).map(m => (
        <button key={m} onClick={() => setMetric(m)}
          className={cn("px-3 py-1 rounded-md transition-colors",
            metric === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary")}>
          {m === "distance" ? "Km" : "Time"}
        </button>
      ))}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/stats" className="text-sm text-muted hover:text-primary transition-colors">
            ← Stats
          </Link>
          <h1 className="text-xl font-semibold text-primary">Volume Explorer</h1>
          <div className="ml-auto">{metricToggle}</div>
        </div>

        {/* View mode tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto overflow-y-hidden">
          {MODES.map(({ id, label }) => (
            <button key={id} onClick={() => setViewMode(id)}
              className={cn("shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                viewMode === id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-primary")}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Year comparison ─────────────────────────────────────────────── */}
        {viewMode === "yearly" && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wide">Year</span>
                {availableYears.map(yr => (
                  <button key={yr} onClick={() => toggleYear(yr)}
                    className={cn("px-3 py-1 rounded-lg text-sm font-medium border transition-colors",
                      selectedYears.includes(yr) ? "border-transparent text-[#0a0a0a]" : "border-border text-muted hover:text-primary")}
                    style={selectedYears.includes(yr) ? { backgroundColor: yearColor(yr, availableYears) } : {}}>
                    {yr}
                  </button>
                ))}
              </div>
              {monthRangeFilter}
              {sharedSportFilter}
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-border p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={yearlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip metric={metric} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  {avgLine != null && (
                    <ReferenceLine y={avgLine} stroke="#94A3B8" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#94A3B8" }} />
                  )}
                  {selectedYears.map(yr => (
                    <Bar key={yr} dataKey={String(yr)} name={String(yr)}
                      fill={yearColor(yr, availableYears)} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* YTD indicator */}
            {yearlyYtdMode && (
              <p className="text-[11px] text-accent bg-accent/5 rounded-lg px-3 py-1.5">
                YTD — showing Jan–{MONTHS[effectiveMonthTo - 1]} for all years
              </p>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {yearlySummaries.map(s => (
                <div key={s.year} className="rounded-xl border border-border p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    <p className="text-xs font-semibold text-muted">{s.year}{yearlyYtdMode && s.year !== currentYear ? ` (Jan–${MONTHS[effectiveMonthTo - 1]})` : ""}</p>
                  </div>
                  <p className="text-2xl font-semibold font-mono text-primary">{fmtShort(s.total, metric)}</p>
                  <p className="text-[11px] text-muted">Avg {fmtShort(s.avg, metric)}/month</p>
                  <p className="text-[11px] text-muted">Best: {s.bestMonth}</p>
                </div>
              ))}
              {/* YoY comparison if exactly 2 years */}
              {yearlySummaries.length === 2 && (() => {
                const [a, b] = yearlySummaries;
                const delta = a.total > 0 ? Math.round(((b.total - a.total) / a.total) * 100) : 0;
                const up = b.total >= a.total;
                return (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold text-muted">{a.year} → {b.year}</p>
                    <p className="text-2xl font-semibold font-mono" style={{ color: up ? "#6EE7B7" : "#F87171" }}>
                      {up ? "+" : ""}{delta}%
                    </p>
                    <p className="text-[11px] text-muted">
                      {up ? "+" : ""}{fmtShort(Math.abs(b.total - a.total), metric)} {up ? "more" : "less"}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Cumulative YTD ──────────────────────────────────────────────── */}
        {viewMode === "cumulative" && (() => {
          const cumulativeYtdMode = selectedYears.includes(currentYear);
          // Cap months in table at currentMonth only when comparing with the current year
          const tableMonths = cumulativeYtdMode ? currentMonth : 12;
          const tableTitle = cumulativeYtdMode
            ? `YTD through ${MONTHS[currentMonth - 1]}`
            : "Full year";
          return (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wide">Year</span>
                {availableYears.map(yr => (
                  <button key={yr} onClick={() => toggleYear(yr)}
                    className={cn("px-3 py-1 rounded-lg text-sm font-medium border transition-colors",
                      selectedYears.includes(yr) ? "border-transparent text-[#0a0a0a]" : "border-border text-muted hover:text-primary")}
                    style={selectedYears.includes(yr) ? { backgroundColor: yearColor(yr, availableYears) } : {}}>
                    {yr}
                  </button>
                ))}
              </div>
              {sharedSportFilter}
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-[11px] text-muted mb-3">
                {cumulativeYtdMode
                  ? `Accumulated ${metric === "distance" ? "km" : "hours"} from Jan 1 — dotted line marks today`
                  : `Accumulated ${metric === "distance" ? "km" : "hours"} from Jan 1 — full year comparison`}
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={cumulativeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<ChartTooltip metric={metric} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  {cumulativeYtdMode && currentMonth < 12 && (
                    <ReferenceLine x={MONTHS[currentMonth - 1]} stroke="#94A3B8" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "today", position: "insideTopRight", fontSize: 10, fill: "#94A3B8" }} />
                  )}
                  {selectedYears.map(yr => (
                    <Line key={yr} dataKey={String(yr)} name={String(yr)}
                      stroke={yearColor(yr, availableYears)} strokeWidth={2.5}
                      dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-surface-2">
                <p className="text-sm font-semibold text-primary">{tableTitle}</p>
              </div>
              <div className="divide-y divide-border">
                {selectedYears.map(yr => {
                  const total = Array.from({ length: tableMonths }, (_, i) => monthVal(yr, i + 1)).reduce((s, v) => s + v, 0);
                  const prevYr = selectedYears.find(y => y === yr - 1);
                  const prevTotal = prevYr != null
                    ? Array.from({ length: tableMonths }, (_, i) => monthVal(prevYr, i + 1)).reduce((s, v) => s + v, 0)
                    : null;
                  const delta = prevTotal != null && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
                  return (
                    <div key={yr} className="px-4 py-3 flex items-center gap-4">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: yearColor(yr, availableYears) }} />
                      <span className="text-sm font-semibold text-primary w-12">{yr}</span>
                      <span className="font-mono text-primary">{fmtVal(total, metric)}</span>
                      {delta != null && (
                        <span className="text-xs" style={{ color: delta >= 0 ? "#6EE7B7" : "#F87171" }}>
                          {delta >= 0 ? "+" : ""}{delta}% vs {yr - 1}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── Weekly volume ───────────────────────────────────────────────── */}
        {viewMode === "weekly" && (
          <div className="space-y-4">
            {/* Sub-mode + controls */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex gap-1 rounded-lg border border-border p-0.5 w-fit text-xs">
                {(["timeline", "seasonal"] as const).map(m => (
                  <button key={m} onClick={() => setWeeklySubMode(m)}
                    className={cn("px-3 py-1 rounded-md transition-colors capitalize",
                      weeklySubMode === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary")}>
                    {m === "timeline" ? "Timeline" : "Season comparison"}
                  </button>
                ))}
              </div>

              {weeklySubMode === "timeline" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted uppercase tracking-wide">Date range</span>
                  <input type="month" value={weekRangeFrom} onChange={e => setWeekRangeFrom(e.target.value)}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <span className="text-xs text-muted">–</span>
                  <input type="month" value={weekRangeTo} onChange={e => setWeekRangeTo(e.target.value)}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                </div>
              )}

              {weeklySubMode === "seasonal" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted uppercase tracking-wide">Year</span>
                  {availableYears.map(yr => (
                    <button key={yr} onClick={() => toggleYear(yr)}
                      className={cn("px-3 py-1 rounded-lg text-sm font-medium border transition-colors",
                        selectedYears.includes(yr) ? "border-transparent text-[#0a0a0a]" : "border-border text-muted hover:text-primary")}
                      style={selectedYears.includes(yr) ? { backgroundColor: yearColor(yr, availableYears) } : {}}>
                      {yr}
                    </button>
                  ))}
                </div>
              )}
              {sharedSportFilter}
            </div>

            {/* Timeline chart */}
            {weeklySubMode === "timeline" && (
              <>
                <div className="rounded-xl border border-border p-4">
                  {weeklyTimelineData.length === 0
                    ? <p className="text-xs text-muted py-8 text-center">No data for this range.</p>
                    : (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={weeklyTimelineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="10%">
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="week" tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false}
                            interval={Math.max(0, Math.floor(weeklyTimelineData.length / 20) - 1)} />
                          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} />
                          <Tooltip content={<ChartTooltip metric={metric} />} />
                          {sportListW.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-muted)" }} />}
                          {sportListW.length <= 1
                            ? <Bar dataKey="total" fill="#6EE7B7" radius={[2, 2, 0, 0]} maxBarSize={24} />
                            : sportListW.map(s => (
                              <Bar key={s} dataKey={s} stackId="a" fill={SPORT_COLORS[s] ?? "#94A3B8"}
                                radius={sportListW.indexOf(s) === sportListW.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                            ))
                          }
                        </BarChart>
                      </ResponsiveContainer>
                    )
                  }
                </div>
                {weeklyTimelineData.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border p-4 space-y-1">
                      <p className="text-[11px] text-muted">Total</p>
                      <p className="text-xl font-semibold font-mono text-primary">{fmtShort(weeklyTimelineSummary.total, metric)}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4 space-y-1">
                      <p className="text-[11px] text-muted">Weekly avg</p>
                      <p className="text-xl font-semibold font-mono text-primary">{fmtShort(weeklyTimelineSummary.avg, metric)}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4 space-y-1">
                      <p className="text-[11px] text-muted">Best week</p>
                      <p className="text-xl font-semibold font-mono text-primary">{fmtShort(weeklyTimelineSummary.peak, metric)}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4 space-y-1">
                      <p className="text-[11px] text-muted">Weeks shown</p>
                      <p className="text-xl font-semibold font-mono text-primary">{weeklyTimelineSummary.weeks}</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Seasonal chart */}
            {weeklySubMode === "seasonal" && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] text-muted mb-3">
                  {weeklySeasonalYtdMode
                    ? `Weeks 1–${weekCap} (YTD) — all years capped at current week for fair comparison`
                    : "Weeks 1–52 aligned by calendar year — compare seasonal training patterns"}
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={weeklySeasonalData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false}
                      interval={3} />
                    <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<ChartTooltip metric={metric} />} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                    {selectedYears.map(yr => (
                      <Bar key={yr} dataKey={String(yr)} name={String(yr)}
                        fill={yearColor(yr, availableYears)} radius={[2, 2, 0, 0]} maxBarSize={20} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── Sport breakdown ─────────────────────────────────────────────── */}
        {viewMode === "sports" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wide">Year</span>
                {availableYears.map(yr => (
                  <button key={yr} onClick={() => setSingleYear(yr)}
                    className={cn("px-3 py-1 rounded-lg text-sm font-medium border transition-colors",
                      singleYear === yr ? "border-transparent text-[#0a0a0a]" : "border-border text-muted hover:text-primary")}
                    style={singleYear === yr ? { backgroundColor: yearColor(yr, availableYears) } : {}}>
                    {yr}
                  </button>
                ))}
              </div>
              {monthRangeFilter}
              {sharedSportFilter}
            </div>

            <div className="rounded-xl border border-border p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={sportsData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip metric={metric} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  {sportList.map(s => (
                    <Bar key={s} dataKey={s} stackId="a"
                      fill={SPORT_COLORS[s] ?? "#94A3B8"} radius={sportList.indexOf(s) === sportList.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Sport summary table */}
            {sportsSummary.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-surface-2">
                  <p className="text-sm font-semibold text-primary">{singleYear} — sport breakdown ({MONTHS[monthFrom - 1]}–{MONTHS[monthTo - 1]})</p>
                </div>
                <div className="divide-y divide-border">
                  {sportsSummary.map(s => (
                    <div key={s.sport} className="px-4 py-3 flex items-center gap-4">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-sm text-primary flex-1">{s.sport}</span>
                      <span className="font-mono text-primary">{fmtVal(s.total, metric)}</span>
                      <div className="w-24 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
                      </div>
                      <span className="text-xs text-muted w-8 text-right">{s.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Period comparison ────────────────────────────────────────────── */}
        {viewMode === "period" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-4">
              {/* Period A */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: YEAR_COLORS[0] }} />
                  <span className="text-xs font-semibold text-primary">Period A</span>
                  <span className="text-xs text-muted font-mono">{labelA}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="month" value={periodA.start}
                    onChange={e => setPeriodA(p => ({ ...p, start: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <span className="text-xs text-muted">–</span>
                  <input type="month" value={periodA.end}
                    onChange={e => setPeriodA(p => ({ ...p, end: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                </div>
              </div>
              {/* Period B */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: YEAR_COLORS[1] }} />
                  <span className="text-xs font-semibold text-primary">Period B</span>
                  <span className="text-xs text-muted font-mono">{labelB}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="month" value={periodB.start}
                    onChange={e => setPeriodB(p => ({ ...p, start: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <span className="text-xs text-muted">–</span>
                  <input type="month" value={periodB.end}
                    onChange={e => setPeriodB(p => ({ ...p, end: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                </div>
              </div>
              {ytdEqualized && (
                <p className="text-[11px] text-accent bg-accent/5 rounded-lg px-3 py-1.5">
                  YTD equalized — comparing first {compareLen} month{compareLen !== 1 ? "s" : ""} of each period for a fair comparison
                </p>
              )}
              {sharedSportFilter}
            </div>

            <div className="rounded-xl border border-border p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={periodData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip metric={metric} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  <Bar dataKey={labelA} fill={YEAR_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  <Bar dataKey={labelB} fill={YEAR_COLORS[1]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Period summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {periodSummaries.map(s => (
                <div key={s.label} className="rounded-xl border border-border p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    <p className="text-xs font-semibold text-muted">{s.label}</p>
                  </div>
                  <p className="text-2xl font-semibold font-mono text-primary">{fmtShort(s.total, metric)}</p>
                  {ytdEqualized && <p className="text-[10px] text-muted">first {compareLen} months</p>}
                </div>
              ))}
              {(() => {
                const [a, b] = periodSummaries;
                if (!a || !b || a.total === 0) return null;
                const delta = Math.round(((b.total - a.total) / a.total) * 100);
                const up = b.total >= a.total;
                return (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold text-muted">{a.label} → {b.label}</p>
                    <p className="text-2xl font-semibold font-mono" style={{ color: up ? "#6EE7B7" : "#F87171" }}>
                      {up ? "+" : ""}{delta}%
                    </p>
                    <p className="text-[11px] text-muted">
                      {up ? "+" : ""}{fmtShort(Math.abs(b.total - a.total), metric)} {up ? "more" : "less"}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Delta comparison table */}
            {periodSummaries.length === 2 && (() => {
              const [a, b] = periodSummaries;
              if (a.km === 0 && b.km === 0) return null;
              const delta = (val: number, ref: number) => {
                if (ref === 0) return <span className="text-muted">—</span>;
                const d = ((val - ref) / ref * 100);
                return <span className={d >= 0 ? "text-accent" : "text-warning"}>{d >= 0 ? "+" : ""}{d.toFixed(1)}%</span>;
              };
              return (
                <div className="mt-3 rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2">
                      <tr>
                        <th className="text-left px-3 py-2 text-muted font-medium">Metric</th>
                        <th className="text-right px-3 py-2 text-muted font-medium">Period A</th>
                        <th className="text-right px-3 py-2 text-muted font-medium">Period B</th>
                        <th className="text-right px-3 py-2 text-muted font-medium">Δ A vs B</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      <tr>
                        <td className="px-3 py-2 text-muted">Distans</td>
                        <td className="px-3 py-2 text-right font-mono text-primary">{a.km.toFixed(0)} km</td>
                        <td className="px-3 py-2 text-right font-mono text-primary">{b.km.toFixed(0)} km</td>
                        <td className="px-3 py-2 text-right">{delta(a.km, b.km)}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 text-muted">Pass</td>
                        <td className="px-3 py-2 text-right font-mono text-primary">{a.sessions}</td>
                        <td className="px-3 py-2 text-right font-mono text-primary">{b.sessions}</td>
                        <td className="px-3 py-2 text-right">{delta(a.sessions, b.sessions)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

      </div>
    </div>
  );
}
