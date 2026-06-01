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

interface Props {
  records: VolumeRecord[];
  sports: string[];
  availableYears: number[];
}

type ViewMode = "yearly" | "cumulative" | "sports" | "period";
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

export function VolumeClient({ records, sports, availableYears }: Props) {
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
  const [periodA, setPeriodA] = useState({
    start: `${currentYear - 1}-01`,
    end: `${currentYear - 1}-12`,
    label: String(currentYear - 1),
  });
  const [periodB, setPeriodB] = useState({
    start: `${currentYear}-01`,
    end: `${currentYear}-${String(currentMonth).padStart(2, "0")}`,
    label: String(currentYear),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getValue = (r: { km: number; timeSec: number }) =>
    metric === "time" ? r.timeSec / 3600 : r.km;

  const sportList = selectedSports.length > 0 ? selectedSports : sports;

  const monthVal = (year: number, month: number) =>
    records
      .filter(r => r.year === year && r.month === month && sportList.includes(r.sport))
      .reduce((s, r) => s + getValue(r), 0);

  // ── Yearly chart data ──────────────────────────────────────────────────────
  const yearlyData = useMemo(() => {
    const months = Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    return months.map(m => {
      const entry: Record<string, number | string> = { month: MONTHS[m - 1] };
      for (const yr of selectedYears) {
        entry[String(yr)] = Math.round(monthVal(yr, m) * 10) / 10;
      }
      return entry;
    });
  }, [records, selectedYears, monthFrom, monthTo, metric, selectedSports]);

  const yearlySummaries = useMemo(() => selectedYears.map(yr => {
    const months = Array.from({ length: monthTo - monthFrom + 1 }, (_, i) => monthFrom + i);
    const vals = months.map(m => monthVal(yr, m));
    const total = vals.reduce((s, v) => s + v, 0);
    const avg = total / months.length;
    const bestIdx = vals.indexOf(Math.max(...vals));
    return {
      year: yr,
      total,
      avg,
      bestMonth: MONTHS[monthFrom + bestIdx - 1],
      color: yearColor(yr, availableYears),
    };
  }), [records, selectedYears, monthFrom, monthTo, metric, selectedSports]);

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

  const periodData = useMemo(() => {
    const aM = periodMonths(parseYM(periodA.start), parseYM(periodA.end));
    const bM = periodMonths(parseYM(periodB.start), parseYM(periodB.end));
    const len = Math.max(aM.length, bM.length);
    return Array.from({ length: len }, (_, i) => {
      const am = aM[i], bm = bM[i];
      const entry: Record<string, number | string> = {
        month: am ? MONTHS[am.month - 1] : (bm ? MONTHS[bm.month - 1] : String(i + 1)),
      };
      if (am) entry[periodA.label] = Math.round(monthVal(am.year, am.month) * 10) / 10;
      if (bm) entry[periodB.label] = Math.round(monthVal(bm.year, bm.month) * 10) / 10;
      return entry;
    });
  }, [records, periodA, periodB, metric, selectedSports]);

  const periodSummaries = useMemo(() => {
    const total = (p: typeof periodA) => {
      const ms = periodMonths(parseYM(p.start), parseYM(p.end));
      return ms.reduce((s, { year, month }) => s + monthVal(year, month), 0);
    };
    return [
      { label: periodA.label, total: total(periodA), color: YEAR_COLORS[0] },
      { label: periodB.label, total: total(periodB), color: YEAR_COLORS[1] },
    ];
  }, [records, periodA, periodB, metric, selectedSports]);

  // ── Shared controls ────────────────────────────────────────────────────────
  const toggleYear = (yr: number) =>
    setSelectedYears(prev => prev.includes(yr) ? prev.filter(y => y !== yr) : [...prev, yr].sort());

  const MODES: { id: ViewMode; label: string }[] = [
    { id: "yearly",     label: "År vs år" },
    { id: "cumulative", label: "Ackumulerat" },
    { id: "sports",     label: "Sporter" },
    { id: "period",     label: "Perioder" },
  ];

  const tickFmt = (v: number) => metric === "time" ? `${v}h` : `${v} km`;

  const sharedSportFilter = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-muted uppercase tracking-wide">Sport</span>
      <button onClick={() => setSelectedSports([])}
        className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
          selectedSports.length === 0 ? "bg-accent/10 text-accent border-accent/20" : "border-border text-muted hover:text-primary")}>
        Alla
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
      <span className="text-[11px] text-muted uppercase tracking-wide">Period</span>
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
          {m === "distance" ? "km" : "tid"}
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
          <h1 className="text-xl font-semibold text-primary">Volymutforskaren</h1>
          <div className="ml-auto">{metricToggle}</div>
        </div>

        {/* View mode tabs */}
        <div className="flex gap-1 border-b border-border">
          {MODES.map(({ id, label }) => (
            <button key={id} onClick={() => setViewMode(id)}
              className={cn("px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
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
                <span className="text-[11px] text-muted uppercase tracking-wide">År</span>
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
                    <ReferenceLine y={avgLine} stroke="#94A3B8" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "snitt", position: "insideTopRight", fontSize: 10, fill: "#94A3B8" }} />
                  )}
                  {selectedYears.map(yr => (
                    <Bar key={yr} dataKey={String(yr)} name={String(yr)}
                      fill={yearColor(yr, availableYears)} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {yearlySummaries.map(s => (
                <div key={s.year} className="rounded-xl border border-border p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    <p className="text-xs font-semibold text-muted">{s.year}</p>
                  </div>
                  <p className="text-2xl font-semibold font-mono text-primary">{fmtShort(s.total, metric)}</p>
                  <p className="text-[11px] text-muted">Snitt {fmtShort(s.avg, metric)}/mån</p>
                  <p className="text-[11px] text-muted">Bästa {s.bestMonth}</p>
                </div>
              ))}
              {/* YoY comparison if exactly 2 years */}
              {yearlySummaries.length === 2 && (() => {
                const [a, b] = yearlySummaries;
                const delta = b.total > 0 ? Math.round(((b.total - a.total) / a.total) * 100) : 0;
                const up = b.total >= a.total;
                return (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold text-muted">{a.year} → {b.year}</p>
                    <p className="text-2xl font-semibold font-mono" style={{ color: up ? "#6EE7B7" : "#F87171" }}>
                      {up ? "+" : ""}{delta}%
                    </p>
                    <p className="text-[11px] text-muted">
                      {up ? "+" : ""}{fmtShort(Math.abs(b.total - a.total), metric)} {up ? "mer" : "mindre"}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Cumulative YTD ──────────────────────────────────────────────── */}
        {viewMode === "cumulative" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wide">År</span>
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
              <p className="text-[11px] text-muted mb-3">Ackumulerat {metric === "distance" ? "km" : "timmar"} från 1 jan — nuläge markerat med streckad linje</p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={cumulativeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<ChartTooltip metric={metric} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  {currentMonth < 12 && (
                    <ReferenceLine x={MONTHS[currentMonth - 1]} stroke="#94A3B8" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "idag", position: "insideTopRight", fontSize: 10, fill: "#94A3B8" }} />
                  )}
                  {selectedYears.map(yr => (
                    <Line key={yr} dataKey={String(yr)} name={String(yr)}
                      stroke={yearColor(yr, availableYears)} strokeWidth={2.5}
                      dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* YTD comparison table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-surface-2">
                <p className="text-sm font-semibold text-primary">Läge per {MONTHS[currentMonth - 1]}</p>
              </div>
              <div className="divide-y divide-border">
                {selectedYears.map(yr => {
                  const ytd = Array.from({ length: Math.min(currentMonth, 12) }, (_, i) => monthVal(yr, i + 1)).reduce((s, v) => s + v, 0);
                  const prevYr = selectedYears.find(y => y === yr - 1);
                  const prevYtd = prevYr != null
                    ? Array.from({ length: Math.min(currentMonth, 12) }, (_, i) => monthVal(prevYr, i + 1)).reduce((s, v) => s + v, 0)
                    : null;
                  const delta = prevYtd != null && prevYtd > 0 ? Math.round(((ytd - prevYtd) / prevYtd) * 100) : null;
                  return (
                    <div key={yr} className="px-4 py-3 flex items-center gap-4">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: yearColor(yr, availableYears) }} />
                      <span className="text-sm font-semibold text-primary w-12">{yr}</span>
                      <span className="font-mono text-primary">{fmtVal(ytd, metric)}</span>
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
        )}

        {/* ── Sport breakdown ─────────────────────────────────────────────── */}
        {viewMode === "sports" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wide">År</span>
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
                  <p className="text-sm font-semibold text-primary">{singleYear} — sportfördelning ({MONTHS[monthFrom - 1]}–{MONTHS[monthTo - 1]})</p>
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: YEAR_COLORS[0] }} />
                  <span className="text-xs font-semibold text-primary">Period A</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="month" value={periodA.start}
                    onChange={e => setPeriodA(p => ({ ...p, start: e.target.value, label: e.target.value.slice(0, 4) === p.end.slice(0, 4) ? p.label : e.target.value.slice(0, 4) }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <span className="text-xs text-muted">–</span>
                  <input type="month" value={periodA.end}
                    onChange={e => setPeriodA(p => ({ ...p, end: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <input type="text" value={periodA.label} placeholder="Etikett"
                    onChange={e => setPeriodA(p => ({ ...p, label: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary w-24" />
                </div>
              </div>
              {/* Period B */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: YEAR_COLORS[1] }} />
                  <span className="text-xs font-semibold text-primary">Period B</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="month" value={periodB.start}
                    onChange={e => setPeriodB(p => ({ ...p, start: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <span className="text-xs text-muted">–</span>
                  <input type="month" value={periodB.end}
                    onChange={e => setPeriodB(p => ({ ...p, end: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary" />
                  <input type="text" value={periodB.label} placeholder="Etikett"
                    onChange={e => setPeriodB(p => ({ ...p, label: e.target.value }))}
                    className="text-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-primary w-24" />
                </div>
              </div>
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
                  <Bar dataKey={periodA.label} fill={YEAR_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  <Bar dataKey={periodB.label} fill={YEAR_COLORS[1]} radius={[3, 3, 0, 0]} maxBarSize={40} />
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
                      {up ? "+" : ""}{fmtShort(Math.abs(b.total - a.total), metric)} {up ? "mer" : "mindre"}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
