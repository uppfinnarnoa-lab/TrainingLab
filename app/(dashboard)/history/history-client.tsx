"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Trophy } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  addMonths, subMonths, parseISO,
} from "date-fns";
import { formatDistance, formatDuration, formatPace } from "@/lib/utils";
import { resolveActivityColor } from "@/lib/planner/colors";
import type { SportCategory } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import { TypePicker } from "@/components/activity/TypePicker";

interface Activity {
  id: string; name: string; description: string | null;
  sportType: string; startDate: string;
  distance: number; movingTime: number;
  totalElevationGain: number; averageHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; weatherTemp: number | null;
  stravaId: string; hasLaps: boolean;
  workoutType: number | null; customTypeName: string | null;
}

function ActivityPill({ a, customTypeName, sportCategories }: { a: Activity; customTypeName: string | null; sportCategories: SportCategory[] }) {
  const color = resolveActivityColor(sportCategories, a.sportType, a.isRace, a.workoutType, customTypeName, a.name);
  return (
    <div
      className="rounded px-1 py-0.5 text-[9px] font-medium leading-tight flex items-center gap-0.5 min-w-0"
      style={{ backgroundColor: a.hasLaps ? `${color}20` : "#94A3B820", color: a.hasLaps ? color : "#94A3B8" }}
      title={a.hasLaps ? a.name : `${a.name} — missing lap data (not yet backfilled)`}
    >
      {a.isRace && "🏆 "}
      <span className="truncate">{a.name}</span>
      {a.distance > 0 && <span className="shrink-0 opacity-70"> {Math.round(a.distance / 100) / 10}k</span>}
      {!a.hasLaps && <span className="shrink-0 ml-0.5 text-[8px] border border-current rounded px-0.5 opacity-70">!</span>}
    </div>
  );
}

export function HistoryClient({ activities, sportCategories }: { activities: Activity[]; sportCategories: SportCategory[] }) {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<Activity[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Track custom type overrides locally so color updates immediately on change
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string | null>>({});
  function getTypeName(a: Activity) { return a.id in typeOverrides ? typeOverrides[a.id] : a.customTypeName; }
  function updateType(id: string, v: string | null) { setTypeOverrides(prev => ({ ...prev, [id]: v })); }

  const byDate = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of activities) {
      const key = a.startDate.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [activities]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  function selectDay(date: Date) {
    const key = format(date, "yyyy-MM-dd");
    const acts = byDate.get(key);
    setSelectedDate(key);
    setSelected(acts ?? null);
  }

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between px-1">
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
      <div className="grid grid-cols-7 mb-1 gap-x-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const key = format(day, "yyyy-MM-dd");
          const acts = byDate.get(key) ?? [];
          const inMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDate === key;

          return (
            <button
              key={key}
              onClick={() => selectDay(day)}
              className={cn(
                "min-h-[88px] rounded-xl p-1.5 text-left transition-colors border cursor-pointer",
                isSelected
                  ? "border-accent bg-accent/5"
                  : isToday(day)
                  ? "border-accent/50 bg-accent/5"
                  : acts.length > 0
                  ? "border-border hover:border-accent/40 hover:bg-surface"
                  : "border-transparent hover:border-border hover:bg-surface",
                !inMonth && "opacity-35"
              )}
            >
              {/* Day number */}
              <div className="mb-1">
                <span className={cn(
                  "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full",
                  isToday(day) ? "bg-accent text-white" : "text-muted"
                )}>
                  {format(day, "d")}
                </span>
              </div>

              {/* Activity pills */}
              <div className="space-y-0.5">
                {acts.slice(0, 4).map(a => (
                  <ActivityPill key={a.id} a={a} customTypeName={getTypeName(a)} sportCategories={sportCategories} />
                ))}
                {acts.length > 4 && (
                  <p className="text-[9px] text-muted pl-0.5">+{acts.length - 4}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selected !== null && (
        <div className="rounded-2xl bg-surface border border-border p-5 space-y-3">
          <p className="text-sm font-semibold text-primary">
            {selectedDate ? format(parseISO(selectedDate), "EEEE d MMMM yyyy") : ""}
          </p>
          {selected.length === 0 ? (
            <p className="text-sm text-muted">No activities on this day.</p>
          ) : (
            selected.map(a => {
              const color = resolveActivityColor(sportCategories, a.sportType, a.isRace, a.workoutType, getTypeName(a), a.name);
              const cardColor = a.hasLaps ? color : "#94A3B8";
              return (
              <div
                key={a.id}
                onClick={() => router.push(`/activities/${a.id}`)}
                className="relative rounded-xl border border-border p-4 hover:border-accent/40 hover:bg-surface-2 transition-colors cursor-pointer"
                style={{ borderLeftWidth: 3, borderLeftColor: cardColor }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-primary truncate">{a.name}</span>
                      {a.isRace && <Trophy size={13} className="text-warning shrink-0" />}
                      {!a.hasLaps && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-surface-2 text-muted border border-border shrink-0">
                          no laps
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${cardColor}20`, color: cardColor }}
                      >
                        {a.sportType.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <TypePicker
                        activityId={a.id}
                        sportType={a.sportType}
                        isRace={a.isRace}
                        workoutType={a.workoutType}
                        customTypeName={getTypeName(a)}
                        onUpdate={v => updateType(a.id, v)}
                        size="xs"
                      />
                    </div>
                    {a.description && (
                      <p className="mt-1.5 text-xs text-muted line-clamp-3">{a.description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="text-right space-y-0.5 text-xs font-mono">
                      {a.distance > 0 && <p className="text-primary font-semibold">{formatDistance(a.distance)}</p>}
                      <p className="text-muted">{formatDuration(a.movingTime)}</p>
                      {a.averageSpeed && <p className="text-muted">{formatPace(a.averageSpeed)}</p>}
                      {a.averageHeartrate && <p className="text-muted">{Math.round(a.averageHeartrate)} bpm</p>}
                      {a.weatherTemp !== null && <p className="text-muted">{Math.round(a.weatherTemp)}°C</p>}
                    </div>
                    <a
                      href={`https://www.strava.com/activities/${a.stravaId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-muted hover:text-accent transition"
                      title="View on Strava"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })
          )}
        </div>
      )}
    </div>
  );
}
