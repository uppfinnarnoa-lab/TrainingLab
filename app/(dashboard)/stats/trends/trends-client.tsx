"use client";

import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ChevronLeft } from "lucide-react";
import { EasyPaceTrendChart } from "@/components/charts/EasyPaceTrendChart";
import { LTPaceTrendChart } from "@/components/charts/LTPaceTrendChart";
import { VO2maxTrendChart } from "@/components/charts/VO2maxTrendChart";
import { WeatherPaceScatterChart } from "@/components/charts/WeatherPaceScatterChart";
import { CadenceStrideScatterChart } from "@/components/charts/CadenceStrideScatterChart";
import { MetricTooltip } from "@/components/stats/metric-tooltip";
import { tooltips } from "@/lib/fitness/tooltips";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";
import type {
  WeatherStats, WeatherBand, EasyPacePoint, CadenceScatterPoint,
} from "@/lib/fitness/secondary-analytics";

interface Props {
  aeiByWeek: { week: string; aei: number }[];
  reByWeek: { week: string; paceSecPerKm: number }[];
  rampRate: number | null;
  injuryRisk: number | null;
  activeStreak: number;
  tempSensitivity: number | null;
  weatherStats: WeatherStats | null;
  easyPaceTrend: EasyPacePoint[];
  cadenceScatter: CadenceScatterPoint[];
  efByWeek: { week: string; ef: number }[];
  vdotTrend: { month: string; vdot: number }[];
  ltPaceTrend: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[];
  currentLT1Pace?: number;
  currentLT2Pace?: number;
  terrainFactor: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
}

function Card({ title, tip, children }: { title: string; tip?: typeof tooltips[string]; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-primary">{title}</p>
        {tip && <MetricTooltip tip={tip} />}
      </div>
      {children}
    </div>
  );
}

