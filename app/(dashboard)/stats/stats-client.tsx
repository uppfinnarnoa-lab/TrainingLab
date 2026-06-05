"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";
import { OverviewCard } from "@/components/stats/overview-card";
import { FitnessMetrics } from "@/components/stats/fitness-metrics";
import { WeeklyVolumeChart } from "@/components/charts/WeeklyVolumeChart";
import { TrainingLoadChart } from "@/components/charts/TrainingLoadChart";
import { HRZonesChart } from "@/components/charts/HRZonesChart";
import { EasyPaceTrendChart } from "@/components/charts/EasyPaceTrendChart";
import { LTPaceTrendChart } from "@/components/charts/LTPaceTrendChart";
import { MetricTooltip } from "@/components/stats/metric-tooltip";
import { tooltips } from "@/lib/fitness/tooltips";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";
import { formatDuration } from "@/lib/utils";
import type { DailyLoad } from "@/lib/fitness/training-load";
import { tsbLabel } from "@/lib/fitness/training-load";
import type { HRZones, PaceZones, StatisticalZoneResult } from "@/lib/fitness/zones";
import type { VO2maxEstimate } from "@/lib/fitness/vo2max";
import type { WeatherStats, WeatherBand, EasyPacePoint } from "@/app/(dashboard)/stats/page";
import { cn } from "@/lib/utils";

