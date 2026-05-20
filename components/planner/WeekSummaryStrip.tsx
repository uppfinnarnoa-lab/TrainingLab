"use client";

import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { ZoneBar } from "./ZoneBar";
import type { PlannedWorkout, TrainingBlock } from "@/lib/planner/types";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  weekStart: Date;
  workouts: PlannedWorkout[];
  block?: TrainingBlock;
  onClick?: () => void;
  compact?: boolean; // sidebar mode: vertical stack instead of horizontal row
  weekRunActivities?: { date: string; distanceM: number }[]; // actual Strava activities this week
}

export function WeekSummaryStrip({ weekStart, workouts, block, onClick, compact, weekRunActivities = [] }: Props) {
  const router = useRouter();

  function handleClick() {
    if (onClick) { onClick(); return; }
    router.push(`/planner/week?date=${format(weekStart, "yyyy-MM-dd")}`);
  }

  // Aggregate
  const bySport: Record<string, { km: number; timeSec: number }> = {};
  const totalZones: Record<string, number> = {};
  let completed = 0, missed = 0;

  for (const w of workouts) {
    const sport = w.sportType;
    if (!bySport[sport]) bySport[sport] = { km: 0, timeSec: 0 };
    if (w.targetDistance) bySport[sport].km += w.targetDistance / 1000;
    if (w.targetDuration) bySport[sport].timeSec += w.targetDuration;

    const zoneDist = w.template?.estimatedZoneDistribution as Record<string, number> | null;
    if (zoneDist) {
      for (const [z, v] of Object.entries(zoneDist)) {
        totalZones[z] = (totalZones[z] ?? 0) + v;
      }
    }
    if (w.status === "completed" || w.status === "partial") completed++;
    if (w.status === "missed") missed++;
  }

  const totalKm  = Object.values(bySport).reduce((s, v) => s + v.km, 0);
  const totalSec = Object.values(bySport).reduce((s, v) => s + v.timeSec, 0);
  const hasZones = Object.values(totalZones).some(v => v > 0);
  const today    = format(new Date(), "yyyy-MM-dd");
  const isPast   = workouts.some(w => w.date < today);

  // ── Predicted weekly run distance ─────────────────────────────────────
  // Only compute for the current week (weekActivities are only fetched for current week)
  const weekEnd = format(addDays(weekStart, 6), "yyyy-MM-dd");
  const isCurrentWeek = weekRunActivities.length > 0 ||
    (today >= format(weekStart, "yyyy-MM-dd") && today <= weekEnd);

  let predictedRunKm: number | null = null;
  if (isCurrentWeek) {
    // Build a map of days that already have actual Strava runs
    const actualByDate = new Map<string, number>();
    for (const a of weekRunActivities) {
      actualByDate.set(a.date, (actualByDate.get(a.date) ?? 0) + a.distanceM / 1000);
    }

    let pred = 0;
    // Sum actual running km done so far this week
    for (const [, km] of actualByDate) pred += km;

    // Add planned running km for days without actual activities (today + future)
    const runningWorkouts = workouts.filter(w =>
      /run|trail|virtual/i.test(w.sportType) && w.date >= today
    );
    for (const w of runningWorkouts) {
      if (!actualByDate.has(w.date) && w.targetDistance) {
        pred += w.targetDistance / 1000;
      }
    }

    if (pred > 0) predictedRunKm = Math.round(pred * 10) / 10;
  }
  const topSports = Object.entries(bySport)
    .sort((a, b) => b[1].timeSec - a[1].timeSec)
    .slice(0, 3);

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-xl border transition-all",
        "hover:border-accent/40 hover:bg-surface-2",
        block ? "border-l-[3px]" : "border-border/50",
        "bg-surface/60"
      )}
      style={block ? { borderLeftColor: block.color } : undefined}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* Block label */}
        {block && (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
            style={{ backgroundColor: block.color }}
          >
            {block.blockType}
          </span>
        )}

        {/* Sport volumes */}
        {topSports.map(([sport, d]) => (
          <span key={sport} className="text-xs text-muted shrink-0">
            <span className="font-semibold text-primary">
              {sport.replace(/([A-Z])/g, " $1").trim().split(" ")[0]}
            </span>
            {d.km > 0 && <span className="font-mono ml-1">{d.km.toFixed(0)}km</span>}
            {d.timeSec > 0 && <span className="ml-1 text-muted">{formatDuration(d.timeSec)}</span>}
          </span>
        ))}

        {/* Total if multiple sports */}
        {topSports.length > 1 && totalSec > 0 && (
          <span className="text-xs text-muted shrink-0">
            · <span className="font-mono">{formatDuration(totalSec)}</span> total
          </span>
        )}

        {/* Zone bar */}
        {hasZones && (
          <div className="flex-1 min-w-[60px]">
            <ZoneBar distribution={totalZones} height={4} />
          </div>
        )}

        {/* Predicted total running distance */}
        {predictedRunKm !== null && (
          <span className="shrink-0 text-xs text-accent font-mono ml-auto" title="Beräknad löpdistans för veckan (gjort + planerat)">
            ~{predictedRunKm}km
          </span>
        )}

        {/* Completion */}
        {isPast && (
          <span className={cn(
            "shrink-0 text-xs font-semibold",
            predictedRunKm !== null ? "" : "ml-auto",
            missed > 0 ? "text-error" : "text-accent"
          )}>
            {completed}/{workouts.length}
          </span>
        )}
      </div>
    </button>
  );
}
