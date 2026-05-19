"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { OverviewCard } from "@/components/stats/overview-card";
import { FitnessMetrics } from "@/components/stats/fitness-metrics";
import { WeeklyVolumeChart } from "@/components/charts/WeeklyVolumeChart";
import { TrainingLoadChart } from "@/components/charts/TrainingLoadChart";
import { HRZonesChart } from "@/components/charts/HRZonesChart";
import { MetricTooltip } from "@/components/stats/metric-tooltip";
import { tooltips } from "@/lib/fitness/tooltips";
import { formatDuration } from "@/lib/utils";
import type { DailyLoad } from "@/lib/fitness/training-load";
import { tsbLabel } from "@/lib/fitness/training-load";
import type { HRZones, PaceZones } from "@/lib/fitness/zones";
import type { VO2maxEstimate } from "@/lib/fitness/vo2max";
import { cn } from "@/lib/utils";

interface SumData { km: number; timeSec: number; count: number }
interface RacePred { label: string; meters: number; peak: number; today: number }

interface Props {
  overview: {
    thisWeek: SumData; thisMonth: SumData; ytd: SumData;
    lyWeek: SumData;   lyMonth: SumData;   lyYtd: SumData;
  };
  sparklines: number[];
  weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>>;
  loadCurve: DailyLoad[];
  todayLoad: DailyLoad;
  zoneSeconds: Record<string, number>;
  hrZones: HRZones;
  ltBounds: { lt1: number; lt2: number; ltTrainingRange: [number, number]; atTrainingRange: [number, number] };
  vo2max: VO2maxEstimate;
  paceZones: PaceZones;
  predictions: RacePred[];
}

function pct(curr: number, prev: number) {
  if (!prev) return undefined;
  return Math.round(((curr - prev) / prev) * 100);
}

const SECTIONS = ["Overview", "Volume", "Load", "Zones", "Fitness"] as const;
type Section = (typeof SECTIONS)[number];

export function StatsClient(props: Props) {
  const { overview: o, sparklines, weeklyVolumes, loadCurve, todayLoad,
    zoneSeconds, vo2max, paceZones, predictions, hrZones, ltBounds } = props;
  const [section, setSection] = useState<Section>("Overview");
  const [volumeMode, setVolumeMode] = useState<"distance" | "time">("distance");
  const [sportFilter, setSportFilter] = useState<string | null>(null);

  // Filter weeklyVolumes by selected sport
  const allSports = [...new Set(Object.values(props.weeklyVolumes).flatMap(w => Object.keys(w)))].sort();
  const filteredVolumes = sportFilter
    ? Object.fromEntries(Object.entries(props.weeklyVolumes).map(([wk, sports]) => [
        wk,
        Object.fromEntries(Object.entries(sports).filter(([s]) => s === sportFilter)),
      ]))
    : props.weeklyVolumes;
  const form = tsbLabel(todayLoad.tsb);

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <nav className="flex gap-1 border-b border-border">
        {SECTIONS.map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              section === s
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-primary"
            )}
          >
            {s}
          </button>
        ))}
      </nav>

      {/* ── Overview ── */}
      {section === "Overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OverviewCard
              label="This week"
              value={`${o.thisWeek.km} km`}
              sub={`${formatDuration(o.thisWeek.timeSec)} · ${o.thisWeek.count} sessions`}
              delta={pct(o.thisWeek.km, o.lyWeek.km)}
              sparkline={sparklines}
              accent
            />
            <OverviewCard
              label="This month"
              value={`${o.thisMonth.km} km`}
              sub={formatDuration(o.thisMonth.timeSec)}
              delta={pct(o.thisMonth.km, o.lyMonth.km)}
            />
            <OverviewCard
              label="Year to date"
              value={`${o.ytd.km} km`}
              sub={`${o.ytd.count} activities`}
              delta={pct(o.ytd.km, o.lyYtd.km)}
            />
            <div className="rounded-xl bg-surface border border-border p-5 space-y-2 shadow-sm">
              <div className="flex items-center gap-1">
                <p className="text-xs font-medium text-muted uppercase tracking-wide">Form (TSB)</p>
                <MetricTooltip tip={tooltips.tsb} />
              </div>
              <p className="text-2xl font-semibold font-mono" style={{ color: form.color }}>
                {todayLoad.tsb > 0 ? "+" : ""}{todayLoad.tsb.toFixed(0)}
              </p>
              <p className="text-xs font-medium" style={{ color: form.color }}>{form.label}</p>
            </div>
          </div>

          {/* Quick chart preview */}
          <SectionCard title="Weekly volume" action={
            <div className="flex gap-1 items-center">
              <SportFilter sports={allSports} selected={sportFilter} onChange={setSportFilter} />
              <VolumeToggle mode={volumeMode} setMode={setVolumeMode} />
            </div>
          }>
            <WeeklyVolumeChart weeklyVolumes={filteredVolumes} mode={volumeMode} />
          </SectionCard>

          <SectionCard title="Training load (ATL / CTL / TSB)" tips={[tooltips.atl, tooltips.ctl, tooltips.tsb]}>
            <TrainingLoadChart curve={loadCurve} />
          </SectionCard>
        </div>
      )}

      {/* ── Volume ── */}
      {section === "Volume" && (
        <div className="space-y-6">
          <SectionCard title="Weekly volume" action={
            <div className="flex gap-1 items-center">
              <SportFilter sports={allSports} selected={sportFilter} onChange={setSportFilter} />
              <VolumeToggle mode={volumeMode} setMode={setVolumeMode} />
            </div>
          }>
            <WeeklyVolumeChart weeklyVolumes={filteredVolumes} mode={volumeMode} />
          </SectionCard>
          <div className="grid grid-cols-3 gap-4">
            <OverviewCard label="This week" value={`${o.thisWeek.km} km`} sub={formatDuration(o.thisWeek.timeSec)} delta={pct(o.thisWeek.km, o.lyWeek.km)} />
            <OverviewCard label="This month" value={`${o.thisMonth.km} km`} sub={formatDuration(o.thisMonth.timeSec)} delta={pct(o.thisMonth.km, o.lyMonth.km)} />
            <OverviewCard label="Year to date" value={`${o.ytd.km} km`} sub={formatDuration(o.ytd.timeSec)} delta={pct(o.ytd.km, o.lyYtd.km)} />
          </div>
        </div>
      )}

      {/* ── Load ── */}
      {section === "Load" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <LoadCard label="CTL (fitness)" value={todayLoad.ctl.toFixed(1)} tip={tooltips.ctl} color="#6EE7B7" />
            <LoadCard label="ATL (fatigue)" value={todayLoad.atl.toFixed(1)} tip={tooltips.atl} color="#F87171" />
            <LoadCard label="TSB (form)" value={(todayLoad.tsb > 0 ? "+" : "") + todayLoad.tsb.toFixed(1)} tip={tooltips.tsb} color={form.color} sub={form.label} />
          </div>
          <SectionCard title="16-week training load" tips={[tooltips.atl, tooltips.ctl, tooltips.tsb]}>
            <TrainingLoadChart curve={loadCurve} />
          </SectionCard>
        </div>
      )}

      {/* ── Zones ── */}
      {section === "Zones" && (
        <div className="space-y-6">
          <SectionCard title="HR zone distribution (last 12 weeks)" tips={[tooltips.hrZone, tooltips.polarization]}
            action={<ZoneCalibrationButton />}>
            <HRZonesChart zoneSeconds={zoneSeconds} />
          </SectionCard>

          {/* HR zone table with LT/AT boundaries */}
          <HRZoneTable hrZones={hrZones} ltBounds={ltBounds} />
        </div>
      )}

      {/* ── Fitness ── */}
      {section === "Fitness" && (
        <FitnessMetrics vo2max={vo2max} paceZones={paceZones} todayLoad={todayLoad} predictions={predictions} />
      )}
    </div>
  );
}

