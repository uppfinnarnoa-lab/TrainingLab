import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildPaceZones, type HRZones } from "@/lib/fitness/zones";
import { estimateVO2max, type RacePB } from "@/lib/fitness/vo2max";
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

async function loadRacePBsForContext(userId: string): Promise<RacePB[]> {
  const records = await prisma.raceRecord.findMany({
    where: { userId, date: { gte: subDays(new Date(), 5 * 365) } },
    select: { distanceM: true, time: true, date: true },
    orderBy: { time: "asc" },
  });
  const best = new Map<number, RacePB>();
  for (const r of records) {
    const d = Math.round(r.distanceM);
    if (!best.has(d) || best.get(d)!.timeSec > r.time)
      best.set(d, { distanceM: r.distanceM, timeSec: r.time, date: r.date });
  }
  return [...best.values()];
}

export async function buildCoachContext(userId: string): Promise<CoachContext> {
  const now = new Date();

  const [profile, fitnessCache, activities, garminRecent, plannedWorkouts, missedWorkouts, upcomingRaceWorkouts, racePBs, recentFive] =
    await Promise.all([
      prisma.athleteProfile.findUnique({ where: { userId } }),
      prisma.fitnessCache.findUnique({ where: { userId } }),
      // Only fetch last 90 days — enough for AI context, dramatically faster than 5 years
      prisma.activity.findMany({
        where: { userId, startDate: { gte: subDays(now, 90) } },
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
      loadRacePBsForContext(userId),
      prisma.activity.findMany({
        where: { userId },
        orderBy: { startDate: "desc" },
        take: 5,
        select: { name: true, sportType: true, startDate: true, distance: true, movingTime: true, averageHeartrate: true, averageSpeed: true, isRace: true, description: true },
      }),
    ]);

  // ── HR / zones — use calibrated zones from FitnessCache if available ──
  const maxHR = profile?.maxHeartRate ?? fitnessCache?.maxHR ?? 190;
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? fitnessCache?.restHR ?? 50;
  const hrZones: HRZones = fitnessCache?.zones
    ? { ...(fitnessCache.zones as HRZones), maxHR, restHR }
    : buildHRZones(maxHR, restHR);
  const hrZoneRanges: [number, number][] = [
    hrZones.z1, hrZones.z2, hrZones.z3, hrZones.z4, hrZones.z5,
  ];

  // ── VO2max / paces — read from cache (avoid full 5-year recomputation) ──
  const vdot = fitnessCache?.vdot ?? 45;
  const vo2maxResult = fitnessCache
    ? { value: fitnessCache.vo2max, vdot, confidence: fitnessCache.confidence as "high"|"medium"|"low", method: fitnessCache.method }
    : estimateVO2max(
        (activities as Act[]).map(a => ({
          distanceM: a.distance, timeSec: a.movingTime,
          avgHR: a.averageHeartrate, isRace: a.isRace,
          sportType: a.sportType, name: a.name, startDate: a.startDate,
        })),
        maxHR, restHR, racePBs,
      );
  const paceZones = buildPaceZones(vdot);

  // ── ATL/CTL/TSB — read from cache (avoids 365-day TSS computation) ──────
  const todayLoad = { atl: fitnessCache?.atl ?? 0, ctl: fitnessCache?.ctl ?? 0, tsb: fitnessCache?.tsb ?? 0 };
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
    const readiness = garminRecent.at(-1)?.trainingReadiness;
    if (readiness != null) healthLines.push(`Training Readiness (Garmin): ${readiness}/100`);
    const stress = garminRecent.at(-1)?.stressAvg;
    if (stress != null) healthLines.push(`Avg stress yesterday: ${stress}/100${stress > 70 ? " ⚠ high" : ""}`);
    const spo2 = garminRecent.at(-1)?.spo2Avg;
    if (spo2 != null && spo2 < 95) healthLines.push(`SpO₂: ${spo2.toFixed(0)}% ⚠ low`);
  }
  if (fitnessCache?.acwr != null && fitnessCache.acwr > 1.5) {
    healthLines.push(`⚠ ACWR elevated (${fitnessCache.acwr.toFixed(2)}) — sustained ratios above ~1.5 are associated with increased injury risk in the literature; consider an easier week`);
  }
  if (missedWorkouts.length > 0) {
    const injuryStreak = missedWorkouts.filter((w: { missedReason: string | null }) => w.missedReason === "injury" || w.missedReason === "illness").length;
    healthLines.push(`Missed sessions (4w): ${missedWorkouts.length}${injuryStreak > 0 ? ` (${injuryStreak} injury/illness)` : ""}`);
    const reasons = [...new Set(missedWorkouts.map((w: { missedReason: string | null }) => w.missedReason).filter(Boolean))];
    if (reasons.length) healthLines.push(`Reasons: ${reasons.join(", ")}`);
  }
  if (healthLines.length === 0) healthLines.push("No Garmin data connected");

  // ── Upcoming plan ──────────────────────────────────────────────────
  // Limit plan to 7 days to keep system prompt short
  const upcomingPlan = plannedWorkouts.slice(0, 7).map((w: { date: Date; name: string; sportType: string; targetDistance: number | null; targetDuration: number | null }) => {
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
    racePBs: racePBs
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 10)
      .map(pb => {
        const mm = Math.floor(pb.timeSec / 60);
        const ss = pb.timeSec % 60;
        // Find the label from distanceM
        const distLabel = pb.distanceM >= 42000 ? "Marathon"
          : pb.distanceM >= 20000 ? "Half Marathon"
          : pb.distanceM >= 9500  ? "10K"
          : pb.distanceM >= 4800  ? "5K"
          : pb.distanceM >= 2800  ? "3K"
          : pb.distanceM >= 1400  ? "1500m"
          : pb.distanceM >= 750   ? "800m"
          : `${(pb.distanceM / 1000).toFixed(1)}K`;
        return {
          distance: distLabel,
          time: `${mm}:${String(ss).padStart(2, "0")}`,
          year: pb.date.getFullYear(),
        };
      }),
    healthLog: healthLines.join("\n"),
    upcomingRaces: (upcomingRaceWorkouts as { date: Date; name: string; sportType: string; targetIntensity: string | null }[]).map(w => ({
      date: format(w.date, "d MMM yyyy"),
      name: w.name,
      distance: w.sportType,
      priority: w.targetIntensity === "Race" ? "A" : "B",
    })),
    upcomingPlan,
    recentSessions: recentFive.length > 0
      ? (recentFive as { name: string; sportType: string; startDate: Date; distance: number; movingTime: number; averageHeartrate: number | null; averageSpeed: number | null; isRace: boolean; description: string | null }[]).map(a => {
          const dist = `${(a.distance / 1000).toFixed(1)}km`;
          const mins = `${Math.floor(a.movingTime / 60)}min`;
          const hr   = a.averageHeartrate ? ` · ${Math.round(a.averageHeartrate)}bpm` : "";
          const pace = a.averageSpeed && /run|trail/i.test(a.sportType)
            ? ` · ${secPerKmToPaceStr(1000 / a.averageSpeed)}`
            : "";
          const race = a.isRace ? " [RACE]" : "";
          const desc = a.description ? ` — ${a.description.slice(0, 60)}` : "";
          return `${format(a.startDate, "EEE d MMM")}: ${a.name}${race} (${a.sportType}) ${dist} ${mins}${hr}${pace}${desc}`;
        }).join("\n")
      : undefined,
    weeklyVolume: (() => {
      type WeekVol = Record<string, Record<string, { km: number; timeSec: number }>>;
      const wvol = fitnessCache?.weeklyVolumeJson as WeekVol | null;
      if (!wvol) return undefined;
      const lines = Object.entries(wvol).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([wk, sports]) => {
        const totalKm = Object.values(sports).reduce((s, v) => s + (v.km ?? 0), 0);
        const totalH  = Object.values(sports).reduce((s, v) => s + (v.timeSec ?? 0), 0) / 3600;
        return `${wk}: ${Math.round(totalKm)}km · ${totalH.toFixed(1)}h`;
      });
      return lines.join("\n") || undefined;
    })(),
  };
}

// Summarise last N activities for per-message context (not cached)
export async function buildRecentActivitiesSummary(userId: string, days = 28): Promise<string> {
  // Cap at 20 activities max to keep token usage reasonable (especially for Gemini free tier)
  const limit = Math.min(20, Math.ceil(days * 0.7));
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), days) } },
    orderBy: { startDate: "desc" },
    take: limit,
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
    // Keep descriptions short — long descriptions blow up Gemini's free-tier token limit
    const desc = a.description ? `\n  Notes: "${a.description.slice(0, 80)}"` : "";
    return `${date}: ${a.name}${race} — ${a.sportType} ${dist} ${time}${hr}${pace}${weather}${desc}`;
  }).join("\n");
}