export function TrendsClient({
  aeiByWeek, reByWeek, rampRate, injuryRisk, activeStreak, tempSensitivity,
  weatherStats, easyPaceTrend, cadenceScatter, efByWeek,
  vdotTrend, ltPaceTrend, currentLT1Pace, currentLT2Pace, terrainFactor,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/stats" className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors mb-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Stats
        </Link>
        <h1 className="text-2xl font-semibold text-primary">Performance Trends</h1>
        <p className="text-sm text-muted mt-1">Deeper aerobic, weather, and biomechanical analytics — separated from the Fitness tab's daily numbers.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2 rounded-xl border border-border p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Aerobic Efficiency Index (AEI)</p>
            <p className="text-[10px] text-muted mt-0.5">Speed (m/min) ÷ avg HR · easy runs only (below LT1)</p>
          </div>
          {aeiByWeek.length >= 2 ? (
            <div className="flex items-end gap-px h-12">
              {aeiByWeek.map((d, i) => {
                const min = Math.min(...aeiByWeek.map(x => x.aei));
                const max = Math.max(...aeiByWeek.map(x => x.aei));
                const range = max - min || 0.01;
                const h = Math.max(10, Math.round(((d.aei - min) / range) * 100));
                const isLast = i === aeiByWeek.length - 1;
                return (
                  <div key={d.week} title={`v${d.week.slice(5, 7)}: AEI ${d.aei.toFixed(2)}`}
                    className="flex-1 rounded-sm transition-all"
                    style={{ height: `${h}%`, backgroundColor: isLast ? "var(--accent)" : "var(--surface-2)", minHeight: 4 }} />
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted">Needs more easy runs with HR data</p>
          )}
          {aeiByWeek.length >= 2 && (() => {
            const first = aeiByWeek[0].aei;
            const last  = aeiByWeek.at(-1)!.aei;
            const delta = ((last - first) / first * 100).toFixed(1);
            const up = last > first;
            return (
              <p className="text-xs" style={{ color: up ? "var(--accent)" : "var(--text-muted)" }}>
                {up ? "↑" : "↓"} {up ? "+" : ""}{delta}% vs {aeiByWeek.length} weeks ago · Higher = more aerobically efficient
              </p>
            );
          })()}

          {reByWeek.length >= 2 && (() => {
            const first = reByWeek[0].paceSecPerKm;
            const last  = reByWeek.at(-1)!.paceSecPerKm;
            const delta = first - last; // negative delta = faster = better
            const better = delta > 0;
            const minRE = Math.min(...reByWeek.map(d => d.paceSecPerKm));
            const maxRE = Math.max(...reByWeek.map(d => d.paceSecPerKm));
            const rng = maxRE - minRE || 1;
            return (
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide">Running Economy proxy</p>
                <p className="text-[10px] text-muted">Pace at ~75% maxHR — lower = more economical</p>
                <div className="flex items-end gap-px h-10">
                  {reByWeek.map((d, i) => {
                    const h = Math.max(10, Math.round(((maxRE - d.paceSecPerKm) / rng) * 100));
                    const isLast = i === reByWeek.length - 1;
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

        <div className="space-y-3">
          <div className="rounded-xl border border-border p-4 space-y-1">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Weekly ramp rate</p>
            {rampRate !== null ? (
              <>
                <p className="text-2xl font-semibold font-mono"
                  style={{ color: Math.abs(rampRate) > 10 ? "#F87171" : rampRate > 0 ? "#6EE7B7" : "#94A3B8" }}>
                  {rampRate > 0 ? "+" : ""}{rampRate}%
                </p>
                {Math.abs(rampRate) > 10 && (
                  <p className="text-[10px] text-error">⚠ High — elevated injury risk</p>
                )}
              </>
            ) : <p className="text-sm text-muted">—</p>}
          </div>

          {injuryRisk !== null && (
            <div className="rounded-xl border border-border p-4 space-y-1">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Injury risk</p>
              <p className="text-2xl font-semibold font-mono"
                style={{ color: injuryRisk >= 50 ? "#F87171" : injuryRisk >= 25 ? "#FBBF24" : "#6EE7B7" }}>
                {injuryRisk}/100
              </p>
              <p className="text-[10px] text-muted">ACWR + ramp rate composite</p>
            </div>
          )}

          <div className="rounded-xl border border-border p-4 space-y-1">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Active streak</p>
            <p className="text-2xl font-semibold font-mono text-primary">{activeStreak}</p>
            <p className="text-[10px] text-muted">consecutive days</p>
          </div>

          {tempSensitivity !== null && (
            <div className="rounded-xl border border-border p-4 space-y-1">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Heat impact (easy runs)</p>
              <p className="text-xl font-semibold font-mono" style={{ color: tempSensitivity > 5 ? "#F87171" : "#94A3B8" }}>
                {tempSensitivity > 0 ? "+" : ""}{tempSensitivity}s/km
              </p>
              <p className="text-[10px] text-muted">per 5°C above 15°C</p>
            </div>
          )}
        </div>
      </div>

      <WeatherProfileCard weatherStats={weatherStats} />

      <Card title="Aerobic pace trend" tip={tooltips.easyPaceTrend}>
        {easyPaceTrend.length >= 3
          ? <EasyPaceTrendChart data={easyPaceTrend} />
          : <p className="text-xs text-muted py-4 text-center">No data available yet.</p>
        }
      </Card>

      {cadenceScatter.length > 0 && (
        <Card title="Cadence & stride length vs. pace">
          <div className="text-sm text-muted mb-3">
            Hastighet = Kadens × Stegländ — visas mot pace, inte tid, eftersom veckovariation
            annars bara speglar vilken blandning av pass som kördes den veckan.
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Kadens (spm)</p>
              <CadenceStrideScatterChart data={cadenceScatter} metric="spm" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Steglängd (m)</p>
              <CadenceStrideScatterChart data={cadenceScatter} metric="strideM" />
            </div>
          </div>
        </Card>
      )}

      {efByWeek.length > 4 && (
        <Card title="Efficiency Factor (EF) — aerobic efficiency">
          <div className="text-xs text-muted mb-3">
            EF = speed (m/min) / HR — easy runs last 16 weeks.
            Rising EF = improved aerobic efficiency. 1.35–1.55 = well-trained.
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={efByWeek} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(efByWeek.length / 8) - 1)}
                tickFormatter={(w: string) => w.slice(5)} />
              <YAxis domain={['auto', 'auto']} width={42} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [v.toFixed(3), 'EF']}
                labelFormatter={(w: string) => `Vecka ${w}`}
              />
              <Line type="monotone" dataKey="ef" stroke="#6EE7B7" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          {efByWeek.length >= 8 && (() => {
            const recent = efByWeek.slice(-4).reduce((s, v) => s + v.ef, 0) / 4;
            const older = efByWeek.slice(-8, -4).reduce((s, v) => s + v.ef, 0) / 4;
            const delta = ((recent - older) / older * 100);
            return (
              <p className="text-xs text-muted mt-2">
                Last 4 weeks: <span className="font-mono font-semibold text-primary">{recent.toFixed(3)}</span>
                {' '}{delta >= 0 ? '↑' : '↓'} <span className={delta >= 0 ? 'text-accent' : 'text-warning'}>{Math.abs(delta).toFixed(1)}%</span> vs 4–8 weeks ago
              </p>
            );
          })()}
        </Card>
      )}

      <Card title="VO2max development" tip={tooltips.vo2maxTrend}>
        <VO2maxTrendChart data={vdotTrend} />
      </Card>

      <Card title="LT/AT pace development" tip={tooltips.ltPaceTrend}>
        <LTPaceTrendChart data={ltPaceTrend} currentLT1={currentLT1Pace} currentLT2={currentLT2Pace} />
      </Card>

      <TerrainFactorCard tf={terrainFactor} />
    </div>
  );
}

function WeatherProfileCard({ weatherStats }: { weatherStats: WeatherStats | null }) {
  const hasAnyData = weatherStats && (
    weatherStats.tempScatter.length > 0 ||
    weatherStats.windScatter.length > 0
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

      {weatherStats!.tempScatter.length >= 8 && (
        <WeatherPaceScatterChart data={weatherStats!.tempScatter} xLabel="Temperatur" xUnit="°C" color="#FBBF24" />
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

      {weatherStats!.windScatter.length >= 8 && (
        <WeatherPaceScatterChart data={weatherStats!.windScatter} xLabel="Vind" xUnit=" km/h" color="#60A5FA" />
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
          <p className="text-2xl font-semibold font-mono text-primary">{roadMM}:{String(roadSS).padStart(2, "0")}</p>
          <p className="text-[10px] text-muted">{tf.roadSessions} sessions (at moderate HR)</p>
        </div>
        <div>
          <p className="text-xs text-muted">Orienteering avg pace</p>
          <p className="text-2xl font-semibold font-mono text-primary">{olMM}:{String(olSS).padStart(2, "0")}</p>
          <p className="text-[10px] text-muted">{tf.olSessions} sessions</p>
        </div>
      </div>
      <p className="text-xs text-muted">
        Terrain cost: <span className="font-semibold text-warning">+{diff}s/km (+{pct}%)</span> slower in orienteering terrain vs road at similar effort.
      </p>
    </div>
  );
}