function SectionCard({ title, children, action, tips }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tips?: typeof tooltips[string][];
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-primary flex-1">{title}</h2>
        {tips?.map((tip, i) => <MetricTooltip key={i} tip={tip} />)}
        {action}
      </div>
      {children}
    </div>
  );
}

function VolumeToggle({ mode, setMode }: { mode: string; setMode: (m: "distance" | "time") => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
      {(["distance", "time"] as const).map(m => (
        <button key={m} onClick={() => setMode(m)}
          className={cn("px-2.5 py-1 rounded-md transition-colors capitalize",
            mode === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary"
          )}>
          {m === "distance" ? "km" : "time"}
        </button>
      ))}
    </div>
  );
}

function SportFilter({ sports, selected, onChange }: {
  sports: string[]; selected: string | null; onChange: (s: string | null) => void;
}) {
  if (sports.length <= 1) return null;
  return (
    <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
      <button onClick={() => onChange(null)}
        className={cn("px-2 py-1 rounded-md transition-colors", !selected ? "bg-accent/10 text-accent" : "text-muted hover:text-primary")}>
        All
      </button>
      {sports.slice(0, 4).map(s => (
        <button key={s} onClick={() => onChange(selected === s ? null : s)}
          className={cn("px-2 py-1 rounded-md transition-colors", selected === s ? "bg-accent/10 text-accent" : "text-muted hover:text-primary")}>
          {s.replace(/([A-Z])/g, " $1").trim().split(" ")[0]}
        </button>
      ))}
    </div>
  );
}

function LoadCard({ label, value, tip, color, sub }: { label: string; value: string; tip: typeof tooltips[string]; color: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-5 space-y-1">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted">{label}</p>
        <MetricTooltip tip={tip} />
      </div>
      <p className="text-2xl font-semibold font-mono" style={{ color }}>{value}</p>
      {sub && <p className="text-xs font-medium" style={{ color }}>{sub}</p>}
    </div>
  );
}

