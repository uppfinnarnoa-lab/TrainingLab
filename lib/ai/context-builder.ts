import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildPaceZones, estimateMaxHR } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve } from "@/lib/fitness/training-load";
import { estimateVO2max } from "@/lib/fitness/vo2max";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";
import { tsbLabel } from "@/lib/fitness/training-load";
import { format, subDays, addDays, differenceInYears } from "date-fns";
import type { CoachContext } from "./prompts";
import { formatDuration, formatDistance } from "@/lib/utils";

type Act = {
  sportType: string; startDate: Date; name: string; description: string | null;
  distance: number; movingTime: number; averageHeartrate: number | null;
  maxHeartrate: number | null; isRace: boolean; averageSpeed: number | null;
};

export async function buildCoachContext(userId: string): Promise<CoachContext> {
  const now = new Date();

  const [profile, activities, garminRecent, plannedWorkouts, missedWorkouts, upcomingRaceWorkouts] =
    await Promise.all([
      prisma.athleteProfile.findUnique({ where: { userId } }),
      prisma.activity.findMany({
        // 5-year cap: limits AI context window to save costs and processing time
        where: { userId, startDate: { gte: subDays(now, 5 * 365) } },
        orderBy: { startDate: "asc" },
        select: {
          sportType: true, startDate: true, name: true, description: true,
          distance: true, movingTime: true, averageHeartrate: true,
          maxHeartrate: true, isRace: true, averageSpeed: true,
        },
      }),
      prisma.garminDailySummary.findMany({
        where: { userId, date: { gte: subDays(now, 7) } },
        orderBy: { date: "asc" },
      }),
      prisma.plannedWorkout.findMany({
        where: { userId, date: { gte: now, lte: addDays(now, 14) }, status: "planned" },
        orderBy: { date: "asc" },
      }),
      prisma.plannedWorkout.findMany({
        where: { userId, status: "missed", date: { gte: subDays(now, 28) } },
        orderBy: { date: "desc" },
        take: 10,
      }),
      // Upcoming races: planned workouts that look like races (intensity "Race" or race keywords)
      prisma.plannedWorkout.findMany({
        where: {
          userId,
          date: { gte: now, lte: addDays(now, 120) },
          status: "planned",
          OR: [
            { targetIntensity: "Race" },
            { name: { contains: "lopp" } },
            { name: { contains: "tävling" } },
            { name: { contains: "race" } },
            { name: { contains: "mila" } },
            { name: { contains: "sprint" } },
            { name: { contains: "SIC" } },
            { name: { contains: "SM " } },
          ],
        },
        orderBy: { date: "asc" },
        take: 5,
      }),
    ]);

  // ── HR / zones ──────────────────────────────────────────────────────
  const maxHRs = (activities as Act[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const maxHR = profile?.maxHeartRate ?? estimateMaxHR(maxHRs);
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;
  const hrZones = buildHRZones(maxHR, restHR);
  const hrZoneRanges: [number, number][] = [
    hrZones.z1, hrZones.z2, hrZones.z3, hrZones.z4, hrZones.z5,
  ];

  // ── VO2max / CTL / TSB ──────────────────────────────────────────────
  const vo2maxResult = estimateVO2max(
    (activities as Act[]).map(a => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace, sportType: a.sportType,
    })),
    maxHR, restHR,
  );
  const paceZones = buildPaceZones(vo2maxResult.vdot);

  const dailyTSS = new Map<string, number>();
  for (const a of activities as Act[]) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
    dailyTSS.set(key, (dailyTSS.get(key) ?? 0) + tss);
  }
  const loadCurve = buildLoadCurve(dailyTSS, subDays(now, 365), now);
  const todayLoad = loadCurve.at(-1) ?? { atl: 0, ctl: 0, tsb: 0 };
  const formLabel = tsbLabel(todayLoad.tsb).label;

  // ── Paces formatted ────────────────────────────────────────────────
  const paces = {
    easy:      `${secPerKmToPaceStr(paceZones.easy[1])}–${secPerKmToPaceStr(paceZones.easy[0])}`,
    marathon:  `${secPerKmToPaceStr(paceZones.marathon[1])}–${secPerKmToPaceStr(paceZones.marathon[0])}`,
    threshold: `${secPerKmToPaceStr(paceZones.threshold[1])}–${secPerKmToPaceStr(paceZones.threshold[0])}`,
    interval:  `${secPerKmToPaceStr(paceZones.interval[1])}–${secPerKmToPaceStr(paceZones.interval[0])}`,
  };

  // ── Health log ─────────────────────────────────────────────────────
  const healthLines: string[] = [];
  if (garminRecent.length > 0) {
    const avgHRV = garminRecent.map((g: { hrvNightly: number | null }) => g.hrvNightly ?? 0).filter((v: number) => v > 0);
    if (avgHRV.length > 0) {
      const trend = avgHRV.at(-1)! - avgHRV[0];
      healthLines.push(`HRV (${avgHRV.length}d): ${avgHRV.map((v: number) => v.toFixed(0)).join("→")} ms ${trend < -3 ? "⚠ declining" : "stable"}`);
    }
    const avgSleep = garminRecent.map((g: { sleepDuration: number | null }) => g.sleepDuration ?? 0).filter((v: number) => v > 0);
    if (avgSleep.length > 0) {
      const hrs = (avgSleep.reduce((a: number, b: number) => a + b, 0) / avgSleep.length / 3600).toFixed(1);
      healthLines.push(`Sleep avg: ${hrs}h/night`);
    }
    const bb = garminRecent.at(-1)?.bodyBattery;
    if (bb) healthLines.push(`Body Battery: ${bb}/100`);
  }
  if (missedWorkouts.length > 0) {
    const injuryStreak = missedWorkouts.filter((w: { missedReason: string | null }) => w.missedReason === "injury" || w.missedReason === "illness").length;
    healthLines.push(`Missed sessions (4w): ${missedWorkouts.length}${injuryStreak > 0 ? ` (${injuryStreak} injury/illness)` : ""}`);
    const reasons = [...new Set(missedWorkouts.map((w: { missedReason: string | null }) => w.missedReason).filter(Boolean))];
    if (reasons.length) healthLines.push(`Reasons: ${reasons.join(", ")}`);
  }
  if (healthLines.length === 0) healthLines.push("No Garmin data connected");

  // ── Upcoming plan ──────────────────────────────────────────────────
  const upcomingPlan = plannedWorkouts.map((w: { date: Date; name: string; sportType: string; targetDistance: number | null; targetDuration: number | null }) => {
    const dateStr = format(w.date, "EEE d MMM");
    const dist = w.targetDistance ? ` ${formatDistance(w.targetDistance)}` : "";
    const dur = w.targetDuration ? ` ${formatDuration(w.targetDuration)}` : "";
    return `${dateStr}: ${w.name} (${w.sportType})${dist}${dur}`;
  });

  // ── Age ────────────────────────────────────────────────────────────
  const age = profile?.dateOfBirth
    ? differenceInYears(now, profile.dateOfBirth)
    : null;

  return {
    name: null, // filled by caller from User.name
    age,
    sex: profile?.sex ?? null,
    weightKg: profile?.weightKg ?? null,
    heightCm: profile?.heightCm ?? null,
    primaryGoal: profile?.primaryGoal ?? null,
    yearsTraining: profile?.yearsTraining ?? null,
    vo2max: vo2maxResult.value,
    vo2maxConfidence: vo2maxResult.confidence,
    vo2maxMethod: vo2maxResult.method,
    vdot: vo2maxResult.vdot,
    ctl: todayLoad.ctl,
    atl: todayLoad.atl,
    tsb: todayLoad.tsb,
    tsbLabel: formLabel,
    maxHR,
    restHR,
    paces,
    hrZones: hrZoneRanges,
    healthLog: healthLines.join("\n"),
    upcomingRaces: (upcomingRaceWorkouts as { date: Date; name: string; sportType: string; targetIntensity: string | null }[]).map(w => ({
      date: format(w.date, "d MMM yyyy"),
      name: w.name,
      distance: w.sportType,
      priority: w.targetIntensity === "Race" ? "A" : "B",
    })),
    upcomingPlan,
  };
}

