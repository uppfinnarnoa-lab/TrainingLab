import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { PlannerClient } from "./planner-client";
import { subDays, addDays, startOfWeek } from "date-fns";
import { buildHRZones, buildPaceZones } from "@/lib/fitness/zones";

export default async function PlannerPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const now = new Date();
  const from = subDays(now, 90);
  const to = addDays(now, 180);

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const [sports, templates, workouts, blocks, profile, fitnessCache, garminRecent, weekActivities] =
    await Promise.all([
      prisma.sportCategory.findMany({
        where: { userId },
        orderBy: { order: "asc" },
        include: { workoutTypes: { orderBy: { order: "asc" } } },
      }),
      prisma.workoutTemplate.findMany({
        where: { userId },
        orderBy: [{ sportId: "asc" }, { name: "asc" }],
        include: {
          sections: { orderBy: { order: "asc" } },
          sport: true,
          type: true,
        },
      }),
      prisma.plannedWorkout.findMany({
        where: { userId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
        include: {
          template: {
            include: { sport: true, sections: { orderBy: { order: "asc" } } },
          },
        },
      }),
      prisma.trainingBlock.findMany({
        where: { userId },
        orderBy: { startDate: "asc" },
      }),
      prisma.athleteProfile.findUnique({ where: { userId } }),
      // FitnessCache replaces the 365-day activity fetch for maxHR/zones
      prisma.fitnessCache.findUnique({ where: { userId }, select: { maxHR: true, restHR: true, vdot: true } }),
      prisma.garminDailySummary.findMany({
        where: { userId, date: { gte: subDays(now, 14) } },
        orderBy: { date: "asc" },
      }),
      // This week's actual running activities for predicted distance
      prisma.activity.findMany({
        where: {
          userId,
          startDate: { gte: weekStart, lte: now },
          sportType: { in: ["Run", "TrailRun", "VirtualRun"] },
        },
        select: { startDateLocal: true, distance: true },
      }),
    ]);

  // Compute zones for the workout builder — use FitnessCache (fast, no big activity fetch)
  const maxHR = profile?.maxHeartRate ?? fitnessCache?.maxHR ?? 190;
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? fitnessCache?.restHR ?? 50;
  const hrZones = buildHRZones(maxHR, restHR);
  const paceZonesData = buildPaceZones(fitnessCache?.vdot ?? 45);

  // Serialise dates to strings for client components
  const serialise = (obj: unknown): unknown => {
    if (obj instanceof Date) return obj.toISOString().slice(0, 10);
    if (Array.isArray(obj)) return obj.map(serialise);
    if (obj && typeof obj === "object") {
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serialise(v)])
      );
    }
    return obj;
  };

  // HR zone ranges as [[lo,hi]] arrays for zone picker
  const hrZoneRanges = [hrZones.z1, hrZones.z2, hrZones.z3, hrZones.z4, hrZones.z5];
  const paceZoneRanges = [
    paceZonesData.easy,
    paceZonesData.marathon,
    paceZonesData.threshold,
    paceZonesData.interval,
    paceZonesData.repetition,
  ];

  return (
    <div className="-mx-6 -my-6 h-[calc(100vh-64px)] flex flex-col">
      <PlannerClient
        sports={serialise(sports) as never}
        templates={serialise(templates) as never}
        workouts={serialise(workouts) as never}
        blocks={serialise(blocks) as never}
        hrZoneRanges={hrZoneRanges}
        paceZoneRanges={paceZoneRanges}
        weekRunActivities={(weekActivities as { startDateLocal: Date; distance: number }[]).map(a => ({
          date: a.startDateLocal.toISOString().slice(0, 10),
          distanceM: a.distance,
        }))}
      />
    </div>
  );
}
