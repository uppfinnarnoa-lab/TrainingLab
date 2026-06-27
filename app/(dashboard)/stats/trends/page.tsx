import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { subDays, format, startOfWeek } from "date-fns";
import { buildHRZones, type HRZones } from "@/lib/fitness/zones";
import { computeTSS, computeACWR } from "@/lib/fitness/training-load";
import {
  computeWeatherStats, computeEasyPaceTrend, computeCadenceScatter,
  type WeatherAct, type EasyPaceAct, type CadenceScatterPoint,
} from "@/lib/fitness/secondary-analytics";
import { TrendsClient } from "./trends-client";

// Independent data loader, mirroring the established pattern of app/(dashboard)/stats/volume —
// computes its own minimal slice rather than threading state through the much larger, heavily
// validated /stats/page.tsx pipeline. See secondary-analytics.ts for the shared helpers.
export default async function TrendsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const now = new Date();

  const [profile, fitnessCache, latestGarmin] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    prisma.garminDailySummary.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { restingHR: true } }),
  ]);

  const restHR = profile?.restingHeartRate ?? latestGarmin?.restingHR ?? 50;
  const maxHR = profile?.maxHeartRate ?? fitnessCache?.maxHR ?? 190;
  const hrZones: HRZones = fitnessCache?.zones
    ? { ...(fitnessCache.zones as HRZones), maxHR, restHR }
    : buildHRZones(maxHR, restHR);
  const lt1HR = hrZones.z3[0];

  type ActivityRow = {
    sportType: string; startDate: Date; startDateLocal: Date; name: string;
    distance: number; movingTime: number; totalElevationGain: number;
    averageHeartrate: number | null; averageSpeed: number | null; averageCadence: number | null; isRace: boolean;
  };
  const activities: ActivityRow[] = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(now, 10 * 365) } },
    orderBy: { startDate: "asc" },
    select: {
      sportType: true, startDate: true, startDateLocal: true, name: true,
      distance: true, movingTime: true, totalElevationGain: true,
      averageHeartrate: true, averageSpeed: true, averageCadence: true, isRace: true,
    },
  });

  const weatherActs: WeatherAct[] = await prisma.activity.findMany({
    where: {
      userId, startDate: { gte: subDays(now, 4 * 365) },
      sportType: { contains: "run", mode: "insensitive" },
      weatherTemp: { not: null }, averageSpeed: { not: null },
      distance: { gte: 3000 }, isRace: false,
    },
    select: { averageSpeed: true, weatherTemp: true, weatherWind: true, weatherPrecip: true, distance: true, startDate: true, name: true, sportType: true, averageHeartrate: true },
  });

  // Ramp rate / injury risk need ACWR, which needs daily TSS over the trailing 28 days
  const dailyTSSMap = new Map<string, number>();
  for (const a of activities) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
    dailyTSSMap.set(key, (dailyTSSMap.get(key) ?? 0) + tss);
  }
  const acwr = computeACWR(dailyTSSMap, now);

  // AEI (Aerobic Efficiency Index) + Running Economy proxy, by week
  const pct75HR = Math.round(maxHR * 0.75);
  const aeiWeekMap = new Map<string, { sum: number; n: number }>();
  const reWeekMap  = new Map<string, { sum: number; n: number }>();
  for (const a of activities) {
    if (!a.averageHeartrate || !a.averageSpeed) continue;
    if (!a.sportType.toLowerCase().includes("run")) continue;
    if (a.averageHeartrate < lt1HR && a.distance >= 4000 && a.movingTime >= 900) {
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const aei = (a.averageSpeed * 60) / a.averageHeartrate;
      if (!aeiWeekMap.has(wk)) aeiWeekMap.set(wk, { sum: 0, n: 0 });
      const e = aeiWeekMap.get(wk)!; e.sum += aei; e.n++;
    }
    if (Math.abs(a.averageHeartrate - pct75HR) < 5 && a.distance >= 4000 && a.movingTime >= 900) {
      const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const pace = 1000 / a.averageSpeed;
      if (!reWeekMap.has(wk)) reWeekMap.set(wk, { sum: 0, n: 0 });
      const e = reWeekMap.get(wk)!; e.sum += pace; e.n++;
    }
  }
  const aeiByWeek = [...aeiWeekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-16)
    .map(([week, { sum, n }]) => ({ week, aei: Math.round(sum / n * 100) / 100 }));
  const reByWeek = [...reWeekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    .map(([week, { sum, n }]) => ({ week, paceSecPerKm: Math.round(sum / n) }));

  // Ramp rate: % change in 7-day TSS vs prior 7 days
  const last7dStr  = format(subDays(now, 7), "yyyy-MM-dd");
  const prev14dStr = format(subDays(now, 14), "yyyy-MM-dd");
  const last7dTSS  = [...dailyTSSMap.entries()].filter(([d]) => d >= last7dStr).reduce((s, [, v]) => s + v, 0);
  const prev7dTSS  = [...dailyTSSMap.entries()].filter(([d]) => d >= prev14dStr && d < last7dStr).reduce((s, [, v]) => s + v, 0);
  const rampRate   = prev7dTSS > 0 ? Math.round(((last7dTSS - prev7dTSS) / prev7dTSS) * 100) : null;

  // Injury risk score (0–100): ACWR × 50 + ramp rate × 30
  let injuryRisk: number | null = null;
  if (acwr !== null) {
    const acwrRisk = acwr > 1.5 ? 50 : acwr > 1.3 ? 30 : acwr < 0.8 ? 10 : 0;
    const rampRisk = rampRate !== null && rampRate > 20 ? 50 : rampRate !== null && rampRate > 10 ? 30 : 0;
    injuryRisk = Math.min(100, acwrRisk + rampRisk);
  }

  // Active streak: consecutive days with ≥1 activity up to today
  let activeStreak = 0;
  {
    const days = new Set(activities.map(a => format(a.startDate, "yyyy-MM-dd")));
    for (let i = 0; i < 365; i++) {
      if (days.has(format(subDays(now, i), "yyyy-MM-dd"))) activeStreak++;
      else break;
    }
  }

  // Heat impact: pace sensitivity to temperature on easy runs below LT1
  let tempSensitivity: number | null = null;
  {
    const pts = weatherActs.filter(a =>
      a.averageSpeed && a.averageSpeed > 0 && a.averageHeartrate &&
      a.averageHeartrate < lt1HR && a.weatherTemp != null && a.distance >= 4000
    );
    if (pts.length >= 10) {
      const meanTemp = pts.reduce((s, a) => s + a.weatherTemp!, 0) / pts.length;
      const meanPace = pts.reduce((s, a) => s + 1000 / a.averageSpeed!, 0) / pts.length;
      let num = 0, den = 0;
      for (const a of pts) {
        const dt = a.weatherTemp! - meanTemp;
        const dp = 1000 / a.averageSpeed! - meanPace;
        num += dt * dp; den += dt * dt;
      }
      if (den > 0.01) tempSensitivity = Math.round(num / den * 5 * 10) / 10;
    }
  }

  const weatherStats = computeWeatherStats(weatherActs as WeatherAct[], maxHR);
  const easyPaceTrend = computeEasyPaceTrend(activities as EasyPaceAct[], lt1HR);
  const cadenceScatter: CadenceScatterPoint[] = computeCadenceScatter(activities, now);

  // Efficiency Factor trend
  const lt1HRForEF = fitnessCache?.decouplingLt1HR ?? (fitnessCache?.maxHR ? fitnessCache.maxHR * 0.76 : null);
  const efWeekMap = new Map<string, { efSum: number; n: number }>();
  for (const act of activities) {
    if (!/run/i.test(act.sportType)) continue;
    if (!act.averageHeartrate || !act.averageSpeed) continue;
    if (lt1HRForEF && act.averageHeartrate > lt1HRForEF) continue;
    if (act.distance < 3000) continue;
    const wk = format(startOfWeek(act.startDateLocal, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const ef = (act.averageSpeed * 60) / act.averageHeartrate;
    if (ef < 0.5 || ef > 5) continue;
    if (!efWeekMap.has(wk)) efWeekMap.set(wk, { efSum: 0, n: 0 });
    const entry = efWeekMap.get(wk)!; entry.efSum += ef; entry.n++;
  }
  const efByWeek = [...efWeekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-16)
    .map(([week, d]) => ({ week, ef: +(d.efSum / d.n).toFixed(3) }));

  // VO2max/LT trend and OL terrain factor are expensive to (re)compute — read the cache that
  // updateVO2maxAndPaces() already maintains on every Strava sync rather than redoing it here.
  const extraViz = (fitnessCache?.extraVizJson ?? null) as {
    vdotTrend?: { month: string; vdot: number }[];
    ltPaceTrend?: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[];
    terrainFactor?: { olPaceSecPerKm: number; roadPaceSecPerKm: number; olSessions: number; roadSessions: number } | null;
  } | null;
  // threshold = [lt1PaceSecPerKm, lt2PaceSecPerKm] — same cached PaceZones shape buildPaceZonesFromLT()
  // produces (lib/fitness/zones.ts), so this just reads the existing calibration, no recompute.
  const cachedThresholdPace = (fitnessCache?.paces as { threshold?: [number, number] } | null)?.threshold ?? null;

  return (
    <TrendsClient
      aeiByWeek={aeiByWeek}
      reByWeek={reByWeek}
      rampRate={rampRate}
      injuryRisk={injuryRisk}
      activeStreak={activeStreak}
      tempSensitivity={tempSensitivity}
      weatherStats={weatherStats}
      easyPaceTrend={easyPaceTrend}
      cadenceScatter={cadenceScatter}
      efByWeek={efByWeek}
      vdotTrend={extraViz?.vdotTrend ?? []}
      ltPaceTrend={extraViz?.ltPaceTrend ?? []}
      currentLT1Pace={cachedThresholdPace?.[0]}
      currentLT2Pace={cachedThresholdPace?.[1]}
      terrainFactor={extraViz?.terrainFactor ?? null}
    />
  );
}
