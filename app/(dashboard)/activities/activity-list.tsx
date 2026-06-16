"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Heart, Mountain, Thermometer, Trophy } from "lucide-react";
import { cn, formatDistance, formatDuration, formatPace } from "@/lib/utils";
import { activityColor } from "@/lib/planner/colors";
import { TypePicker } from "@/components/activity/TypePicker";
import { useState } from "react";

interface Activity {
  id: string;
  name: string;
  description: string | null;
  sportType: string;
  startDate: string;
  distance: number;
  movingTime: number;
  totalElevationGain: number;
  averageHeartrate: number | null;
  averageSpeed: number | null;
  isRace: boolean;
  weatherTemp: number | null;
  workoutType: number | null;
  customTypeName: string | null;
}

interface Props {
  activities: Activity[];
  total: number;
  page: number;
  perPage: number;
  sports: string[];
  selectedSport?: string;
  sort: string;
  racesOnly: boolean;
}

export function ActivityList({ activities, total, page, perPage, sports, selectedSport, sort, racesOnly }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string | null>>({});
  function getTypeName(a: Activity) { return a.id in typeOverrides ? typeOverrides[a.id] : a.customTypeName; }
  function updateType(id: string, v: string | null) { setTypeOverrides(prev => ({ ...prev, [id]: v })); }

  function setFilter(sport?: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (sport) p.set("sport", sport);
    else p.delete("sport");
    p.delete("page");
    router.push(`/activities?${p}`);
  }

  function setPage(p: number) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("page", String(p));
    router.push(`/activities?${sp}`);
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      {/* Sort + races filter */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        {/* Left: sort */}
        <select
          value={sort}
          onChange={e => {
            const p = new URLSearchParams(searchParams.toString());
            p.set("sort", e.target.value);
            p.delete("page");
            router.push(`/activities?${p}`);
          }}
          className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
        >
          <option value="date_desc">Newest first</option>
          <option value="dist_desc">Longest distance</option>
          <option value="dist_asc">Shortest distance</option>
          <option value="pace_asc">Fastest pace</option>
          <option value="pace_desc">Slowest pace</option>
        </select>

        {/* Right: races only toggle */}
        <button
          onClick={() => {
            const p = new URLSearchParams(searchParams.toString());
            if (racesOnly) p.delete("racesOnly"); else p.set("racesOnly", "1");
            p.delete("page");
            router.push(`/activities?${p}`);
          }}
          className={cn(
            "text-xs px-3 py-1.5 rounded-lg border transition",
            racesOnly ? "bg-warning/10 border-warning/30 text-warning" : "border-border text-muted hover:text-primary"
          )}
        >
          {racesOnly ? "🏆 Races" : "Races"}
        </button>
      </div>

      {/* Sport filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter()}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium transition",
            !selectedSport
              ? "bg-accent text-white dark:text-background"
              : "bg-surface-2 text-muted hover:text-primary"
          )}
        >
          All
        </button>
        {sports.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition",
              selectedSport === s
                ? "text-white dark:text-background"
                : "bg-surface-2 text-muted hover:text-primary"
            )}
            style={selectedSport === s ? { backgroundColor: activityColor(s, false, null, null) } : {}}
          >
            {s.replace(/([A-Z])/g, " $1").trim()}
          </button>
        ))}
      </div>

      {/* Activity cards */}
      <div className="space-y-2">
        {activities.length === 0 ? (
          <div className="rounded-2xl bg-surface border border-border p-12 text-center">
            <p className="text-muted">No activities found. Sync your Strava account in Settings.</p>
          </div>
        ) : (
          activities.map((activity) => {
            const color = activityColor(activity.sportType, activity.isRace, activity.workoutType, getTypeName(activity));
            return (
            <a
              key={activity.id}
              href={`/activities/${activity.id}`}
              className="block rounded-xl bg-surface border border-border p-4 hover:border-accent/40 transition-colors cursor-pointer group"
              style={{ borderLeftWidth: 3, borderLeftColor: color }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary truncate">
                      {activity.name}
                    </span>
                    {activity.isRace && (
                      <Trophy size={13} className="text-warning shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {activity.sportType.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <TypePicker
                      activityId={activity.id}
                      sportType={activity.sportType}
                      isRace={activity.isRace}
                      workoutType={activity.workoutType}
                      customTypeName={getTypeName(activity)}
                      onUpdate={v => updateType(activity.id, v)}
                      size="xs"
                    />
                    <span className="text-xs text-muted">
                      {format(new Date(activity.startDate), "EEE d MMM yyyy")}
                    </span>
                  </div>
                  {activity.description && (
                    <p className="mt-1.5 text-xs text-muted line-clamp-2">{activity.description}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="shrink-0 flex items-center gap-5 text-right">
                  <div>
                    <p className="text-sm font-semibold font-mono text-primary">
                      {formatDistance(activity.distance)}
                    </p>
                    <p className="text-xs text-muted">distance</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold font-mono text-primary">
                      {formatDuration(activity.movingTime)}
                    </p>
                    <p className="text-xs text-muted">time</p>
                  </div>
                  {activity.averageSpeed && (
                    <div className="hidden sm:block">
                      <p className="text-sm font-semibold font-mono text-primary">
                        {formatPace(activity.averageSpeed)}
                      </p>
                      <p className="text-xs text-muted">pace</p>
                    </div>
                  )}
                  <div className="hidden md:flex flex-col items-end gap-1">
                    {activity.totalElevationGain > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Mountain size={11} />
                        {Math.round(activity.totalElevationGain)}m
                      </span>
                    )}
                    {activity.averageHeartrate && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Heart size={11} />
                        {Math.round(activity.averageHeartrate)} bpm
                      </span>
                    )}
                    {activity.weatherTemp !== null && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Thermometer size={11} />
                        {Math.round(activity.weatherTemp)}°C
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </a>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted">
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-primary disabled:opacity-30 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-primary disabled:opacity-30 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
