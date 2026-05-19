"use client";

import { cn } from "@/lib/utils";
import { MetricTooltip } from "./metric-tooltip";
import { tooltips } from "@/lib/fitness/tooltips";
import { secPerKmToPaceStr, secToTimeStr, RACE_DISTANCES } from "@/lib/fitness/paces";
import type { PaceZones } from "@/lib/fitness/zones";
import type { VO2maxEstimate } from "@/lib/fitness/vo2max";
import type { DailyLoad } from "@/lib/fitness/training-load";
import { tsbLabel } from "@/lib/fitness/training-load";

interface RacePred { label: string; meters: number; peak: number; today: number }

interface Props {
  vo2max: VO2maxEstimate;
  paceZones: PaceZones;
  todayLoad: DailyLoad;
  predictions: RacePred[];
}

export function FitnessMetrics({ vo2max, paceZones, todayLoad, predictions }: Props) {
  const form = tsbLabel(todayLoad.tsb);

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
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Peak fitness</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Today (TSB {todayLoad.tsb > 0 ? "+" : ""}{todayLoad.tsb.toFixed(0)})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {predictions.map(p => (
                <tr key={p.label} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-primary">{p.label}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-primary">{secToTimeStr(p.peak)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted">{secToTimeStr(p.today)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2">
          Peak fitness assumes full taper (TSB +15). Today&apos;s column reflects current fatigue.
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

