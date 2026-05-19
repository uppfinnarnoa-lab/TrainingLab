"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  isBefore, addMonths, subMonths,
} from "date-fns";
import { WorkoutPill } from "./WorkoutPill";
import { WeekSummaryStrip } from "./WeekSummaryStrip";
import type { PlannedWorkout, TrainingBlock } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

interface Props {
  workouts: PlannedWorkout[];
  blocks: TrainingBlock[];
  onDayClick: (date: string) => void;
  onWorkoutClick: (workout: PlannedWorkout) => void;
}

export function PlannerCalendar({ workouts, blocks, onDayClick, onWorkoutClick }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

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
        <button onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] mb-1">
        <div /> {/* week strip column */}
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {weeks.map((week, wi) => {
          const weekStart = week[0];
          const weekWorkouts = week.flatMap(d => byDate.get(format(d, "yyyy-MM-dd")) ?? []);
          const weekBlock = blockForDate(weekStart);

          return (
            <div key={wi} className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-1">
              {/* Week summary strip */}
              <div className="flex flex-col justify-start pt-1">
                <WeekSummaryStrip
                  weekStart={weekStart}
                  workouts={weekWorkouts}
                  block={weekBlock}
                />
              </div>

              {/* Day cells */}
              {week.map(day => {
                const key = format(day, "yyyy-MM-dd");
                const dayWorkouts = byDate.get(key) ?? [];
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isPast = isBefore(day, new Date()) && key !== today;
                const blockHere = blockForDate(day);

                return (
                  <div
                    key={key}
                    onClick={() => onDayClick(key)}
                    className={cn(
                      "min-h-[90px] rounded-xl p-1.5 cursor-pointer border transition-colors",
                      isToday(day)
                        ? "border-accent/50 bg-accent/5"
                        : "border-transparent hover:border-border hover:bg-surface",
                      !isCurrentMonth && "opacity-40"
                    )}
                    style={blockHere ? {
                      backgroundColor: `${blockHere.color}0D`, // 5% opacity
                    } : undefined}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn(
                        "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full",
                        isToday(day) ? "bg-accent text-white" : isPast ? "text-muted" : "text-primary"
                      )}>
                        {format(day, "d")}
                      </span>
                    </div>

                    {/* Workouts */}
                    <div className="space-y-0.5">
                      {dayWorkouts.slice(0, 3).map(w => (
                        <WorkoutPill
                          key={w.id}
                          workout={w}
                          isPast={isPast}
                          onClick={onWorkoutClick}
                        />
                      ))}
                      {dayWorkouts.length > 3 && (
                        <p className="text-xs text-muted pl-1">+{dayWorkouts.length - 3} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
