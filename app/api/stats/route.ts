import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { buildHRZones, buildPaceZones, estimateMaxHR } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve } from "@/lib/fitness/training-load";
import { estimateVO2max, predictRaceTime, tsbAdjustedRaceTime } from "@/lib/fitness/vo2max";
import { RACE_DISTANCES } from "@/lib/fitness/paces";
import { subDays, format, startOfWeek, startOfYear } from "date-fns";

type A = {
  sportType: string; startDate: Date;
  distance: number; movingTime: number; totalElevationGain: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Fetch athlete profile and last ~2 years of activities
  const [profile, allActivities, garminRecent] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(new Date(), 730) } },
      orderBy: { startDate: "asc" },
      select: {
        id: true, sportType: true, startDate: true, distance: true,
        movingTime: true, totalElevationGain: true,
        averageHeartrate: true, maxHeartrate: true, averageSpeed: true,
        averageCadence: true, isRace: true,
      },
    }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 30) } },
      orderBy: { date: "asc" },
    }),
  ]);

  // ── HR zones ──────────────────────────────────────────────────────────
  const maxHRs = (allActivities as A[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);
  const maxHR = profile?.maxHeartRate ?? estimateMaxHR(maxHRs);
  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;
  const hrZones = buildHRZones(maxHR, restHR);

  // ── VO2max + VDOT ─────────────────────────────────────────────────────
  const vo2max = estimateVO2max(
    allActivities.map((a: A) => ({
      distanceM: a.distance,
      timeSec: a.movingTime,
      avgHR: a.averageHeartrate,
      isRace: a.isRace,
      sportType: a.sportType,
    })),
    maxHR,
    restHR,
  );
  const paceZones = buildPaceZones(vo2max.vdot);

  // ── TSS per activity ──────────────────────────────────────────────────
  const activityTSS = allActivities.map((a: A) => ({
    date: format(a.startDate, "yyyy-MM-dd"),
    tss: computeTSS({
      movingTimeSec: a.movingTime,
      avgHR: a.averageHeartrate,
      maxHR,
      restHR,
    }),
  }));

  const dailyTSSMap = new Map<string, number>();
  for (const { date, tss } of activityTSS) {
    dailyTSSMap.set(date, (dailyTSSMap.get(date) ?? 0) + tss);
  }

  // ── ATL/CTL/TSB — last 16 weeks for chart ────────────────────────────
  const loadStart = subDays(new Date(), 365); // need full year to warm up CTL
  const fullCurve = buildLoadCurve(dailyTSSMap, loadStart, new Date());
  const loadCurve = fullCurve.slice(-112); // last 16 weeks for chart display
  const todayLoad = fullCurve.at(-1) ?? { atl: 0, ctl: 0, tsb: 0, tss: 0, date: "" };

  // ── Weekly volumes — last 12 weeks ────────────────────────────────────
  const weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>> = {};
  const twelveWeeksAgo = subDays(new Date(), 84);
  const recentActivities = allActivities.filter((a: A) => a.startDate >= twelveWeeksAgo);

  for (const a of recentActivities) {
    const weekStart = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    if (!weeklyVolumes[weekStart]) weeklyVolumes[weekStart] = {};
    const sport = normalizeSport(a.sportType);
    if (!weeklyVolumes[weekStart][sport]) weeklyVolumes[weekStart][sport] = { km: 0, timeSec: 0 };
    weeklyVolumes[weekStart][sport].km += a.distance / 1000;
    weeklyVolumes[weekStart][sport].timeSec += a.movingTime;
  }

  // ── HR zone distribution — last 12 weeks ─────────────────────────────
  const zoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const a of recentActivities) {
    if (!a.averageHeartrate) continue;
    const zone = classifyZoneSimple(a.averageHeartrate, hrZones);
    zoneSeconds[`z${zone}`] = (zoneSeconds[`z${zone}`] ?? 0) + a.movingTime;
  }

  // ── Overview: this week / this month / YTD ────────────────────────────
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart  = startOfYear(now);

  const thisWeek  = sumActivities(allActivities.filter((a: A) => a.startDate >= weekStart));
  const thisMonth = sumActivities(allActivities.filter((a: A) => a.startDate >= monthStart));
  const ytd       = sumActivities(allActivities.filter((a: A) => a.startDate >= yearStart));

  // YoY comparison
  const lastYearWeekStart  = subDays(weekStart, 364);
  const lastYearWeekEnd    = subDays(weekStart, 357);
  const lastYearMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lastYearMonthEnd   = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);
  const lastYearYtdEnd     = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const lastYearYtdStart   = startOfYear(new Date(now.getFullYear() - 1, 0, 1));

  const lyWeek  = sumActivities(allActivities.filter((a: A) => a.startDate >= lastYearWeekStart && a.startDate <= lastYearWeekEnd));
  const lyMonth = sumActivities(allActivities.filter((a: A) => a.startDate >= lastYearMonthStart && a.startDate <= lastYearMonthEnd));
  const lyYtd   = sumActivities(allActivities.filter((a: A) => a.startDate >= lastYearYtdStart && a.startDate <= lastYearYtdEnd));

  // ── Race predictions ──────────────────────────────────────────────────
  const predictions = RACE_DISTANCES.map(({ label, meters }) => {
    const peak = predictRaceTime(vo2max.vdot, meters);
    const today = tsbAdjustedRaceTime(peak, todayLoad.tsb);
    return { label, meters, peak, today };
  });

  // ── Sparklines — 8-week weekly distance for overview cards ────────────
  const sparklines: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const wkStart = startOfWeek(subDays(now, i * 7), { weekStartsOn: 1 });
    const wkKey = format(wkStart, "yyyy-MM-dd");
    const wkData = weeklyVolumes[wkKey];
    const km = wkData ? Object.values(wkData).reduce((s, v) => s + v.km, 0) : 0;
    sparklines.push(Math.round(km * 10) / 10);
  }

  return NextResponse.json({
    hrZones,
    paceZones,
    vo2max,
    todayLoad,
    loadCurve,
    weeklyVolumes,
    zoneSeconds,
    overview: { thisWeek, thisMonth, ytd, lyWeek, lyMonth, lyYtd },
    predictions,
    sparklines,
    maxHR,
    restHR,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeSport(sportType: string): string {
  const t = sportType.toLowerCase();
  if (t.includes("run") || t.includes("trail")) return "Running";
  if (t.includes("ride") || t.includes("cycl") || t.includes("virtual")) return "Cycling";
  if (t.includes("nordicski") || t.includes("backcountryski")) return "Skiing";
  if (t.includes("rollerski")) return "Roller Skiing";
  if (t.includes("orienteer")) return "Orienteering";
  if (t.includes("weight") || t.includes("strength") || t.includes("crossfit") || t.includes("workout")) return "Strength";
  return sportType;
}

function classifyZoneSimple(avgHR: number, zones: ReturnType<typeof buildHRZones>): number {
  if (avgHR < zones.z1[1]) return 1;
  if (avgHR < zones.z2[1]) return 2;
  if (avgHR < zones.z3[1]) return 3;
  if (avgHR < zones.z4[1]) return 4;
  return 5;
}

type ActivityRow = {
  distance: number;
  movingTime: number;
  totalElevationGain: number;
};

function sumActivities(activities: ActivityRow[]) {
  return {
    km: Math.round(activities.reduce((s, a) => s + a.distance / 1000, 0) * 10) / 10,
    timeSec: activities.reduce((s, a) => s + a.movingTime, 0),
    count: activities.length,
    elevationM: Math.round(activities.reduce((s, a) => s + a.totalElevationGain, 0)),
  };
}
