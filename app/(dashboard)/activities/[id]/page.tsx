import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Trophy, Thermometer, Heart, Zap, Flame } from "lucide-react";
import { format } from "date-fns";
import { formatDuration, formatDistance, formatPace } from "@/lib/utils";
import { resolveActivityColor } from "@/lib/planner/colors";
import { gradeAdjustedPace } from "@/lib/fitness/vo2max";
import { computeDrift, SplitWithHR } from "@/lib/fitness/decoupling";
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
      workoutType: true, customTypeName: true,
    },
  });

  if (!activity || activity.userId !== userId) notFound();

  const [fitnessCache, sportCategories] = await Promise.all([
    prisma.fitnessCache.findUnique({ where: { userId }, select: { maxHR: true } }),
    prisma.sportCategory.findMany({
      where: { userId },
      orderBy: { order: "asc" },
      include: { workoutTypes: { orderBy: { order: "asc" } } },
    }),
  ]);

  const color = resolveActivityColor(
    sportCategories, activity.sportType, activity.isRace, activity.workoutType, activity.customTypeName, activity.name,
  );
  const pace = activity.averageSpeed ? formatPace(activity.averageSpeed) : null;

  function secPerKmToStr(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}/km`;
  }

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

  // 3E — Grade Adjusted Pace
  const rawPaceSecPerKm = activity.averageSpeed ? 1000 / activity.averageSpeed : null;
  const elevGainPerKm = activity.distance > 0 ? (activity.totalElevationGain / activity.distance) * 1000 : 0;
  const gapSecPerKm = rawPaceSecPerKm && elevGainPerKm >= 10 && /run/i.test(activity.sportType)
    ? gradeAdjustedPace(rawPaceSecPerKm, activity.totalElevationGain, activity.distance)
    : null;

  // 3F — Prev/Next navigation
  const [prevAct, nextAct] = await Promise.all([
    prisma.activity.findFirst({
      where: { userId, startDate: { lt: activity.startDate } },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true },
    }),
    prisma.activity.findFirst({
      where: { userId, startDate: { gt: activity.startDate } },
      orderBy: { startDate: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // 1B/3D — Aerobic decoupling (Pa:HR)
  const decoupling = splits && splits.length >= 6 && activity.movingTime >= 40 * 60 && /run/i.test(activity.sportType)
    ? computeDrift(splits as SplitWithHR[])
    : null;

  // 2B — PVI (Pace Variability Index)
  const pvi = splits && splits.length >= 4 ? (() => {
    const paces = splits.filter(s => s.average_speed > 0).map(s => 1000 / s.average_speed);
    if (paces.length < 4) return null;
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    const stddev = Math.sqrt(paces.reduce((s, v) => s + (v - mean) ** 2, 0) / paces.length);
    return (stddev / mean) * 100;
  })() : null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back + Prev/Next navigation */}
      <div className="flex items-center gap-3">
        <Link href="/activities"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition">
          <ChevronLeft size={16} />Back to activities
        </Link>
        <div className="ml-auto flex gap-3">
          {prevAct && (
            <Link href={`/activities/${prevAct.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary transition">
              <ChevronLeft size={12} />{prevAct.name.slice(0, 28)}
            </Link>
          )}
          {nextAct && (
            <Link href={`/activities/${nextAct.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary transition">
              {nextAct.name.slice(0, 28)}<ChevronRight size={12} />
            </Link>
          )}
        </div>
      </div>

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
          ...(gapSecPerKm ? [{ label: "GAP", value: secPerKmToStr(gapSecPerKm) }] : []),
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
            <Flame size={14} className="text-warning" />
            <span className="text-muted">Effort:</span>
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
          <SplitsChart splits={splits} avgSpeedMs={activity.averageSpeed ?? 0} isLaps={isLaps} color={color} />
        </div>
      )}

      {/* 1B/3D — Aerobic decoupling (Pa:HR) */}
      {decoupling && (() => {
        const d = decoupling.drift;
        const color = d > 0.10 ? "text-error" : d > 0.05 ? "text-warning" : d < -0.15 ? "text-warning" : "text-accent";
        const label = d > 0.10 ? "Decoupling — HR rising vs pace"
          : d > 0.05 ? "Moderate upward drift"
          : d < -0.10 ? "Negative split — better efficiency in second half"
          : "Well-coupled — aerobic";
        return (
          <div className="rounded-2xl bg-surface border border-border p-4 flex items-center gap-6">
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Pa:HR Aerobic Coupling</p>
              <p className={`text-2xl font-semibold font-mono ${color}`}>
                {d >= 0 ? "+" : ""}{(d * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted mt-0.5">{label}</p>
            </div>
            <p className="text-xs text-muted flex-1">
              Pa:HR drift measures aerobic efficiency. Positive (HR/pace rising) = decoupling. Negative = more efficient in second half. Within ±5% = well-coupled.
            </p>
          </div>
        );
      })()}

      {/* Splits table */}
      {splits && splits.length > 0 && (
        <SplitsTable splits={splits} isLaps={isLaps} pvi={pvi} />
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
            userMaxHR: fitnessCache?.maxHR ?? null,
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
