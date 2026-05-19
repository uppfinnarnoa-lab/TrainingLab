"use client";

import { useState } from "react";
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
    zoneSeconds, vo2max, paceZones, predictions } = props;
  const [section, setSection] = useState<Section>("Overview");
  const [volumeMode, setVolumeMode] = useState<"distance" | "time">("distance");
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
            <VolumeToggle mode={volumeMode} setMode={setVolumeMode} />
          }>
            <WeeklyVolumeChart weeklyVolumes={weeklyVolumes} mode={volumeMode} />
          </SectionCard>

          <SectionCard title="Training load (ATL / CTL / TSB)" tips={[tooltips.atl, tooltips.ctl, tooltips.tsb]}>
            <TrainingLoadChart curve={loadCurve} />
          </SectionCard>
        </div>
      )}

      {/* ── Volume ── */}
      {section === "Volume" && (
        <div className="space-y-6">
          <SectionCard title="Weekly volume" action={<VolumeToggle mode={volumeMode} setMode={setVolumeMode} />}>
            <WeeklyVolumeChart weeklyVolumes={weeklyVolumes} mode={volumeMode} />
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
          <SectionCard title="HR zone distribution (last 12 weeks)" tips={[tooltips.hrZone, tooltips.polarization]}>
            <HRZonesChart zoneSeconds={zoneSeconds} />
          </SectionCard>
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