interface SumData { km: number; timeSec: number; count: number }
interface RacePred { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number }
interface Polarisation { z1Pct: number; z2Pct: number; z3Pct: number }

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
  polarisation: Polarisation | null;
  acwr: number | null;
  overviewRun: {
    thisWeek: SumData; thisMonth: SumData; ytd: SumData;
    lyWeek: SumData; lyMonth: SumData; lyYtd: SumData;
  };
  analytics: {
    aeiByWeek:       { week: string; aei: number }[];
    reByWeek:        { week: string; paceSecPerKm: number }[];
    rampRate:        number | null;
    injuryRisk:      number | null;
    activeStreak:    number;
    tempSensitivity: number | null;
  } | null;
  paceZoneSeconds: Record<string, number>;
  modelPredictions: Record<string, { label: string; meters: number; peak: number }[]>;
  modelVdots: Record<string, number>;
  manualMaxHR: number | null;
  manualRestHR: number | null;
  weatherStats: WeatherStats | null;
  easyPaceTrend: EasyPacePoint[];
  statZonesLaps: StatisticalZoneResult | null;
  extraViz: {
    heatmapData: { week: string; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
    monthlyOverlay: { month: string; year: number; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
    intensityProfile: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport?: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[];
    vdotTrend: { month: string; vdot: number }[];
    terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
    perfByDistYear: { distance: string; period: string; time: number }[];
    ltPaceTrend?: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[];
  } | null;
}

function pct(curr: number, prev: number) {
  if (!prev) return undefined;
  return Math.round(((curr - prev) / prev) * 100);
}

const SECTIONS = ["Overview", "Volume", "Load", "Zones", "Fitness"] as const;
type Section = (typeof SECTIONS)[number];

export function StatsClient(props: Props) {
  const [sportMode, setSportMode] = useState<"all" | "run">("all");
  const o = sportMode === "run" ? props.overviewRun : props.overview;
  const { sparklines, weeklyVolumes, loadCurve, todayLoad,
    zoneSeconds, vo2max, paceZones, predictions, hrZones, ltBounds, polarisation, acwr, statZonesLaps, analytics, paceZoneSeconds,
    modelPredictions, modelVdots, extraViz, manualMaxHR, manualRestHR, weatherStats, easyPaceTrend } = props;
  const [section, setSection] = useState<Section>("Overview");
  const [volumeMode, setVolumeMode] = useState<"distance" | "time">("distance");
  const [sportFilter, setSportFilter] = useState<string | null>(null);

  // Sports from current year's monthly overlay (always fresh) — broader than weeklyVolumes (12 weeks only)
  const currentYr = new Date().getFullYear();
  const allSports = (() => {
    const fromOverlay = extraViz?.monthlyOverlay
      ?.filter(m => m.year === currentYr && m.bySport)
      .flatMap(m => Object.keys(m.bySport!));
    const fromWeekly = Object.values(props.weeklyVolumes).flatMap(w => Object.keys(w));
    return [...new Set([...(fromOverlay ?? []), ...fromWeekly])].sort();
  })();
  const filteredVolumes = sportFilter
    ? Object.fromEntries(Object.entries(props.weeklyVolumes).map(([wk, sports]) => [
        wk,
        Object.fromEntries(Object.entries(sports).filter(([s]) => s === sportFilter)),
      ]))
    : props.weeklyVolumes;
  const form = tsbLabel(todayLoad.tsb);
  const initialLt1Pct = hrZones.maxHR > 0 ? Math.round(hrZones.z3[0] / hrZones.maxHR * 100) : 83;
  const initialLt2Pct = hrZones.maxHR > 0 ? Math.round(hrZones.z4[0] / hrZones.maxHR * 100) : 89;

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <nav className="flex gap-1 border-b border-border overflow-x-auto">
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
          <div className="flex justify-end">
            <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
              {(["all", "run"] as const).map(m => (
                <button key={m} onClick={() => setSportMode(m)}
                  className={cn("px-3 py-1 rounded-md transition-colors",
                    sportMode === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary"
                  )}>
                  {m === "all" ? "All sports" : "Running"}
                </button>
              ))}
            </div>
          </div>
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
          <SectionCard title="Weekly volume" href="/stats/volume?mode=weekly" action={
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
          {/* Global controls for the whole Volume section */}
          <div className="flex gap-2 items-center justify-end flex-wrap">
            <SportFilter sports={allSports} selected={sportFilter} onChange={setSportFilter} />
            <VolumeToggle mode={volumeMode} setMode={setVolumeMode} />
          </div>

          <SectionCard title="Weekly volume" href="/stats/volume?mode=weekly">
            <WeeklyVolumeChart weeklyVolumes={filteredVolumes} mode={volumeMode} />
          </SectionCard>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <OverviewCard label="This week" value={`${o.thisWeek.km} km`} sub={formatDuration(o.thisWeek.timeSec)} delta={pct(o.thisWeek.km, o.lyWeek.km)} />
            <OverviewCard label="This month" value={`${o.thisMonth.km} km`} sub={formatDuration(o.thisMonth.timeSec)} delta={pct(o.thisMonth.km, o.lyMonth.km)} />
            <OverviewCard label="Year to date" value={`${o.ytd.km} km`} sub={formatDuration(o.ytd.timeSec)} delta={pct(o.ytd.km, o.lyYtd.km)} />
          </div>

          {/* 3-year monthly overlay — respects sport filter + volume mode */}
          <MonthlyOverlayCard data={extraViz?.monthlyOverlay ?? []} mode={volumeMode} sportFilter={sportFilter} />

          {/* Monthly intensity profile — respects sport filter */}
          <IntensityProfileCard data={extraViz?.intensityProfile ?? []} sportFilter={sportFilter} />

          {/* Activity heatmap — respects sport filter + volume mode */}
          <ActivityHeatmapCard data={extraViz?.heatmapData ?? []} mode={volumeMode} sportFilter={sportFilter} />
        </div>
      )}

      {/* ── Load ── */}
      {section === "Load" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            action={<ZoneCalibrationButton initialLt1Pct={initialLt1Pct} initialLt2Pct={initialLt2Pct} />}>
            <HRZonesChart zoneSeconds={zoneSeconds} />
          </SectionCard>

          {/* Pace zone distribution */}
          <PaceZoneCard pzs={paceZoneSeconds} paceZones={paceZones} />

          {/* Statistical zone analysis from bucketed HR-pace data */}
          <StatisticalZonesCard sz={statZonesLaps} />

          {/* Polarisation + 5-zone distribution */}
          <PolarisationCard pol={polarisation} zoneSeconds={zoneSeconds} />

          {/* HR zone table with LT/AT boundaries */}
          <HRZoneTable hrZones={hrZones} ltBounds={ltBounds} manualMaxHR={manualMaxHR} manualRestHR={manualRestHR} />
        </div>
      )}

      {/* ── Fitness ── */}
      {section === "Fitness" && (
        <div className="space-y-6">
          <FitnessMetrics vo2max={vo2max} paceZones={paceZones} todayLoad={todayLoad} predictions={predictions} acwr={acwr}
            modelPredictions={modelPredictions} modelVdots={modelVdots} />

          {/* Analytics 1A: AEI trend + ramp rate + active streak */}
          {analytics && (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

              {/* AEI trend */}
              <div className="sm:col-span-2 rounded-xl border border-border p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Aerobic Efficiency Index (AEI)</p>
                  <p className="text-[10px] text-muted mt-0.5">Speed (m/min) ÷ avg HR · easy runs only (below LT1)</p>
                </div>
                {analytics.aeiByWeek.length >= 2 ? (
                  <div className="flex items-end gap-px h-12">
                    {analytics.aeiByWeek.map((d, i) => {
                      const min = Math.min(...analytics.aeiByWeek.map(x => x.aei));
                      const max = Math.max(...analytics.aeiByWeek.map(x => x.aei));
                      const range = max - min || 0.01;
                      const h = Math.max(10, Math.round(((d.aei - min) / range) * 100));
                      const isLast = i === analytics.aeiByWeek.length - 1;
                      return (
                        <div key={d.week} title={`v${d.week.slice(5,7)}: AEI ${d.aei.toFixed(2)}`}
                          className="flex-1 rounded-sm transition-all"
                          style={{ height: `${h}%`, backgroundColor: isLast ? "var(--accent)" : "var(--surface-2)", minHeight: 4 }} />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted">Needs more easy runs with HR data</p>
                )}
                {analytics.aeiByWeek.length >= 2 && (() => {
                  const first = analytics.aeiByWeek[0].aei;
                  const last  = analytics.aeiByWeek.at(-1)!.aei;
                  const delta = ((last - first) / first * 100).toFixed(1);
                  const up = last > first;
                  return (
                    <p className="text-xs" style={{ color: up ? "var(--accent)" : "var(--text-muted)" }}>
                      {up ? "↑" : "↓"} {up ? "+" : ""}{delta}% vs {analytics.aeiByWeek.length} weeks ago · Higher = more aerobically efficient
                    </p>
                  );
                })()}

                {/* Running Economy proxy */}
                {analytics.reByWeek.length >= 2 && (() => {
                  const first = analytics.reByWeek[0].paceSecPerKm;
                  const last  = analytics.reByWeek.at(-1)!.paceSecPerKm;
                  const delta = first - last; // negative delta = faster = better
                  const better = delta > 0;
                  const minRE = Math.min(...analytics.reByWeek.map(d => d.paceSecPerKm));
                  const maxRE = Math.max(...analytics.reByWeek.map(d => d.paceSecPerKm));
                  const rng = maxRE - minRE || 1;
                  return (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <p className="text-xs font-semibold text-muted uppercase tracking-wide">Running Economy proxy</p>
                      <p className="text-[10px] text-muted">Pace at ~75% maxHR — lower = more economical</p>
                      <div className="flex items-end gap-px h-10">
                        {analytics.reByWeek.map((d, i) => {
                          const h = Math.max(10, Math.round(((maxRE - d.paceSecPerKm) / rng) * 100));
                          const isLast = i === analytics.reByWeek.length - 1;
                          return <div key={d.week} title={`${secPerKmToPaceStr(d.paceSecPerKm)}/km`}
                            className="flex-1 rounded-sm" style={{ height: `${h}%`, backgroundColor: isLast ? "#818CF8" : "var(--surface-2)", minHeight: 4 }} />;
                        })}
                      </div>
                      <p className="text-xs" style={{ color: better ? "var(--accent)" : "#F87171" }}>
                        {better ? "↑ " : "↓ "}{better ? "" : "+"}{Math.abs(Math.round(delta))}s/km {better ? "faster" : "slower"} at same HR over this period
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Ramp rate + Streak + Injury risk + Temp */}
              <div className="space-y-3">
                <div className="rounded-xl border border-border p-4 space-y-1">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Weekly ramp rate</p>
                  {analytics.rampRate !== null ? (
                    <>
                      <p className="text-2xl font-semibold font-mono"
                        style={{ color: Math.abs(analytics.rampRate) > 10 ? "#F87171" : analytics.rampRate > 0 ? "#6EE7B7" : "#94A3B8" }}>
                        {analytics.rampRate > 0 ? "+" : ""}{analytics.rampRate}%
                      </p>
                      {Math.abs(analytics.rampRate) > 10 && (
                        <p className="text-[10px] text-error">⚠ High — elevated injury risk</p>
                      )}
                    </>
                  ) : <p className="text-sm text-muted">—</p>}
                </div>

                {analytics.injuryRisk !== null && (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">Injury risk</p>
                    <p className="text-2xl font-semibold font-mono"
                      style={{ color: analytics.injuryRisk >= 50 ? "#F87171" : analytics.injuryRisk >= 25 ? "#FBBF24" : "#6EE7B7" }}>
                      {analytics.injuryRisk}/100
                    </p>
                    <p className="text-[10px] text-muted">ACWR + ramp rate composite</p>
                  </div>
                )}

                <div className="rounded-xl border border-border p-4 space-y-1">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Active streak</p>
                  <p className="text-2xl font-semibold font-mono text-primary">{analytics.activeStreak}</p>
                  <p className="text-[10px] text-muted">consecutive days</p>
                </div>

                {analytics.tempSensitivity !== null && (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">Heat impact (easy runs)</p>
                    <p className="text-xl font-semibold font-mono" style={{ color: analytics.tempSensitivity > 5 ? "#F87171" : "#94A3B8" }}>
                      {analytics.tempSensitivity > 0 ? "+" : ""}{analytics.tempSensitivity}s/km
                    </p>
                    <p className="text-[10px] text-muted">per 5°C above 15°C</p>
                  </div>
                )}
              </div>
            </div>

            {/* Weather profile — temp + wind */}
            <WeatherProfileCard weatherStats={weatherStats} />
            </>
          )}

          {/* Easy pace trend */}
          <SectionCard
            title="Aerobic pace trend"
            tips={[tooltips.easyPaceTrend]}
          >
            {easyPaceTrend.length >= 3
              ? <EasyPaceTrendChart data={easyPaceTrend} />
              : <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
            }
          </SectionCard>

          {/* LT/AT tempo development over time */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-sm font-semibold text-primary">LT/AT pace development</p>
            <LTPaceTrendChart
              data={extraViz?.ltPaceTrend ?? []}
              currentLT2={paceZones?.threshold?.[0]}
              currentLT1={paceZones?.marathon?.[1]}
            />
          </div>

          {/* OL terrain factor */}
          <TerrainFactorCard tf={extraViz?.terrainFactor ?? null} />
        </div>
      )}
    </div>
  );
}

function WeatherProfileCard({ weatherStats }: { weatherStats: WeatherStats | null }) {
  const hasAnyData = weatherStats && (
    weatherStats.byTemp.some(b => b.count > 0) ||
    weatherStats.byWind.some(b => b.count > 0)
  );
  if (!hasAnyData) return (
    <div className="rounded-xl bg-surface border border-border p-5 space-y-5">
      <p className="text-sm font-semibold text-primary">Weather profile</p>
      <p className="text-xs text-muted py-4 text-center">No weather data — run Backfill weather data in Settings.</p>
    </div>
  );

  function fmtPace(sec: number | null): string {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}/km`;
  }

  const tempBands  = weatherStats!.byTemp.filter(b => b.count > 0);
  const windBands  = weatherStats!.byWind.filter(b => b.count > 0);
  const precipBands = (weatherStats!.byPrecip ?? []).filter(b => b.count > 0);
  const hrNormBands = (weatherStats!.hrNormByTemp ?? []).filter(b => b.count > 0);

  function fastest(bands: WeatherBand[]): number | null {
    const p = bands.filter(b => b.avgPaceSecPerKm != null).map(b => b.avgPaceSecPerKm!);
    return p.length > 0 ? Math.min(...p) : null;
  }
  function slowest(bands: WeatherBand[]): number | null {
    const p = bands.filter(b => b.avgPaceSecPerKm != null).map(b => b.avgPaceSecPerKm!);
    return p.length > 0 ? Math.max(...p) : null;
  }

  function paceBarWidth(pace: number | null, fast: number | null, slow: number | null): number {
    if (!pace || !fast || !slow) return 20;
    const range = slow - fast;
    if (range < 1) return 75;
    return Math.round((slow - pace) / range * 85 + 15);
  }

  function paceBarColor(sec: number | null, fast: number | null): string {
    if (!sec || !fast) return "#94A3B8";
    const diff = sec - fast;
    if (diff < 5)  return "#6EE7B7";
    if (diff < 15) return "#FBBF24";
    return "#F87171";
  }
  function paceTextColor(sec: number | null, fast: number | null): string {
    return paceBarColor(sec, fast);
  }

  function BandRow({ band, fast, slow, labelW }: { band: WeatherBand; fast: number | null; slow: number | null; labelW: string }) {
    const barColor = paceBarColor(band.avgPaceSecPerKm, fast);
    const textColor = paceTextColor(band.avgPaceSecPerKm, fast);
    return (
      <div className="flex items-center gap-3">
        <span className={`text-xs text-muted shrink-0 ${labelW}`}>{band.label}</span>
        <div className="flex-1 relative h-5 flex items-center">
          <div className="h-2 rounded-full bg-surface-2 w-full" />
          <div className="absolute h-2 rounded-full transition-all"
            style={{ width: `${paceBarWidth(band.avgPaceSecPerKm, fast, slow)}%`, backgroundColor: barColor, opacity: 0.7 }} />
        </div>
        <span className="text-xs font-mono font-semibold w-16 text-right shrink-0" style={{ color: textColor }}>
          {fmtPace(band.avgPaceSecPerKm)}
        </span>
        <span className="text-[10px] text-muted w-10 text-right shrink-0">{band.count}×</span>
      </div>
    );
  }

  const fastTemp = fastest(tempBands), slowTemp = slowest(tempBands);
  const fastWind = fastest(windBands), slowWind = slowest(windBands);
  const fastPrecip = fastest(precipBands), slowPrecip = slowest(precipBands);
  const fastHR = fastest(hrNormBands), slowHR = slowest(hrNormBands);

  const coldSensitivity = weatherStats!.coldSensitivity;

  return (
    <div className="rounded-xl bg-surface border border-border p-5 space-y-5">
      <div>
        <p className="text-sm font-semibold text-primary">Weather profile</p>
        <p className="text-[10px] text-muted mt-0.5">Pace adjusted for fitness drift — OL sessions excluded. Temp: calm wind only (&lt;20 km/h). Wind: 0–25°C only. Precip: 0–25°C only. Green = fastest, red = 15+ s/km slower.</p>
      </div>

      {coldSensitivity !== null && (
        <div className="flex gap-3 flex-wrap">
          <div className="rounded-lg border border-border px-3 py-2 space-y-0.5">
            <p className="text-[10px] text-muted uppercase tracking-wide">Cold penalty</p>
            <p className="text-sm font-semibold font-mono" style={{ color: coldSensitivity > 5 ? "#7DD3FC" : "#94A3B8" }}>
              {coldSensitivity > 0 ? "+" : ""}{coldSensitivity}s/km
            </p>
            <p className="text-[10px] text-muted">per 5°C below 5°C</p>
          </div>
        </div>
      )}

      {tempBands.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Adjusted pace by temperature</p>
          <div className="space-y-1.5">
            {tempBands.map(band => <BandRow key={band.label} band={band} fast={fastTemp} slow={slowTemp} labelW="w-20" />)}
          </div>
        </div>
      )}

      {hrNormBands.length >= 3 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Pace at 70–80% max HR by temperature</p>
          <p className="text-[10px] text-muted -mt-1">Effort-controlled — no fitness drift correction needed</p>
          <div className="space-y-1.5">
            {hrNormBands.map(band => <BandRow key={band.label} band={band} fast={fastHR} slow={slowHR} labelW="w-20" />)}
          </div>
        </div>
      )}

      {windBands.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Adjusted pace by wind (km/h)</p>
          <div className="space-y-1.5">
            {windBands.map(band => <BandRow key={band.label} band={band} fast={fastWind} slow={slowWind} labelW="w-28" />)}
          </div>
        </div>
      )}

      {precipBands.length >= 2 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Adjusted pace by precipitation</p>
          <div className="space-y-1.5">
            {precipBands.map(band => <BandRow key={band.label} band={band} fast={fastPrecip} slow={slowPrecip} labelW="w-28" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children, action, tips, href }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tips?: typeof tooltips[string][];
  href?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-surface border border-border p-5 space-y-4 transition-colors relative",
      href && "hover:border-accent/40")}>
      {/* Full-card link overlay — sits at z-0 so buttons/charts above it stay interactive */}
      {href && <Link href={href} className="absolute inset-0 rounded-xl z-0" aria-hidden tabIndex={-1} />}
      <div className="relative z-10 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-primary flex-1">{title}</h2>
        {tips?.map((tip, i) => <MetricTooltip key={i} tip={tip} />)}
        {action}
      </div>
      <div className="relative z-10">{children}</div>
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

function PaceZoneCard({ pzs, paceZones }: { pzs: Record<string, number>; paceZones: PaceZones }) {
  const totalSec = Object.values(pzs).reduce((s, v) => s + v, 0);
  if (totalSec === 0) return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2">
        <p className="text-sm font-semibold text-primary">Pace zone distribution (last 12 weeks · running)</p>
      </div>
      <div className="p-4">
        <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
      </div>
    </div>
  );
  const ZONES = [
    { key: "easy",       label: "Easy",       color: "#7DD3FC", range: paceZones.easy },
    { key: "marathon",   label: "Marathon",   color: "#6EE7B7", range: paceZones.marathon },
    { key: "threshold",  label: "Threshold",  color: "#F472B6", range: paceZones.threshold },
    { key: "interval",   label: "Interval",   color: "#818CF8", range: paceZones.interval },
    { key: "repetition", label: "Repetition", color: "#3B82F6", range: paceZones.repetition },
  ];
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2">
        <p className="text-sm font-semibold text-primary">Pace zone distribution (last 12 weeks · running)</p>
      </div>
      <div className="p-4 space-y-3">
        {/* Stacked bar */}
        <div className="flex rounded-full overflow-hidden h-4">
          {ZONES.map(z => {
            const w = totalSec > 0 ? ((pzs[z.key] ?? 0) / totalSec) * 100 : 0;
            return w > 0 ? <div key={z.key} style={{ width: `${w}%`, backgroundColor: z.color }} title={`${z.label}: ${w.toFixed(0)}%`} /> : null;
          })}
        </div>
        {/* Legend rows */}
        {ZONES.map(z => {
          const sec = pzs[z.key] ?? 0;
          const p = totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0;
          const [lo, hi] = z.range;
          return (
            <div key={z.key} className="flex items-center gap-3 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
              <span className="font-medium text-primary w-20">{z.label}</span>
              <span className="font-mono text-muted text-[10px]">{secPerKmToPaceStr(hi)}–{secPerKmToPaceStr(lo)}/km</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: z.color }} />
              </div>
              <span className="font-mono text-primary w-8 text-right">{p}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CalibMethod = "algorithmic" | "ai" | "pct_maxhr";

function ZoneCalibrationButton({ initialLt1Pct = 83, initialLt2Pct = 89 }: { initialLt1Pct?: number; initialLt2Pct?: number }) {
  const [loading, setLoading] = useState<CalibMethod | null>(null);
  const [method,  setMethod]  = useState<CalibMethod>("algorithmic");
  const [lt1Pct,  setLt1Pct]  = useState(initialLt1Pct);
  const [lt2Pct,  setLt2Pct]  = useState(initialLt2Pct);
  const [result, setResult] = useState<{ insights?: string | null; maxHR?: number; vo2max?: number; aiApplied?: boolean; rSquared?: number | null; zonesMethod?: string; lt1HR?: number; lt2HR?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calibrate = useCallback(async () => {
    setLoading(method);
    setResult(null); setError(null);
    try {
      let url = `/api/coach/calibrate?mode=${method === "pct_maxhr" ? "pct" : method}`;
      if (method === "pct_maxhr") url += `&lt1Pct=${lt1Pct}&lt2Pct=${lt2Pct}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult({
        insights: data.aiInsights,
        maxHR: data.maxHR,
        vo2max: data.vo2max,
        aiApplied: data.aiApplied,
        rSquared: data.rSquared,
        zonesMethod: data.zonesMethod,
        lt1HR: data.lt1HR,
        lt2HR: data.lt2HR,
      });
    } catch (e) {
      setError(method === "ai" ? "AI calibration failed — check your API key in Settings." : "Calibration failed.");
      console.error(e);
    } finally {
      setLoading(null);
    }
  }, [method, lt1Pct, lt2Pct]);

  const methodLabel: Record<CalibMethod, string> = {
    algorithmic: "Auto (statistical + race PBs)",
    ai:          "AI-assisted",
    pct_maxhr:   "% of max HR",
  };

  return (
    <div className="space-y-2">
      {/* Method selector */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5 text-xs">
        {(["algorithmic", "pct_maxhr", "ai"] as CalibMethod[]).map(m => (
          <button key={m} onClick={() => setMethod(m)}
            className={cn("px-2.5 py-1 rounded-md transition-colors whitespace-nowrap",
              method === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary"
            )}>
            {methodLabel[m]}
          </button>
        ))}
      </div>

      {/* % maxHR inputs */}
      {method === "pct_maxhr" && (
        <div className="flex items-center gap-3 text-xs">
          <label className="text-muted">LT1 %:</label>
          <input type="number" min={60} max={95} value={lt1Pct}
            onChange={e => setLt1Pct(Number(e.target.value))}
            className="w-14 rounded-lg border border-border bg-surface-2 px-2 py-1 text-primary text-center" />
          <label className="text-muted">LT2 %:</label>
          <input type="number" min={70} max={98} value={lt2Pct}
            onChange={e => setLt2Pct(Number(e.target.value))}
            className="w-14 rounded-lg border border-border bg-surface-2 px-2 py-1 text-primary text-center" />
          <span className="text-muted">of max HR</span>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={calibrate} disabled={!!loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border hover:border-accent/40 hover:text-primary text-muted transition disabled:opacity-50">
          {loading
            ? <><Loader2 size={13} className="animate-spin" />Calculating…</>
            : <><RefreshCw size={13} />Apply zones</>}
        </button>
      </div>
      {result && (
        <div className="text-xs text-muted bg-surface-2 rounded-xl px-3 py-2 space-y-1 max-w-sm">
          <p className="font-medium text-primary">
            {result.aiApplied ? "AI zones applied" : "Zones updated"} — max HR {result.maxHR} bpm · VO2max {result.vo2max?.toFixed(1)}
            <a href="/stats" className="ml-2 text-accent hover:underline font-normal">reload page</a>
          </p>
          <p>
            {result.lt1HR && result.lt2HR && <>LT1 {result.lt1HR} bpm · LT2 {result.lt2HR} bpm · </>}
            Method: {result.zonesMethod ?? "—"}{result.rSquared != null && <> · R² <span className={result.rSquared >= 0.80 ? "text-accent" : "text-warning"}>{result.rSquared.toFixed(2)}</span></>}
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

function HRZoneTable({ hrZones, ltBounds, manualMaxHR, manualRestHR }: {
  hrZones: HRZones;
  ltBounds: { lt1: number; lt2: number; ltTrainingRange: [number, number]; atTrainingRange: [number, number] };
  manualMaxHR?: number | null;
  manualRestHR?: number | null;
}) {
  const zones: Record<string, [number, number]> = {
    z1: hrZones.z1, z2: hrZones.z2, z3: hrZones.z3, z4: hrZones.z4, z5: hrZones.z5,
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-primary">HR zones — intervals & thresholds</p>
        <div className="text-xs text-muted space-y-0.5 text-right">
          <p>
            Max HR:{" "}
            <span className="font-mono font-medium text-primary">{hrZones.maxHR} bpm</span>
            {manualMaxHR != null
              ? <span className="ml-1 text-[10px] text-accent">(manuell)</span>
              : <span className="ml-1 text-[10px] text-muted">(estimated)</span>}
          </p>
          <p>
            Vila HR:{" "}
            <span className="font-mono font-medium text-primary">{hrZones.restHR} bpm</span>
            {manualRestHR != null
              ? <span className="ml-1 text-[10px] text-accent">(manuell)</span>
              : <span className="ml-1 text-[10px] text-muted">(estimated)</span>}
          </p>
        </div>
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

      {/* LT1 / LT2 section — physiological order: LT1 (lower) first, LT2 (higher) second */}
      <div className="border-t border-border bg-surface-2 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">LT1 — Aerobic Threshold</p>
          <p className="font-mono font-semibold text-primary">{ltBounds.lt1} bpm</p>
          <p className="text-xs text-muted mt-0.5">Training range: <span className="font-mono text-accent">{ltBounds.atTrainingRange[0]}–{ltBounds.atTrainingRange[1]} bpm</span></p>
          <p className="text-xs text-muted mt-0.5">Long runs, marathon tempos — stay below this for easy sessions</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">LT2 — Lactate Threshold</p>
          <p className="font-mono font-semibold text-primary">{ltBounds.lt2} bpm</p>
          <p className="text-xs text-muted mt-0.5">Training range: <span className="font-mono text-warning">{ltBounds.ltTrainingRange[0]}–{ltBounds.ltTrainingRange[1]} bpm</span></p>
          <p className="text-xs text-muted mt-0.5">Threshold intervals (4×10 min), tempopass</p>
        </div>
      </div>

    </div>
  );
}

// Colors matching the ZONE_META in HRZoneTable
const HR5_ZONES = [
  { key: "z1", label: "Z1 Recovery",  color: "#94A3B8" },
  { key: "z2", label: "Z2 Aerobic",   color: "#6EE7B7" },
  { key: "z3", label: "Z3 Tempo",     color: "#FBBF24" },
  { key: "z4", label: "Z4 Threshold", color: "#F97316" },
  { key: "z5", label: "Z5 VO2max",    color: "#EF4444" },
];

function PolarisationCard({ pol, zoneSeconds }: {
  pol: { z1Pct: number; z2Pct: number; z3Pct: number } | null;
  zoneSeconds?: Record<string, number>;
}) {
  if (!pol) return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2">
        <p className="text-sm font-semibold text-primary">HR zone distribution (last 12 weeks)</p>
      </div>
      <div className="p-4">
        <p className="text-xs text-muted py-4 text-center">No polarisation data available yet.</p>
      </div>
    </div>
  );
  const { z1Pct, z2Pct, z3Pct } = pol;
  const score = Math.max(0, Math.round(100 - Math.abs(z1Pct - 80) * 0.8 - z2Pct * 1.5));
  const scoreColor = score >= 75 ? "#6EE7B7" : score >= 50 ? "#FBBF24" : "#F87171";
  const msg = z2Pct > 25
    ? "Too much time in the tempo zone — risk of 'junk miles'. Replace with easy runs."
    : z1Pct >= 75 ? "Good polarisation — maintain this structure." : "Increase easy volume for better polarisation.";

  // 5-zone distribution from zoneSeconds
  const totalZ = zoneSeconds ? Object.values(zoneSeconds).reduce((s, v) => s + v, 0) : 0;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">HR zone distribution (last 12 weeks)</p>
        <span className="text-xs font-semibold font-mono" style={{ color: scoreColor }}>Seiler score {score}/100</span>
      </div>
      <div className="p-4 space-y-4">
        {/* 5-zone distribution — matching HR table colors */}
        {totalZ > 0 && (
          <div className="space-y-2">
            <div className="flex rounded-full overflow-hidden h-4 bg-surface-2">
              {HR5_ZONES.map(z => {
                const w = totalZ > 0 ? ((zoneSeconds![z.key] ?? 0) / totalZ) * 100 : 0;
                return w > 0 ? <div key={z.key} style={{ width: `${w}%`, backgroundColor: z.color }} title={`${z.label}: ${w.toFixed(0)}%`} /> : null;
              })}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {HR5_ZONES.map(z => {
                const p = totalZ > 0 ? Math.round(((zoneSeconds![z.key] ?? 0) / totalZ) * 100) : 0;
                return p > 0 ? (
                  <span key={z.key} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                    <span className="text-muted">{z.label}</span>
                    <span className="font-semibold text-primary">{p}%</span>
                  </span>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Seiler 3-zone — training structure (Low/Moderate/High, separate from 5-zone) */}
        <div className="pt-2 border-t border-border space-y-2">
          <p className="text-xs font-medium text-muted">Seiler 80/20 structure (Low / Moderate / High intensity)</p>
          <div className="flex rounded-full overflow-hidden h-3 bg-surface-2">
            <div style={{ width: `${z1Pct}%`, backgroundColor: "#6EE7B7" }} />
            <div style={{ width: `${z2Pct}%`, backgroundColor: "#FBBF24" }} />
            <div style={{ width: `${z3Pct}%`, backgroundColor: "#EF4444" }} />
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent/80" style={{ backgroundColor: "#6EE7B7" }} />Low {z1Pct}%</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FBBF24" }} />Moderate {z2Pct}%</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#EF4444" }} />High {z3Pct}%</span>
            <span className="ml-auto text-muted">Target: 80 · 5–10 · 15</span>
          </div>
          <p className="text-xs text-muted">{msg}</p>
        </div>
      </div>
    </div>
  );
}

function StatisticalZonesCard({ sz }: { sz: StatisticalZoneResult | null }) {
  const confColor = (r: number) => r >= 0.90 ? "#6EE7B7" : r >= 0.80 ? "#FBBF24" : "#F87171";
  const confLabel = (r: number) => r >= 0.90 ? "High" : r >= 0.80 ? "Medium" : "Low";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">Statistical threshold estimation</p>
          {sz && <p className="text-xs text-muted mt-0.5">{sz.bucketCount} pace buckets · piecewise regression</p>}
        </div>
        {sz && (
          <span className="text-xs font-semibold font-mono shrink-0" style={{ color: confColor(sz.rSquared) }}>
            R² {sz.rSquared.toFixed(2)} · {confLabel(sz.rSquared)}
          </span>
        )}
      </div>
      {!sz ? (
        <div className="p-4">
          <p className="text-xs text-muted py-4 text-center">No lap data yet — run a Strava backfill first.</p>
        </div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">LT1 — Aerobic Threshold</p>
              <p className="text-2xl font-semibold font-mono text-primary">{sz.lt1HR} <span className="text-sm text-muted font-normal">bpm</span></p>
              <p className="text-xs text-muted">Tempo: {secPerKmToPaceStr(sz.lt1PaceSecPerKm)} (GAP)</p>
              <p className="text-xs text-muted">Z2/Z3 boundary — easy sessions stay below this</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">LT2 — Lactate Threshold</p>
              <p className="text-2xl font-semibold font-mono text-primary">{sz.lt2HR} <span className="text-sm text-muted font-normal">bpm</span></p>
              <p className="text-xs text-muted">Tempo: {secPerKmToPaceStr(sz.lt2PaceSecPerKm)} (GAP)</p>
              <p className="text-xs text-muted">Z3/Z4 boundary — threshold intensity</p>
            </div>
          </div>
          <div className="border-t border-border px-4 py-3 bg-surface-2">
            <p className="text-xs text-muted">
              Estimated from {sz.bucketCount} pace buckets. Use the calibration button above to apply these zones.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── NEW VISUALIZATION COMPONENTS ──────────────────────────────────────────────

function ActivityHeatmapCard({ data, mode = "distance", sportFilter = null }: { data: { week: string; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[]; mode?: "distance" | "time"; sportFilter?: string | null }) {
  if (data.length === 0) return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Activity heatmap — last 3 years</p>
      <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
    </div>
  );
  const getValue = (d: { km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }) => {
    const src = sportFilter && d.bySport ? (d.bySport[sportFilter] ?? { km: 0, timeSec: 0 }) : d;
    return mode === "time" ? (src.timeSec ?? 0) / 3600 : (src.km ?? 0);
  };
  const maxVal = Math.max(...data.map(d => getValue(d)), 1);
  const years = [...new Set(data.map(d => d.week.slice(0, 4)))].sort().slice(-3);
  const color = (v: number) => {
    if (v === 0) return "var(--surface-2)";
    const i = Math.min(4, Math.ceil((v / maxVal) * 4));
    return ["#d1fae5","#6EE7B7","#34D399","#10B981","#059669"][i - 1];
  };
  const fmtTip = (d: { km: number; timeSec?: number } | undefined) => {
    if (!d) return "0";
    return mode === "time"
      ? `${Math.floor((d.timeSec ?? 0) / 3600)}h ${Math.round(((d.timeSec ?? 0) % 3600) / 60)}m`
      : `${d.km.toFixed(0)} km`;
  };
  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Activity heatmap — last 3 years ({mode === "time" ? "weekly time" : "weekly km"})</p>
      <div className="space-y-1">
        {years.map(yr => {
          const weeks = Array.from({ length: 53 }, (_, i) => {
            const d = new Date(Number(yr), 0, 1 + i * 7);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate() - d.getDay() + 1).padStart(2, "0")}`;
            return data.find(x => x.week.startsWith(yr) && x.week === key.slice(0, 10));
          });
          return (
            <div key={yr} className="flex items-center gap-1.5">
              <span className="text-xs text-muted w-8 shrink-0">{yr}</span>
              <div className="flex gap-0.5 flex-wrap">
                {weeks.map((entry, i) => (
                  <div key={i} title={fmtTip(entry)}
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: color(entry ? getValue(entry) : 0) }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 items-center text-[10px] text-muted">
        <span>Less</span>
        {["#d1fae5","#6EE7B7","#34D399","#10B981","#059669"].map((c,i) => (
          <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function MonthlyOverlayCard({
  data,
  mode = "distance",
  sportFilter = null,
}: {
  data: { month: string; year: number; km: number; timeSec?: number; bySport?: Record<string, { km: number; timeSec: number }> }[];
  mode?: "distance" | "time";
  sportFilter?: string | null;
}) {
  if (data.length === 0) return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <Link href="/stats/volume" className="text-sm font-semibold text-primary hover:text-accent transition-colors">3-year monthly volume overlay →</Link>
      <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
    </div>
  );
  const years = [...new Set(data.map(d => d.year))].sort();
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const COLORS = ["#818CF8","#6EE7B7","#F472B6"];

  const getValue = (d: typeof data[number]) => {
    // If sportFilter is set but bySport is missing (old cache), fall back to total
    const src = sportFilter && d.bySport ? (d.bySport[sportFilter] ?? { km: 0, timeSec: 0 }) : d;
    return mode === "time" ? ((src.timeSec ?? 0) / 3600) : (src.km ?? 0);
  };
  const fmtTip = (d: typeof data[number], yr: number, mo: string) => {
    const v = getValue(d);
    const label = mode === "time"
      ? `${Math.floor(v)}h ${Math.round((v % 1) * 60)}m`
      : `${Math.round(v)} km`;
    return `${yr} ${mo}: ${label}`;
  };

  const maxVal = Math.max(...data.map(d => getValue(d)), 1);

  return (
    <Link href="/stats/volume" className="block rounded-xl border border-border p-4 space-y-3 hover:border-accent/40 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">3-year monthly volume overlay →</p>
        <div className="flex gap-3">
          {years.map((yr, i) => (
            <span key={yr} className="flex items-center gap-1 text-xs text-muted">
              <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: COLORS[i] }} />
              {yr}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1 h-24">
        {MONTHS.map((mo, mi) => (
          <div key={mo} className="flex-1 flex flex-col items-center gap-px">
            <div className="flex items-end gap-px w-full justify-center h-20">
              {years.map((yr, yi) => {
                const d = data.find(x => x.year === yr && x.month === String(mi + 1).padStart(2, "0"));
                const v = d ? getValue(d) : 0;
                const h = Math.max(2, Math.round((v / maxVal) * 80));
                return (
                  <div key={yr} title={d ? fmtTip(d, yr, mo) : `${yr} ${mo}: 0`}
                    className="flex-1 rounded-t-sm"
                    style={{ height: h, backgroundColor: COLORS[yi] + (v > 0 ? "cc" : "22") }} />
                );
              })}
            </div>
            <span className="text-[9px] text-muted">{mo.slice(0,1)}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function IntensityProfileCard({ data, sportFilter = null }: { data: { month: string; easyMin: number; tempoMin: number; hardMin: number; bySport?: Record<string, { easyMin: number; tempoMin: number; hardMin: number }> }[]; sportFilter?: string | null }) {
  if (data.length === 0) return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Monthly intensity distribution (last 12 months)</p>
      <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
    </div>
  );
  const last12 = data.slice(-12);
  const CHART_H = 80;
  // If sportFilter set and bySport exists, use sport-specific buckets; else use total
  const resolve = (d: typeof last12[number]) =>
    sportFilter && d.bySport ? (d.bySport[sportFilter] ?? { easyMin: 0, tempoMin: 0, hardMin: 0 }) : d;
  const maxTotal = Math.max(...last12.map(d => { const r = resolve(d); return r.easyMin + r.tempoMin + r.hardMin; }), 1);

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Monthly intensity distribution (last 12 months)</p>
      <div className="flex gap-2">
        <div className="flex-1 flex items-end gap-1" style={{ height: CHART_H }}>
          {last12.map(d => {
            const r = resolve(d);
            const totalMin = r.easyMin + r.tempoMin + r.hardMin;
            const scaledH = (totalMin / maxTotal) * CHART_H;
            const easyFrac  = totalMin > 0 ? r.easyMin  / totalMin : 0;
            const tempoFrac = totalMin > 0 ? r.tempoMin / totalMin : 0;
            const hardFrac  = totalMin > 0 ? r.hardMin  / totalMin : 0;
            const easyPx  = Math.round(scaledH * easyFrac);
            const tempoPx = Math.round(scaledH * tempoFrac);
            const hardPx  = Math.round(scaledH * hardFrac);
            const monthLabel = d.month.slice(5, 7);
            return (
              <div key={d.month} className="flex-1 flex flex-col items-stretch justify-end"
                title={`${d.month}: Easy ${Math.round(r.easyMin/60)}h · Tempo ${Math.round(r.tempoMin/60)}h · Hard ${Math.round(r.hardMin/60)}h`}>
                <div className="flex flex-col justify-end rounded-sm overflow-hidden">
                  {hardPx  > 0 && <div style={{ height: hardPx,  backgroundColor: "#EF4444" }} />}
                  {tempoPx > 0 && <div style={{ height: tempoPx, backgroundColor: "#FBBF24" }} />}
                  {easyPx  > 0 && <div style={{ height: easyPx,  backgroundColor: "#6EE7B7" }} />}
                </div>
                <span className="text-[9px] text-muted text-center mt-0.5">{monthLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-4 text-[10px] text-muted">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#6EE7B7] mr-1" />Easy (below LT1)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#FBBF24] mr-1" />Tempo (LT1–LT2)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#EF4444] mr-1" />Hard (above LT2)</span>
      </div>
    </div>
  );
}

function VdotTrendCard({ data }: { data: { month: string; vdot: number }[] }) {
  if (data.length < 4) return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">VDOT trend (3-month rolling window)</p>
      <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
    </div>
  );
  const min = Math.min(...data.map(d => d.vdot)) - 2;
  const max = Math.max(...data.map(d => d.vdot)) + 2;
  const range = max - min || 1;
  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">VDOT trend (3-month rolling window)</p>
        <span className="text-xs font-mono text-accent">Current: {data.at(-1)?.vdot.toFixed(1)}</span>
      </div>
      <div className="relative h-20">
        <svg width="100%" height="80" viewBox={`0 0 ${data.length * 20} 80`} preserveAspectRatio="none">
          <polyline
            fill="none" stroke="var(--accent)" strokeWidth="2"
            points={data.map((d, i) => `${i * 20 + 10},${Math.round(((max - d.vdot) / range) * 72 + 4)}`).join(" ")}
          />
          {data.at(-1) && (
            <circle cx={(data.length - 1) * 20 + 10} cy={Math.round(((max - data.at(-1)!.vdot) / range) * 72 + 4)} r="4" fill="var(--accent)" />
          )}
        </svg>
        <div className="absolute top-0 left-0 right-0 flex justify-between text-[9px] text-muted pointer-events-none">
          <span>{data[0]?.month.slice(0,7)}</span>
          <span>{data.at(-1)?.month.slice(0,7)}</span>
        </div>
      </div>
      <p className="text-[10px] text-muted">Estimated from quality sessions in rolling 3-month windows. Rising = improving fitness.</p>
    </div>
  );
}

function TerrainFactorCard({ tf }: { tf: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null }) {
  if (!tf) return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Orienteering terrain factor</p>
      <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
    </div>
  );
  const diff = tf.olPaceSecPerKm - tf.roadPaceSecPerKm;
  const pct = Math.round((diff / tf.roadPaceSecPerKm) * 100);
  const olMM = Math.floor(tf.olPaceSecPerKm / 60), olSS = tf.olPaceSecPerKm % 60;
  const roadMM = Math.floor(tf.roadPaceSecPerKm / 60), roadSS = tf.roadPaceSecPerKm % 60;
  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-primary">Orienteering terrain factor</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted">Road running avg pace</p>
          <p className="text-2xl font-semibold font-mono text-primary">{roadMM}:{String(roadSS).padStart(2,"0")}</p>
          <p className="text-[10px] text-muted">{tf.roadSessions} sessions (at moderate HR)</p>
        </div>
        <div>
          <p className="text-xs text-muted">Orienteering avg pace</p>
          <p className="text-2xl font-semibold font-mono text-primary">{olMM}:{String(olSS).padStart(2,"0")}</p>
          <p className="text-[10px] text-muted">{tf.olSessions} sessions</p>
        </div>
      </div>
      <p className="text-xs text-muted">
        Terrain cost: <span className="font-semibold text-warning">+{diff}s/km (+{pct}%)</span> slower in orienteering terrain vs road at similar effort.
      </p>
    </div>
  );
}
