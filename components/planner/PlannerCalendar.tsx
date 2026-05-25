"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, AlignJustify, PanelLeft } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  isBefore, addMonths, subMonths,
} from "date-fns";
import { WorkoutPill } from "./WorkoutPill";
import { WeekSummaryStrip } from "./WeekSummaryStrip";
import type { PlannedWorkout, TrainingBlock } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

type SummaryLayout = "row" | "sidebar";
const PREF_KEY = "planner_summary_layout";

interface Props {
  workouts: PlannedWorkout[];
  blocks: TrainingBlock[];
  onDayClick: (date: string) => void;
  onWorkoutClick: (workout: PlannedWorkout) => void;
  onTemplateDrop?: (templateId: string, date: string) => void;
  onWorkoutMove?: (workoutId: string, newDate: string) => void;
  weekRunActivities?: { date: string; distanceM: number }[];
}

export function PlannerCalendar({ workouts, blocks, onDayClick, onWorkoutClick, onTemplateDrop, onWorkoutMove, weekRunActivities = [] }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [summaryLayout, setSummaryLayout] = useState<SummaryLayout>("row");
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Persist layout preference
  useEffect(() => {
    const saved = localStorage.getItem(PREF_KEY) as SummaryLayout | null;
    if (saved === "sidebar" || saved === "row") setSummaryLayout(saved);
  }, []);

  function toggleLayout() {
    const next: SummaryLayout = summaryLayout === "row" ? "sidebar" : "row";
    setSummaryLayout(next);
    localStorage.setItem(PREF_KEY, next);
  }

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Group workouts by date string
  const byDate = useMemo(() => {
    const map = new Map<string, PlannedWorkout[]>();
    for (const w of workouts) {
      const key = w.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return map;
  }, [workouts]);

  // Pre-build a date→block map so blockForDate is O(1) per render
  const blockByDate = useMemo(() => {
    const map = new Map<string, TrainingBlock>();
    for (const b of blocks) {
      if (b.archived) continue;
      // Walk every day in the block range and map it
      const start = new Date(b.startDate + "T00:00:00");
      const end   = new Date(b.endDate   + "T00:00:00");
      const cursor = new Date(start);
      while (cursor <= end) {
        map.set(format(cursor, "yyyy-MM-dd"), b);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [blocks]);

  function blockForDate(date: Date): TrainingBlock | undefined {
    return blockByDate.get(format(date, "yyyy-MM-dd"));
  }

  // Group days into weeks for the summary strip
  const weeks = useMemo(() => {
    const ws: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) ws.push(days.slice(i, i + 7));
    return ws;
  }, [days]);

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-1 pb-3">
        <button onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-primary">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          {/* Layout toggle */}
          <button
            onClick={toggleLayout}
            title={summaryLayout === "row" ? "Switch to sidebar view" : "Switch to row view"}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
          >
            {summaryLayout === "row" ? <PanelLeft size={16} /> : <AlignJustify size={16} />}
          </button>
          <button onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className={cn(
        "mb-1 gap-x-1",
        summaryLayout === "sidebar" ? "grid grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr_1fr]" : "grid grid-cols-7"
      )}>
        {summaryLayout === "sidebar" && <div />}
        {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {weeks.map((week, wi) => {
          const weekStart = week[0];
          const weekWorkouts = week.flatMap(d => byDate.get(format(d, "yyyy-MM-dd")) ?? []);
          const weekBlock = blockForDate(weekStart);

          // sidebar mode: [summary col | 7 day cols]
          const isSidebar = summaryLayout === "sidebar";

          return (
            <div key={wi} className="space-y-1">
              <div className={cn(
                "gap-x-1",
                isSidebar ? "grid grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr_1fr]" : "grid grid-cols-7"
              )}>
                {/* Sidebar summary column */}
                {isSidebar && (
                  <div className="flex items-stretch">
                    {weekWorkouts.length > 0 ? (
                      <WeekSummaryStrip
                        weekStart={weekStart}
                        workouts={weekWorkouts}
                        block={weekBlock}
                        compact
                      />
                    ) : <div className="w-full" />}
                  </div>
                )}

                {/* Day cells */}
                {week.map(day => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayWorkouts = byDate.get(key) ?? [];
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isPast = key <= today; // today counts as past — shows outcome modal, not editor
                  const blockHere = blockForDate(day);

                  const isDragOver = dragOverDate === key;

                  return (
                    <div
                      key={key}
                      onClick={() => onDayClick(key)}
                      onDragOver={e => { if (isPast) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverDate(key); }}
                      onDragLeave={() => setDragOverDate(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverDate(null);
                        if (isPast) return;
                        const templateId = e.dataTransfer.getData("templateId");
                        const workoutId  = e.dataTransfer.getData("workoutId");
                        if (workoutId && onWorkoutMove) onWorkoutMove(workoutId, key);
                        else if (templateId && onTemplateDrop) onTemplateDrop(templateId, key);
                      }}
                      className={cn(
                        "min-h-[88px] rounded-xl p-1.5 cursor-pointer border transition-colors",
                        isDragOver
                          ? "border-accent bg-accent/10"
                          : isToday(day)
                          ? "border-accent/50 bg-accent/5"
                          : "border-transparent hover:border-border hover:bg-surface",
                        !isCurrentMonth && "opacity-35"
                      )}
                      style={blockHere && !isDragOver ? { backgroundColor: `${blockHere.color}0D` } : undefined}
                    >
                      {/* Day number */}
                      <div className="mb-1">
                        <span className={cn(
                          "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full",
                          isToday(day) ? "bg-accent text-white" : isPast ? "text-muted" : "text-primary"
                        )}>
                          {format(day, "d")}
                        </span>
                      </div>

                      {/* Workouts — show up to 5, compact when >3 */}
                      <div className="space-y-0.5">
                        {dayWorkouts.slice(0, 5).map(w => (
                          <WorkoutPill
                            key={w.id}
                            workout={w}
                            isPast={isPast}
                            onClick={onWorkoutClick}
                            compact={dayWorkouts.length > 3}
                          />
                        ))}
                        {dayWorkouts.length > 5 && (
                          <p className="text-xs text-muted pl-1">+{dayWorkouts.length - 5}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Row mode: full-width summary below */}
              {!isSidebar && weekWorkouts.length > 0 && (
                <WeekSummaryStrip
                  weekStart={weekStart}
                  workouts={weekWorkouts}
                  block={weekBlock}
                  weekRunActivities={weekRunActivities}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
