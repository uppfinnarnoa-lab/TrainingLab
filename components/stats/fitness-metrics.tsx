"use client";

"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { MetricTooltip } from "./metric-tooltip";
import { tooltips } from "@/lib/fitness/tooltips";
import { secPerKmToPaceStr, secToTimeStr, RACE_DISTANCES } from "@/lib/fitness/paces";
import type { PaceZones } from "@/lib/fitness/zones";
import type { VO2maxEstimate } from "@/lib/fitness/vo2max";
import type { DailyLoad } from "@/lib/fitness/training-load";
import { tsbLabel } from "@/lib/fitness/training-load";

interface RacePred { label: string; meters: number; peak: number; today: number; riegel: number | null; rangeLo: number; rangeHi: number }

interface Props {
  vo2max: VO2maxEstimate;
  paceZones: PaceZones;
  todayLoad: DailyLoad;
  predictions: RacePred[];
  acwr: number | null;
  modelPredictions?: Record<string, { label: string; meters: number; peak: number }[]>;
  modelVdots?: Record<string, number>;
}

export function FitnessMetrics({ vo2max, paceZones, todayLoad, predictions, acwr, modelPredictions, modelVdots }: Props) {
  const form = tsbLabel(todayLoad.tsb);
  const [selectedModel, setSelectedModel] = useState<string>("Weighted (default)");
  const acwrColor = !acwr ? "#94A3B8" : acwr > 1.5 ? "#F87171" : acwr > 1.3 ? "#FBBF24" : "#6EE7B7";
  const acwrLabel = !acwr ? "—" : acwr > 1.5 ? "Injury risk" : acwr > 1.3 ? "High load" : acwr >= 0.8 ? "Green zone" : "Too low";

  return (
    <div className="space-y-6">
      {/* VO2max + Load row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricBlock
          label="VO2max"
          value={vo2max.value.toFixed(1)}
          unit="ml/kg/min"
          sub={`${vo2max.confidence} confidence · ${vo2max.method}`}
          tip={tooltips.vo2max}
        />
        <MetricBlock label="VDOT" value={vo2max.vdot.toFixed(1)} unit="" tip={tooltips.vdot} />
        <MetricBlock
          label="CTL (fitness)"
          value={todayLoad.ctl.toFixed(0)}
          unit="TSS"
          tip={tooltips.ctl}
        />
        <MetricBlock
          label="Form (TSB)"
          value={todayLoad.tsb.toFixed(0)}
          unit={form.label}
          valueColor={form.color}
          tip={tooltips.tsb}
        />
      </div>

      {/* ACWR card */}
      {acwr !== null && (
        <div className="rounded-xl border border-border p-4 flex items-center gap-6">
          <div>
            <p className="text-xs font-medium text-muted mb-1">ACWR — Load Ratio (7d/28d)</p>
            <p className="text-3xl font-semibold font-mono" style={{ color: acwrColor }}>{acwr.toFixed(2)}</p>
            <p className="text-xs font-medium mt-1" style={{ color: acwrColor }}>{acwrLabel}</p>
          </div>
          <div className="flex-1">
            {/* Simple bar */}
            <div className="relative h-3 rounded-full bg-surface-2 overflow-hidden">
              <div className="absolute h-full rounded-full" style={{ width: `${Math.min(acwr / 2 * 100, 100)}%`, backgroundColor: acwrColor }} />
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>0.8</span><span className="text-accent">1.0</span><span className="text-warning">1.3</span><span className="text-error">1.5+</span>
            </div>
            <p className="text-xs text-muted mt-1">Safe zone: 0.8–1.3. Over 1.5 = elevated injury risk.</p>
          </div>
        </div>
      )}

      {/* Training paces */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Training Paces</h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Zone</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Pace range</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted hidden sm:table-cell">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {([
                ["Easy",        paceZones.easy,       "Build aerobic base with minimal fatigue"],
                ["Marathon",    paceZones.marathon,    "Race pace for marathon distance"],
                ["Threshold",   paceZones.threshold,  "Raise your sustainable speed ceiling"],
                ["Interval",    paceZones.interval,   "Develop VO2max — short hard reps"],
                ["Repetition",  paceZones.repetition, "Speed and economy — very short reps"],
              ] as [string, [number, number], string][]).map(([name, [lo, hi], purpose]) => (
                <tr key={name} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-primary">{name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted">
                    {secPerKmToPaceStr(hi)} – {secPerKmToPaceStr(lo)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted hidden sm:table-cell">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Race predictions */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Race Time Predictions</h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Distance</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">
                  {selectedModel === "Weighted (default)" ? "VDOT (peak form)" : selectedModel}
                </th>
                {selectedModel === "Weighted (default)" && <>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted hidden sm:table-cell">Riegel (from PB)</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Today (TSB {todayLoad.tsb > 0 ? "+" : ""}{todayLoad.tsb.toFixed(0)})</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {selectedModel === "Weighted (default)"
                ? predictions.map(p => (
                  <tr key={p.label} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-primary">{p.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-primary">
                      {secToTimeStr(p.peak)}
                      <span className="text-muted text-[10px] ml-1 hidden sm:inline">±{secToTimeStr(Math.round((p.rangeHi - p.rangeLo) / 2))}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted hidden sm:table-cell">
                      {p.riegel ? secToTimeStr(p.riegel) : "—"}
                      {p.meters >= 42000 && p.riegel && <span className="text-[10px] ml-1 text-warning">+8 min</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted">{secToTimeStr(p.today)}</td>
                  </tr>
                ))
                : (modelPredictions?.[selectedModel] ?? []).map(p => (
                  <tr key={p.label} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-primary">{p.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-primary">{secToTimeStr(p.peak)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>

        {/* Model selector */}
        {modelVdots && Object.keys(modelVdots).length > 1 && (
          <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-medium text-muted">Show predictions from:</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(modelVdots).map(([model, vdot]) => (
                <button
                  key={model}
                  onClick={() => setSelectedModel(model)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                    selectedModel === model
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-muted hover:text-primary hover:border-border"
                  )}
                >
                  {model}
                  <span className="ml-1.5 font-mono text-[10px] opacity-70">{vdot < 2 ? `exp ${vdot.toFixed(3)}` : `VDOT ${vdot}`}</span>
                </button>
              ))}
            </div>
            {selectedModel !== "Weighted (default)" && (
              <p className="text-[10px] text-muted">
                {(modelVdots[selectedModel] ?? 0) < 2
                  ? <>Showing <strong>{selectedModel}</strong> predictions — exponent {(modelVdots[selectedModel] ?? 0).toFixed(3)} based on your weekly running volume.</>
                  : <>Showing raw output from <strong>{selectedModel}</strong> model only — no weighting applied. VDOT {modelVdots[selectedModel]?.toFixed(1)} vs weighted {vo2max.vdot.toFixed(1)}.</>
                }
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted mt-2">
          Default uses weighted average of all available models · Riegel: T₂ = T₁ × (D₂/D₁)¹·⁰⁶
        </p>
      </div>
    </div>
  );
}

function MetricBlock({
  label, value, unit, sub, tip, valueColor,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  tip: typeof tooltips[string];
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-4 space-y-1">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted">{label}</p>
        <MetricTooltip tip={tip} />
      </div>
      <p className={cn("text-2xl font-semibold font-mono", valueColor ? "" : "text-primary")}
        style={valueColor ? { color: valueColor } : undefined}>
        {value}
        {unit && <span className="text-sm font-normal text-muted ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-xs text-muted leading-tight">{sub}</p>}
    </div>
  );
}

