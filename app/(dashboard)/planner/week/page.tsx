import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  startOfWeek, endOfWeek, addDays, format, parseISO,
} from "date-fns";
import { workoutColor } from "@/lib/planner/colors";
import { formatDuration, formatDistance } from "@/lib/utils";
import { ZoneBar } from "@/components/planner/ZoneBar";
import { ZONE_COLORS } from "@/lib/planner/types";
import { ChevronLeft } from "lucide-react";

const ZONE_LABELS = ["", "Z1 Easy", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];

// targetIntensity is a loose label (set by the AI coach as Easy/Moderate/Hard/Race,
// or by the CSV plan import as easy/moderate/quality) with no zone data of its own —
// map it onto the same Z1-Z5 system the rest of the planner uses.
function intensityToZone(intensity: string | null): number | null {
  const s = (intensity ?? "").toLowerCase();
  if (s === "easy") return 2;
  if (s === "moderate") return 3;
  if (s === "quality" || s === "hard") return 4;
  if (s === "race") return 5;
  return null;
}

export default async function WeekDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { date } = await searchParams;
  if (!date) redirect("/planner");

  const weekStart = startOfWeek(parseISO(date), { weekStartsOn: 1 });
  const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 });

  const [workouts, sports] = await Promise.all([
    prisma.plannedWorkout.findMany({
      where: { userId, date: { gte: weekStart, lte: weekEnd } },
      orderBy: { date: "asc" },
      include: {
        template: {
          include: { sport: true, type: true, sections: { orderBy: { order: "asc" } } },
        },
      },
    }),
    prisma.sportCategory.findMany({ where: { userId }, select: { name: true, color: true } }),
  ]);
  const sportColorByName: Record<string, string> = {};
  for (const s of sports as { name: string; color: string }[]) sportColorByName[s.name.toLowerCase()] = s.color;

  // Aggregate stats
  const bySport: Record<string, { km: number; timeSec: number; count: number }> = {};
  const byType:  Record<string, { km: number; timeSec: number; color: string }> = {};
  const byIntensity: Record<string, { timeSec: number; color: string; zone: number }> = {};
  let totalZones: Record<string, number> = {};
  let completed = 0, missed = 0, planned = 0;

  for (const w of workouts) {
    const sport = w.sportType;
    if (!bySport[sport]) bySport[sport] = { km: 0, timeSec: 0, count: 0 };
    if (w.targetDistance) bySport[sport].km += w.targetDistance / 1000;
    if (w.targetDuration) bySport[sport].timeSec += w.targetDuration;
    bySport[sport].count++;

    // By type (e.g. "Easy run", "LT", "Speedwork")
    const typeName = w.template?.type?.name ?? null;
    const typeKey  = typeName ?? `${sport} (no type)`;
    const typeColor = w.template?.type?.color
      ?? w.template?.sport?.color
      ?? sportColorByName[sport.toLowerCase()]
      ?? workoutColor(sport, typeName);
    if (!byType[typeKey]) byType[typeKey] = { km: 0, timeSec: 0, color: typeColor };
    if (w.targetDistance) byType[typeKey].km += w.targetDistance / 1000;
    if (w.targetDuration) byType[typeKey].timeSec += w.targetDuration;

    // By intensity, mapped onto the Z1-Z5 zone system
    const intensityZone = intensityToZone(w.targetIntensity);
    if (intensityZone) {
      const zoneKey = `z${intensityZone}`;
      if (!byIntensity[zoneKey]) byIntensity[zoneKey] = { timeSec: 0, color: ZONE_COLORS[intensityZone], zone: intensityZone };
      if (w.targetDuration) byIntensity[zoneKey].timeSec += w.targetDuration;
    }

    const zoneDist = w.template?.estimatedZoneDistribution as Record<string, number> | null;
    if (zoneDist) {
      for (const [z, v] of Object.entries(zoneDist)) {
        totalZones[z] = (totalZones[z] ?? 0) + v;
      }
    }

    if (w.status === "completed" || w.status === "partial") completed++;
    else if (w.status === "missed") missed++;
    else planned++;
  }

  const totalTimeSec = Object.values(bySport).reduce((s, v) => s + v.timeSec, 0);
  const totalKm      = Object.values(bySport).reduce((s, v) => s + v.km, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back */}
      <Link href="/planner" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition">
        <ChevronLeft size={16} />
        Back to planner
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-primary">
          Week of {format(weekStart, "d MMMM yyyy")}
        </h1>
        <p className="text-sm text-muted mt-1">
          {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total distance",   value: `${totalKm.toFixed(1)} km` },
          { label: "Total time",       value: formatDuration(totalTimeSec) },
          { label: "Sessions",         value: String(workouts.length) },
          { label: "Completion",       value: workouts.length ? `${completed}/${workouts.length}` : "–" },
        ].map(c => (
          <div key={c.label} className="rounded-xl bg-surface border border-border p-4">
            <p className="text-xs text-muted uppercase tracking-wide">{c.label}</p>
            <p className="text-xl font-semibold font-mono text-primary mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Volume by sport */}
      {Object.keys(bySport).length > 0 && (
        <div className="rounded-xl bg-surface border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-primary">Volume by sport</h2>
          {Object.entries(bySport).map(([sport, d]) => {
            const color = sportColorByName[sport.toLowerCase()] ?? workoutColor(sport, null);
            const maxKm = Math.max(...Object.values(bySport).map(x => x.km), 1);
            return (
              <div key={sport} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-primary">{sport}</span>
                  <span className="font-mono text-muted">
                    {d.km > 0 ? `${d.km.toFixed(1)} km · ` : ""}
                    {formatDuration(d.timeSec)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(d.km / maxKm) * 100}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Volume by type */}
      {Object.keys(byType).length > 1 && (
        <div className="rounded-xl bg-surface border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-primary">Volume by type</h2>
          {Object.entries(byType)
            .sort((a, b) => b[1].timeSec - a[1].timeSec)
            .map(([type, d]) => {
              const maxSec = Math.max(...Object.values(byType).map(x => x.timeSec), 1);
              return (
                <div key={type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="font-medium text-primary">{type}</span>
                    </div>
                    <span className="font-mono text-muted text-xs">
                      {d.km > 0 ? `${d.km.toFixed(1)} km · ` : ""}
                      {formatDuration(d.timeSec)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(d.timeSec / maxSec) * 100}%`, backgroundColor: d.color }} />
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Volume by intensity */}
      {Object.keys(byIntensity).length > 1 && (
        <div className="rounded-xl bg-surface border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-primary">Volume by intensity</h2>
          {(() => {
            const totalIntSec = Object.values(byIntensity).reduce((s, v) => s + v.timeSec, 0);
            const maxSec = Math.max(...Object.values(byIntensity).map(x => x.timeSec), 1);
            return Object.entries(byIntensity)
              .sort((a, b) => a[1].zone - b[1].zone)
              .map(([key, d]) => {
                const pct = totalIntSec > 0 ? Math.round((d.timeSec / totalIntSec) * 100) : 0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="font-medium text-primary">{ZONE_LABELS[d.zone]}</span>
                      </div>
                      <span className="font-mono text-muted text-xs">{pct}% · {formatDuration(d.timeSec)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(d.timeSec / maxSec) * 100}%`, backgroundColor: d.color }} />
                    </div>
                  </div>
                );
              });
          })()}
        </div>
      )}

      {/* Zone distribution */}
      {Object.values(totalZones).some(v => v > 0) && (
        <div className="rounded-xl bg-surface border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-primary">Zone distribution</h2>
          <ZoneBar distribution={totalZones} height={12} className="rounded-lg" />
          <div className="grid grid-cols-5 gap-2 text-xs text-center">
            {ZONE_LABELS.slice(1).map((z, i) => {
              const key = `z${i+1}`;
              const sec = totalZones[key] ?? 0;
              const pct = totalTimeSec > 0 ? Math.round((sec / totalTimeSec) * 100) : 0;
              return (
                <div key={z}>
                  <p className="text-muted">{z.split(" ")[0]}</p>
                  <p className="font-semibold text-primary">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day-by-day breakdown */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-primary">Daily breakdown</h2>
        {days.map(day => {
          const dayKey = format(day, "yyyy-MM-dd");
          const dayWorkouts = workouts.filter((w: typeof workouts[number]) => w.date.toISOString().slice(0, 10) === dayKey);
          const isToday = dayKey === format(new Date(), "yyyy-MM-dd");

          return (
            <div key={dayKey} className={`rounded-xl border p-4 ${isToday ? "border-accent/30 bg-accent/5" : "border-border bg-surface"}`}>
              <p className={`text-xs font-semibold mb-2 ${isToday ? "text-accent" : "text-muted"}`}>
                {format(day, "EEEE d MMM")}
              </p>
              {dayWorkouts.length === 0 ? (
                <p className="text-xs text-muted">Rest day</p>
              ) : (
                <div className="space-y-2">
                  {dayWorkouts.map((w: typeof workouts[number]) => {
                    const color = w.color ?? workoutColor(w.sportType, w.template?.type?.name ?? null);
                    const isCompleted = w.status === "completed" || w.status === "partial";
                    const isMissed    = w.status === "missed";
                    return (
                      <div key={w.id} className="flex items-start gap-3 pl-1"
                        style={{ borderLeft: `3px solid ${color}` }}>
                        <div className="flex-1 pl-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-primary">{w.name}</span>
                            {isCompleted && <span className="text-xs text-green-500">✓</span>}
                            {isMissed    && <span className="text-xs text-red-500">✗ {w.missedReason}</span>}
                          </div>
                          <p className="text-xs text-muted">
                            {w.sportType}
                            {w.targetDuration ? ` · ${formatDuration(w.targetDuration)}` : ""}
                            {w.targetDistance ? ` · ${formatDistance(w.targetDistance)}` : ""}
                          </p>
                          {w.notes && <p className="text-xs text-muted mt-0.5 line-clamp-2">{w.notes}</p>}
                          {w.missedNote && <p className="text-xs text-muted italic mt-0.5">"{w.missedNote}"</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