// Summarise last N activities for per-message context (not cached)
export async function buildRecentActivitiesSummary(userId: string, days = 28): Promise<string> {
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), days) } },
    orderBy: { startDate: "desc" },
    take: 30,
    select: {
      name: true, description: true, sportType: true, startDate: true,
      distance: true, movingTime: true, averageHeartrate: true,
      averageSpeed: true, totalElevationGain: true, isRace: true,
      weatherTemp: true,
    },
  });

  if (activities.length === 0) return "No activities in the last 4 weeks.";

  type RecentAct = { name: string; description: string | null; sportType: string; startDate: Date; distance: number; movingTime: number; averageHeartrate: number | null; averageSpeed: number | null; totalElevationGain: number; isRace: boolean; weatherTemp: number | null };
  return (activities as RecentAct[]).map(a => {
    const date = format(a.startDate, "EEE d MMM");
    const dist = a.distance ? formatDistance(a.distance) : "";
    const time = a.movingTime ? formatDuration(a.movingTime) : "";
    const hr = a.averageHeartrate ? ` · ${Math.round(a.averageHeartrate)}bpm avg` : "";
    const pace = a.averageSpeed && a.sportType.toLowerCase().includes("run")
      ? ` · ${secPerKmToPaceStr(1000 / a.averageSpeed)}`
      : "";
    const weather = a.weatherTemp != null ? ` · ${Math.round(a.weatherTemp)}°C` : "";
    const race = a.isRace ? " [RACE]" : "";
    const desc = a.description ? `\n  Notes: "${a.description.slice(0, 200)}"` : "";
    return `${date}: ${a.name}${race} — ${a.sportType} ${dist} ${time}${hr}${pace}${weather}${desc}`;
  }).join("\n");
}
