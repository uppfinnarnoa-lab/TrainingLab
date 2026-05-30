import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trophy, Thermometer, Mountain, Heart, Zap } from "lucide-react";
import { format } from "date-fns";
import { formatDuration, formatDistance, formatPace } from "@/lib/utils";
import { workoutColor } from "@/lib/planner/colors";
import { ActivityMap } from "./activity-map";
import { SplitsTable } from "./splits-table";
import { SplitsChart } from "./splits-chart";
import { ActivityCharts } from "./activity-charts";
import { BestEffortsTable } from "./best-efforts";
import { WorkoutAnalysis } from "./workout-analysis";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id },
    select: {
      id: true, userId: true, stravaId: true,
      name: true, description: true, sportType: true,
      startDate: true, startDateLocal: true, timezone: true,
      distance: true, movingTime: true, elapsedTime: true,
      totalElevationGain: true, averageSpeed: true, maxSpeed: true,
      averageHeartrate: true, maxHeartrate: true, averageCadence: true,
      sufferScore: true, isRace: true, mapPolyline: true,
      splitsMetric: true, laps: true, bestEfforts: true,
      weatherTemp: true, weatherWind: true, weatherCode: true,
      workoutType: true,
    },
  });

  if (!activity || activity.userId !== userId) notFound();

  const color = activity.isRace ? "#FBBF24" : workoutColor(activity.sportType, null);
  const pace = activity.averageSpeed ? formatPace(activity.averageSpeed) : null;
  interface LapRaw {
    lap_index: number;
    distance: number;
    moving_time: number;
    average_speed: number;
    average_heartrate?: number;
    total_elevation_gain?: number;
  }

  interface BestEffortRaw { name: string; distance: number; elapsed_time: number }

  const lapsRaw = activity.laps as LapRaw[] | null;
  const splitsRaw = activity.splitsMetric as Split[] | null;
  const bestEffortsRaw = (activity.bestEfforts as BestEffortRaw[] | null) ?? [];

  // Prefer imported Strava laps (manual lap presses); fall back to auto km-splits
  const isLaps = !!(lapsRaw && lapsRaw.length >= 2);
  const splits: Split[] | null = isLaps
    ? lapsRaw!.map(l => ({
        split: l.lap_index,
        distance: l.distance,
        moving_time: l.moving_time,
        average_speed: l.average_speed,
        average_heartrate: l.average_heartrate,
        elevation_difference: l.total_elevation_gain,
      }))
    : splitsRaw;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back */}
      <Link href="/activities"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition">
        <ChevronLeft size={16} />Back to activities
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-start gap-3">
          <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: color }} />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-primary">{activity.name}</h1>
              {activity.isRace && <Trophy size={18} className="text-warning shrink-0" />}
            </div>
            <p className="text-sm text-muted mt-0.5">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: `${color}20`, color }}>
                {activity.sportType.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="ml-2">
                {format(activity.startDateLocal, "EEEE d MMMM yyyy · HH:mm")}
              </span>
            </p>
          </div>
          <a href={`https://www.strava.com/activities/${activity.stravaId}`}
            target="_blank" rel="noopener noreferrer"
            className="shrink-0 text-xs text-muted hover:text-accent transition">
            View on Strava →
          </a>
        </div>

        {/* Description / notes */}
        {activity.description && (
          <div className="mt-4 p-4 rounded-xl bg-surface border border-border text-sm text-primary whitespace-pre-wrap leading-relaxed">
            {activity.description}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Distance",    value: formatDistance(activity.distance) },
          { label: "Moving time", value: formatDuration(activity.movingTime) },
          { label: "Avg pace",    value: pace ?? "—" },
          { label: "Elevation",   value: `${Math.round(activity.totalElevationGain)} m` },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-surface border border-border p-4">
            <p className="text-xs text-muted uppercase tracking-wide">{s.label}</p>
            <p className="text-xl font-semibold font-mono text-primary mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* HR + cadence + weather row */}
      <div className="flex flex-wrap gap-3">
        {activity.averageHeartrate && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-sm">
            <Heart size={14} className="text-error" />
            <span className="font-mono text-primary">{Math.round(activity.averageHeartrate)} bpm</span>
            {activity.maxHeartrate && <span className="text-muted">/ {Math.round(activity.maxHeartrate)} max</span>}
          </div>
        )}
        {activity.averageCadence && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-sm">
            <Zap size={14} className="text-accent" />
            <span className="font-mono text-primary">{Math.round(activity.averageCadence * 2)} spm</span>
          </div>
        )}
        {activity.sufferScore && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-sm">
            <Mountain size={14} className="text-warning" />
            <span className="text-muted">Suffer:</span>
            <span className="font-mono text-primary">{activity.sufferScore}</span>
          </div>
        )}
        {activity.weatherTemp != null && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-sm">
            <Thermometer size={14} className="text-muted" />
            <span className="font-mono text-primary">{Math.round(activity.weatherTemp)}°C</span>
            {activity.weatherWind && <span className="text-muted">{Math.round(activity.weatherWind)} km/h wind</span>}
          </div>
        )}
      </div>

      {/* GPS Map */}
      {activity.mapPolyline && (
        <div className="rounded-2xl overflow-hidden border border-border" style={{ height: 320 }}>
          <ActivityMap polyline={activity.mapPolyline} color={color} />
        </div>
      )}

      {/* Pace / HR / elevation charts from Strava streams */}
      <div className="rounded-2xl bg-surface border border-border p-5 space-y-1">
        <p className="text-sm font-semibold text-primary mb-3">Performance charts</p>
        <ActivityCharts activityId={activity.id} />
      </div>

      {/* Splits chart */}
      {splits && splits.length > 1 && (
        <div className="rounded-2xl bg-surface border border-border p-5">
          <SplitsChart splits={splits} avgSpeedMs={activity.averageSpeed ?? 0} isLaps={isLaps} />
        </div>
      )}

      {/* Splits table */}
      {splits && splits.length > 0 && (
        <SplitsTable splits={splits} isLaps={isLaps} />
      )}

      {/* Best efforts */}
      {bestEffortsRaw.length > 0 && (
        <BestEffortsTable bestEfforts={bestEffortsRaw} />
      )}

      {/* Workout analysis — only for Strava workoutType=3 (interval/tempo sessions) */}
      {activity.workoutType === 3 && (
        <WorkoutAnalysis
          activity={{
            id: activity.id,
            averageSpeed: activity.averageSpeed,
            averageHeartrate: activity.averageHeartrate,
            maxHeartrate: activity.maxHeartrate,
          }}
          splits={splits}
        />
      )}
    </div>
  );
}

interface Split {
  distance: number;
  elapsed_time?: number;
  moving_time: number;
  average_heartrate?: number;
  average_speed: number;
  elevation_difference?: number;
  split: number;
}
