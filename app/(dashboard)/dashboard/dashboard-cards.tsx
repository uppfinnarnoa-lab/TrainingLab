"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";

interface SportData { km: number; sec: number; count: number }
interface Props {
  all: { week: SportData; month: SportData; ytd: SportData };
  run: { week: SportData; month: SportData; ytd: SportData; onPaceKm: number; lyYtdKm: number };
  fitnessLabel: string | null;
  fitnessPrimary: string;
  fitnessSub: string;
}

function fmt(m: number) { return `${(m / 1000).toFixed(0)} km`; }

export function DashboardCards({ all, run, fitnessLabel, fitnessPrimary, fitnessSub }: Props) {
  const [mode, setMode] = useState<"all" | "run">("all");
  const d = mode === "run" ? run : all;

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          {(["all", "run"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn("px-3 py-1 rounded-md transition-colors",
                mode === m ? "bg-accent/10 text-accent" : "text-muted hover:text-primary"
              )}>
              {m === "all" ? "All sports" : "Running"}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* This week */}
        <StatCard label="This week"
          primary={d.week.km > 0 ? fmt(d.week.km * 1000) : "—"}
          sub={d.week.km > 0 ? `${formatDuration(d.week.sec)} · ${d.week.count} sessions` : "No activities yet"} />

        {/* This month */}
        <StatCard label="This month"
          primary={d.month.km > 0 ? fmt(d.month.km * 1000) : "—"}
          sub={d.month.km > 0 ? formatDuration(d.month.sec) : "Sync Strava to see data"} />

        {/* YTD */}
        <StatCard label="Year to date"
          primary={d.ytd.km > 0 ? fmt(d.ytd.km * 1000) : "—"}
          sub={d.ytd.km > 0 ? formatDuration(d.ytd.sec) : "Sync Strava to see data"}
          detail={mode === "run" && d.ytd.km > 0 ? `${d.ytd.count} runs` : undefined}
          onPace={mode === "run" && run.onPaceKm > 0 ? `On pace for ${run.onPaceKm.toLocaleString()} km` : undefined}
          lyYtd={mode === "run" && run.lyYtdKm > 0 ? `vs ${run.lyYtdKm.toLocaleString()} km last year` : undefined}
          accent />

        {/* Fitness */}
        <StatCard label={fitnessLabel ?? "Activities synced"} primary={fitnessPrimary} sub={fitnessSub} />
      </div>
    </div>
  );
}

function StatCard({ label, primary, sub, detail, onPace, lyYtd, accent }: {
  label: string; primary: string; sub: string;
  detail?: string; onPace?: string; lyYtd?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl bg-surface border p-4 shadow-sm ${accent ? "border-accent/30" : "border-border"}`}>
      <p className="text-xs font-medium text-muted uppercase tracking-wide">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold font-mono text-primary leading-none">{primary}</p>
      <p className="text-xs text-muted mt-1">{sub}</p>
      {detail && (
        <p className="flex items-center gap-1 text-xs text-accent mt-1.5 font-medium">
          <Activity size={11} />{detail}
        </p>
      )}
      {onPace && (
        <p className="text-xs text-accent mt-1 font-medium">{onPace}</p>
      )}
      {lyYtd && (
        <p className="text-xs text-muted mt-0.5">{lyYtd}</p>
      )}
    </div>
  );
}
