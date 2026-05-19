"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  addMonths, subMonths, parseISO,
} from "date-fns";
import { formatDistance, formatDuration, sportColor } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Activity {
  id: string; name: string; description: string | null;
  sportType: string; startDate: string;
  distance: number; movingTime: number;
  totalElevationGain: number; averageHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean; weatherTemp: number | null;
}

export function HistoryClient({ activities }: { activities: Activity[] }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<Activity[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
      <div className="flex items-center justify-between">
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
      <div className="grid grid-cols-7 mb-1">
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
                "relative min-h-[72px] rounded-xl p-1.5 text-left transition-all border",
                isSelected
                  ? "border-accent bg-accent/5"
                  : acts.length > 0
                  ? "border-border hover:border-accent/40 hover:bg-surface"
                  : "border-transparent hover:border-border",
                !inMonth && "opacity-30"
              )}
            >
              {/* Day number */}
              <span className={cn(
                "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mb-1",
                isToday(day) ? "bg-accent text-white" : "text-muted"
              )}>
                {format(day, "d")}
              </span>

              {/* Activity dots / pills */}
              <div className="space-y-0.5">
                {acts.slice(0, 2).map(a => (
                  <div
                    key={a.id}
                    className="h-1.5 rounded-full w-full"
                    style={{ backgroundColor: sportColor(a.sportType) }}
                    title={a.name}
                  />
                ))}
                {acts.length > 2 && (
                  <p className="text-[9px] text-muted">+{acts.length - 2}</p>
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
            selected.map(a => (
              <div
                key={a.id}
                className="rounded-xl border border-border p-4"
                style={{ borderLeftWidth: 3, borderLeftColor: sportColor(a.sportType) }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-primary">{a.name}</span>
                      {a.isRace && <Trophy size={13} className="text-warning" />}
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: `${sportColor(a.sportType)}20`, color: sportColor(a.sportType) }}
                    >
                      {a.sportType.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    {a.description && (
                      <p className="mt-1.5 text-xs text-muted line-clamp-3">{a.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1 text-xs font-mono">
                    <p className="text-primary font-semibold">{formatDistance(a.distance)}</p>
                    <p className="text-muted">{formatDuration(a.movingTime)}</p>
                    {a.averageHeartrate && <p className="text-muted">{Math.round(a.averageHeartrate)} bpm</p>}
                    {a.weatherTemp !== null && <p className="text-muted">{Math.round(a.weatherTemp)}°C</p>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
