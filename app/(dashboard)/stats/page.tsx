import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { StatsClient } from "./stats-client";
import { buildHRZones, buildPaceZones, estimateMaxHR, estimateMaxHRFromThreshold, ltBoundaries } from "@/lib/fitness/zones";
import { computeTSS, buildLoadCurve } from "@/lib/fitness/training-load";
import { estimateVO2max, predictRaceTime, tsbAdjustedRaceTime } from "@/lib/fitness/vo2max";
import { RACE_DISTANCES } from "@/lib/fitness/paces";
import { subDays, format, startOfWeek, startOfYear } from "date-fns";

type A = {
  id: string; sportType: string; startDate: Date; name: string;
  distance: number; movingTime: number; totalElevationGain: number;
  averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeed: number | null; isRace: boolean;
  bestEfforts: unknown;
};

export default async function StatsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [profile, activities, garminRecent] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(new Date(), 730) } },
      orderBy: { startDate: "asc" },
      select: {
        id: true, sportType: true, startDate: true, name: true,
        distance: true, movingTime: true, totalElevationGain: true,
        averageHeartrate: true, maxHeartrate: true,
        averageSpeed: true, isRace: true, bestEfforts: true,
      },
    }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(new Date(), 30) } },
      orderBy: { date: "asc" },
    }),
  ]);

  // ── HR / zones ──────────────────────────────────────────────────────
  const maxHRs = (activities as A[]).flatMap(a => a.maxHeartrate ? [a.maxHeartrate] : []);

  // Threshold-based max HR estimation (more reliable than raw peak)
  // Use avgHR from hard runs where avgHR > 85% of observed max
  const observedMax = maxHRs.length > 0 ? Math.max(...maxHRs) : 200;
  const thresholdHRs = (activities as A[])
    .filter(a => a.averageHeartrate && a.averageHeartrate > observedMax * 0.82
      && a.sportType.toLowerCase().includes("run"))
    .map(a => a.averageHeartrate!);
  const thresholdBasedMax = estimateMaxHRFromThreshold(thresholdHRs);

  const maxHR = profile?.maxHeartRate
    ?? thresholdBasedMax      // prefer threshold-based (more robust)
    ?? estimateMaxHR(maxHRs); // fallback to 98th percentile of observed

  const restHR = profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? 50;
  const hrZones = buildHRZones(maxHR, restHR);

  // ── VO2max ──────────────────────────────────────────────────────────
  const vo2max = estimateVO2max(
    activities.map((a: A) => ({
      distanceM: a.distance, timeSec: a.movingTime,
      avgHR: a.averageHeartrate, isRace: a.isRace,
      sportType: a.sportType, name: a.name, bestEfforts: a.bestEfforts,
    })),
    maxHR, restHR,
  );
  const paceZones = buildPaceZones(vo2max.vdot);

  // ── Training load ───────────────────────────────────────────────────
  const dailyTSSMap = new Map<string, number>();
  for (const a of activities) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
    dailyTSSMap.set(key, (dailyTSSMap.get(key) ?? 0) + tss);
  }
  const fullCurve = buildLoadCurve(dailyTSSMap, subDays(new Date(), 365), new Date());
  const loadCurve = fullCurve.slice(-112);
  const todayLoad = fullCurve.at(-1) ?? { atl: 0, ctl: 0, tsb: 0, tss: 0, date: "" };

  // ── Weekly volumes ──────────────────────────────────────────────────
  const weeklyVolumes: Record<string, Record<string, { km: number; timeSec: number }>> = {};
  const twelveWeeksAgo = subDays(new Date(), 84);
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo)) {
    const weekKey = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const sport = normalizeSport(a.sportType);
    if (!weeklyVolumes[weekKey]) weeklyVolumes[weekKey] = {};
    if (!weeklyVolumes[weekKey][sport]) weeklyVolumes[weekKey][sport] = { km: 0, timeSec: 0 };
    weeklyVolumes[weekKey][sport].km += a.distance / 1000;
    weeklyVolumes[weekKey][sport].timeSec += a.movingTime;
  }
  // Round values
  for (const wk of Object.values(weeklyVolumes))
    for (const s of Object.values(wk)) s.km = Math.round(s.km * 10) / 10;

  // ── HR zone distribution ────────────────────────────────────────────
  const zoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const a of activities.filter((x: A) => x.startDate >= twelveWeeksAgo && x.averageHeartrate)) {
    const hr = a.averageHeartrate!;
    const z = hr < hrZones.z1[1] ? 1 : hr < hrZones.z2[1] ? 2 : hr < hrZones.z3[1] ? 3 : hr < hrZones.z4[1] ? 4 : 5;
    zoneSeconds[`z${z}`] += a.movingTime;
  }

  // ── Overview totals ─────────────────────────────────────────────────
  const now = new Date();
  const weekStart  = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart  = startOfYear(now);
  const sum = (arr: typeof activities) => ({
    km:   Math.round(arr.reduce((s: number, a: A) => s + a.distance / 1000, 0) * 10) / 10,
    timeSec: arr.reduce((s: number, a: A) => s + a.movingTime, 0),
    count: arr.length,
  });
  const lyWeekStart  = subDays(weekStart, 364);
  const lyMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lyYtdStart   = startOfYear(new Date(now.getFullYear() - 1, 0, 1));
  const lyYtdEnd     = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const lyMonthEnd   = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);

  const thisWeek  = sum(activities.filter((a: A) => a.startDate >= weekStart));
  const thisMonth = sum(activities.filter((a: A) => a.startDate >= monthStart));
  const ytd       = sum(activities.filter((a: A) => a.startDate >= yearStart));
  const lyWeek    = sum(activities.filter((a: A) => a.startDate >= lyWeekStart && a.startDate < weekStart && a.startDate <= subDays(weekStart, 357)));
  const lyMonth   = sum(activities.filter((a: A) => a.startDate >= lyMonthStart && a.startDate <= lyMonthEnd));
  const lyYtd     = sum(activities.filter((a: A) => a.startDate >= lyYtdStart && a.startDate <= lyYtdEnd));

  // Sparklines: 8-week weekly distance total
  const sparklines = Array.from({ length: 8 }, (_, i) => {
    const wkStart = startOfWeek(subDays(now, (7 - i) * 7), { weekStartsOn: 1 });
    const key = format(wkStart, "yyyy-MM-dd");
    return Object.values(weeklyVolumes[key] ?? {}).reduce((s, v) => s + v.km, 0);
  });

  // Race predictions
  const predictions = RACE_DISTANCES.map(({ label, meters }) => ({
    label, meters,
    peak: predictRaceTime(vo2max.vdot, meters),
    today: tsbAdjustedRaceTime(predictRaceTime(vo2max.vdot, meters), todayLoad.tsb),
  }));

  return (
    <div className="space-y-2">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Statistics</h1>
        <p className="text-sm text-muted mt-1">Last 12 weeks · {activities.length.toLocaleString()} activities</p>
      </div>

      <StatsClient
        overview={{ thisWeek, thisMonth, ytd, lyWeek, lyMonth, lyYtd }}
        sparklines={sparklines}
        weeklyVolumes={weeklyVolumes}
        loadCurve={loadCurve}
        todayLoad={todayLoad}
        zoneSeconds={zoneSeconds}
        hrZones={hrZones}
        ltBounds={ltBoundaries(hrZones)}
        vo2max={vo2max}
        paceZones={paceZones}
        predictions={predictions}
      />
    </div>
  );
}

function normalizeSport(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("run") || s.includes("trail")) return "Running";
  if (s.includes("ride") || s.includes("cycl")) return "Cycling";
  if (s.includes("nordicski") || s.includes("backcountry")) return "Skiing";
  if (s.includes("rollerski")) return "Roller Skiing";
  if (s.includes("orienteer")) return "Orienteering";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "Strength";
  return t;
}