function ZoneCalibrationButton() {
  const [loading, setLoading] = useState<"algo" | "ai" | null>(null);
  const [result, setResult] = useState<{ insights?: string; maxHR?: number; vo2max?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calibrate = useCallback(async (mode: "algorithmic" | "ai") => {
    setLoading(mode === "algorithmic" ? "algo" : "ai");
    setResult(null); setError(null);
    try {
      const res = await fetch(`/api/coach/calibrate?mode=${mode}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult({
        insights: data.aiInsights,
        maxHR: data.maxHR,
        vo2max: data.vo2max,
      });
    } catch (e) {
      setError(mode === "ai" ? "AI calibration failed — check API key in Settings." : "Calibration failed.");
      console.error(e);
    } finally {
      setLoading(null);
    }
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button onClick={() => calibrate("algorithmic")} disabled={!!loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border hover:border-accent/40 hover:text-primary text-muted transition disabled:opacity-50"
          title="Estimate HR zones from your training data (no AI)">
          {loading === "algo"
            ? <><Loader2 size={13} className="animate-spin" />Computing…</>
            : <><RefreshCw size={13} />Estimate zones</>}
        </button>
        <button onClick={() => calibrate("ai")} disabled={!!loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-accent/30 bg-accent/5 hover:bg-accent/10 text-accent transition disabled:opacity-50"
          title="Estimate HR zones using AI analysis of your training data">
          {loading === "ai"
            ? <><Loader2 size={13} className="animate-spin" />AI analysing…</>
            : "AI estimate"}
        </button>
      </div>
      {result && (
        <div className="text-xs text-muted bg-surface-2 rounded-xl px-3 py-2 space-y-1 max-w-sm">
          <p className="font-medium text-primary">
            Zones updated — max HR {result.maxHR} bpm · VO2max {result.vo2max?.toFixed(1)}
            <span className="text-muted font-normal"> · reload page to see updated charts</span>
          </p>
          {result.insights && <p className="italic">{result.insights}</p>}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

const ZONE_META = [
  { key: "z1", label: "Z1", name: "Recovery",  color: "#94A3B8", purpose: "Easy recovery, warm-up, cool-down" },
  { key: "z2", label: "Z2", name: "Aerobic",   color: "#6EE7B7", purpose: "Aerobic base — most of your volume should be here" },
  { key: "z3", label: "Z3", name: "Tempo",     color: "#FBBF24", purpose: "Between LT1 and LT2 — use sparingly, not junk miles" },
  { key: "z4", label: "Z4", name: "Threshold", color: "#F97316", purpose: "At/near LT2 — raises sustainable race pace ceiling" },
  { key: "z5", label: "Z5", name: "VO2max",    color: "#EF4444", purpose: "Above LT2 — develops top-end aerobic power" },
];

function HRZoneTable({ hrZones, ltBounds }: {
  hrZones: HRZones;
  ltBounds: { lt1: number; lt2: number; ltTrainingRange: [number, number]; atTrainingRange: [number, number] };
}) {
  const zones: Record<string, [number, number]> = {
    z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3, z4: hrZones.z4, z5: hrZones.z5,
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">HR zones — intervals & thresholds</p>
        <p className="text-xs text-muted">Max HR: {hrZones.maxHR} bpm · Rest HR: {hrZones.restHR} bpm</p>
      </div>

      {/* Zone rows */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2 text-xs text-muted font-medium w-8">Zone</th>
            <th className="text-left px-4 py-2 text-xs text-muted font-medium">Name</th>
            <th className="text-right px-4 py-2 text-xs text-muted font-medium font-mono">HR range</th>
            <th className="text-left px-4 py-2 text-xs text-muted font-medium hidden md:table-cell">Purpose</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ZONE_META.map(z => {
            const [lo, hi] = zones[z.key];
            return (
              <tr key={z.key} className="hover:bg-surface-2 transition-colors">
                <td className="px-4 py-2.5">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: z.color }} />
                  <span className="font-semibold text-primary">{z.label}</span>
                </td>
                <td className="px-4 py-2.5 text-primary">{z.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-muted">
                  {lo}–{hi} bpm
                </td>
                <td className="px-4 py-2.5 text-xs text-muted hidden md:table-cell">{z.purpose}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* LT / AT section */}
      <div className="border-t border-border bg-surface-2 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lactate Threshold (LT2)</p>
          <p className="font-mono font-semibold text-primary">{ltBounds.lt2} bpm</p>
          <p className="text-xs text-muted mt-0.5">Recommended LT training: <span className="font-mono text-warning">{ltBounds.ltTrainingRange[0]}–{ltBounds.ltTrainingRange[1]} bpm</span></p>
          <p className="text-xs text-muted mt-0.5">Examples: threshold intervals (4×10 min), tempo runs</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Aerobic Threshold (LT1)</p>
          <p className="font-mono font-semibold text-primary">{ltBounds.lt1} bpm</p>
          <p className="text-xs text-muted mt-0.5">Recommended AT training: <span className="font-mono text-accent">{ltBounds.atTrainingRange[0]}–{ltBounds.atTrainingRange[1]} bpm</span></p>
          <p className="text-xs text-muted mt-0.5">Examples: long runs, distans, marathon pace</p>
        </div>
      </div>
    </div>
  );
}
