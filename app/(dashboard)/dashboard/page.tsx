import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TrendingUp, AlertTriangle, BarChart3, Footprints } from "lucide-react";
import { SyncButton } from "./sync-button";
import { DashboardCards } from "./dashboard-cards";
import { prisma } from "@/lib/db/prisma";
import { startOfWeek, startOfMonth, startOfYear, subDays } from "date-fns";
import { generateInsights } from "@/lib/fitness/insights";
import { formatDuration } from "@/lib/utils";
import { format } from "date-fns";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(0)} km`;
}

async function aggSince(userId: string, since: Date, sportFilter?: string, until?: Date) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    userId,
    startDateLocal: {
      gte: new Date(localDateStr(since)),
      ...(until ? { lte: new Date(localDateStr(until)) } : {}),
    },
  };
  if (sportFilter) where.sportType = { contains: sportFilter, mode: "insensitive" };
  const r = await prisma.activity.aggregate({
    where,
    _sum: { distance: true, movingTime: true },
    _count: true,
  });
  return { km: r._sum.distance ?? 0, sec: r._sum.movingTime ?? 0, count: r._count };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const now = new Date();
  const weekStart  = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const yearStart  = startOfYear(now);
  const fourWeeksAgo = subDays(now, 28);

  // Last-year same-day window for YTD comparison
  const lyYearStart = new Date(yearStart.getFullYear() - 1, 0, 1);
  const lyYearEnd   = new Date(now.getFullYear() - 1, 11, 31); // Dec 31 last year — full year total
  const lyToday     = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  // Day-of-year for on-pace projection (1-based)
  const dayOfYear = Math.max(1, Math.ceil((now.getTime() - yearStart.getTime()) / 86400000));

  const todayStr = localDateStr(now);
  const currentYear = now.getFullYear().toString();

  const [
    activityCount, stravaAccount, fitnessCache,
    weekData, monthData, ytdData,
    runWeek, runMonth, runYtd,
    prev4w, runLyYtd, allLyYtd, runLyFull, allLyFull,
    todayPlanned, latestGarmin, garmin7d,
    athleteProfile,
  ] = await Promise.all([
    prisma.activity.count({ where: { userId } }),
    prisma.stravaAccount.findUnique({ where: { userId }, select: { totalSynced: true, lastSyncAt: true } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    aggSince(userId, weekStart),
    aggSince(userId, monthStart),
    aggSince(userId, yearStart),
    aggSince(userId, weekStart,  "run"),
    aggSince(userId, monthStart, "run"),
    aggSince(userId, yearStart,  "run"),
    aggSince(userId, fourWeeksAgo),
    aggSince(userId, lyYearStart, "run", lyToday),
    aggSince(userId, lyYearStart, undefined, lyToday),
    aggSince(userId, lyYearStart, "run", lyYearEnd),
    aggSince(userId, lyYearStart, undefined, lyYearEnd),
    prisma.plannedWorkout.findMany({
      where: { userId, date: new Date(todayStr) },
      select: { id: true, name: true, sportType: true, targetDuration: true, targetDistance: true, notes: true },
    }),
    prisma.garminDailySummary.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: { date: true, hrvNightly: true, sleepScore: true, sleepDuration: true, restingHR: true, bodyBattery: true },
    }),
    prisma.garminDailySummary.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 8,
      select: { date: true, hrvNightly: true },
    }),
    prisma.athleteProfile.findUnique({
      where: { userId },
      select: { annualGoals: true },
    }),
  ]);

  // Use FitnessCache for ATL/CTL/TSB — eliminates the 365-day activity fetch
  const todayLoad = {
    ctl: fitnessCache?.ctl ?? 0,
    atl: fitnessCache?.atl ?? 0,
    tsb: fitnessCache?.tsb ?? 0,
  };
  const acwr = fitnessCache?.acwr ?? null;

  const avgWeekKm4w = prev4w.km / 1000 / 4;
  const runYtdKm  = runYtd.km / 1000;
  const allYtdKm  = ytdData.km / 1000;
  const weeksElapsed = dayOfYear / 7;

  const runOnPaceKm    = Math.round((runYtdKm / dayOfYear) * 365);
  const allOnPaceKm    = Math.round((allYtdKm / dayOfYear) * 365);
  const runLyYtdKm     = Math.round(runLyYtd.km / 1000);
  const allLyYtdKm     = Math.round(allLyYtd.km / 1000);
  const runLyFullKm    = Math.round(runLyFull.km / 1000);
  const allLyFullKm    = Math.round(allLyFull.km / 1000);
  const runAvgWeekKm   = Math.round((runYtdKm / weeksElapsed) * 10) / 10;
  const allAvgWeekKm   = Math.round((allYtdKm / weeksElapsed) * 10) / 10;

  // Keep legacy alias for backward compat in the component
  const onPaceKm = runOnPaceKm;
  const lyYtdKm  = runLyYtdKm;

  // Readiness score
  const hrv7dValues = (garmin7d as { date: Date; hrvNightly: number | null }[])
    .map(g => g.hrvNightly)
    .filter((v): v is number => v != null);
  const showReadiness = fitnessCache != null || latestGarmin != null;
  const readiness = showReadiness ? computeReadiness(todayLoad.tsb, latestGarmin, hrv7dValues) : null;

  // Annual goals
  const annualGoalsRaw = athleteProfile?.annualGoals as Record<string, Record<string, number>> | null;
  const goalsThisYear = annualGoalsRaw?.[currentYear] ?? {};
  const ytdBySport: Record<string, number> = {};
  if (Object.keys(goalsThisYear).length > 0) {
    const ytdActivities = await prisma.activity.findMany({
      where: { userId, startDateLocal: { gte: yearStart } },
      select: { sportType: true, distance: true },
    });
    for (const act of ytdActivities) {
      ytdBySport[act.sportType] = (ytdBySport[act.sportType] ?? 0) + act.distance;
    }
  }

  const insights = generateInsights({
    weekKm:  weekData.km / 1000,   weekSec:  weekData.sec,   weekCount: weekData.count,
    monthKm: monthData.km / 1000,  monthSec: monthData.sec,
    ytdKm:   ytdData.km / 1000,    ytdSec:   ytdData.sec,
    ctl:     todayLoad.ctl, atl: todayLoad.atl, tsb: todayLoad.tsb,
    vo2max:  fitnessCache?.vo2max ?? null,
    vdot:    fitnessCache?.vdot ?? null,
    maxHR:   fitnessCache?.maxHR ?? null,
    avgWeekKm4w,
    runKmThisWeek: runWeek.km / 1000,
    runKmYtd:      runYtd.km / 1000,
    totalActivities: activityCount,
  });

  const hasActivities = activityCount > 0;
  const hasRun = runYtd.km > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Dashboard</h1>
          <p className="text-sm text-muted mt-1">Welcome back, {session.user.name ?? session.user.email}</p>
        </div>
        {stravaAccount && (
          <SyncButton lastSyncAt={stravaAccount.lastSyncAt?.toISOString() ?? null} />
        )}
      </div>

      {/* Today panel */}
      {(todayPlanned.length > 0 || latestGarmin) && (
        <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">
              {format(now, "EEEE d MMMM")}
            </p>
            {readiness && (
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: readiness.color }} />
                <span className="text-xs font-medium" style={{ color: readiness.color }}>
                  Readiness {readiness.score}/100 — {readiness.label}
                </span>
              </div>
            )}
          </div>

          {todayPlanned.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted uppercase tracking-wide">Planerat idag</p>
              {(todayPlanned as { id: string; name: string; sportType: string; targetDuration: number | null; targetDistance: number | null; notes: string | null }[]).map(pw => (
                <div key={pw.id} className="flex items-center gap-3 rounded-xl bg-surface-2 border border-border px-3 py-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-primary">{pw.name}</p>
                    <p className="text-xs text-muted">
                      {pw.sportType}
                      {pw.targetDuration ? ` · ${Math.round(pw.targetDuration / 60)} min` : ""}
                      {pw.targetDistance ? ` · ${(pw.targetDistance / 1000).toFixed(1)} km` : ""}
                    </p>
                  </div>
                  <a href="/planner" className="text-xs text-accent hover:underline shrink-0">Planner →</a>
                </div>
              ))}
            </div>
          )}

          {latestGarmin && (
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              {latestGarmin.sleepScore != null && (
                <span>😴 Sömn {latestGarmin.sleepScore}/100</span>
              )}
              {latestGarmin.sleepDuration != null && (
                <span>{(latestGarmin.sleepDuration / 3600).toFixed(1)}h</span>
              )}
              {latestGarmin.hrvNightly != null && (
                <span>💗 HRV {Math.round(latestGarmin.hrvNightly)}</span>
              )}
              {latestGarmin.bodyBattery != null && (
                <span>⚡ Body Battery {latestGarmin.bodyBattery}</span>
              )}
            </div>
          )}

          {!latestGarmin && (
            <p className="text-xs text-muted">Anslut Garmin i Inställningar för fullständig readiness-data.</p>
          )}
        </div>
      )}

      {/* Stats grid with All sports / Running toggle */}
      <DashboardCards
        all={{
          week:  { km: weekData.km / 1000,  sec: weekData.sec,  count: weekData.count },
          month: { km: monthData.km / 1000, sec: monthData.sec, count: monthData.count },
          ytd:   { km: ytdData.km / 1000,   sec: ytdData.sec,   count: ytdData.count },
          onPaceKm: allOnPaceKm,
          lyYtdKm:  allLyYtdKm,
          lyFullYearKm: allLyFullKm,
          avgWeekKm: allAvgWeekKm,
        }}
        run={{
          week:  { km: runWeek.km / 1000,  sec: runWeek.sec,  count: runWeek.count },
          month: { km: runMonth.km / 1000, sec: runMonth.sec, count: runMonth.count },
          ytd:   { km: runYtd.km / 1000,   sec: runYtd.sec,   count: runYtd.count },
          onPaceKm,
          lyYtdKm,
          lyFullYearKm: runLyFullKm,
          avgWeekKm: runAvgWeekKm,
        }}
        fitnessLabel={fitnessCache ? "Fitness (CTL)" : "Activities synced"}
        fitnessPrimary={fitnessCache ? todayLoad.ctl.toFixed(0) : activityCount.toLocaleString()}
        fitnessSub={fitnessCache
          ? `TSB ${todayLoad.tsb > 0 ? "+" : ""}${todayLoad.tsb.toFixed(0)} · VO2max ${fitnessCache.vo2max.toFixed(1)}`
          : stravaAccount ? `${stravaAccount.totalSynced.toLocaleString()} total` : "Connect Strava"}
      />

      {/* ACWR load gauge */}
      {acwr !== null && (
        <ACWRCard acwr={acwr} />
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
              ins.type === "positive" ? "border-accent/20 bg-accent/5"
              : ins.type === "warning" ? "border-warning/20 bg-warning/5"
              : "border-border bg-surface"
            }`}>
              <span className={`shrink-0 mt-0.5 ${ins.type === "positive" ? "text-accent" : ins.type === "warning" ? "text-warning" : "text-muted"}`}>
                {ins.type === "positive"
                  ? <TrendingUp size={15} />
                  : ins.type === "warning"
                  ? <AlertTriangle size={15} />
                  : <BarChart3 size={15} />}
              </span>
              <p className="text-sm leading-snug text-primary">{ins.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Nav shortcuts */}
      {stravaAccount ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: "/stats",   label: "Statistics",        desc: "VO2max, load, zones, predictions" },
            { href: "/planner", label: "Training Planner",  desc: "Calendar, templates, blocks" },
            { href: "/coach",   label: "AI Coach",          desc: "Chat with your personal trainer" },
          ].map(item => (
            <a key={item.href} href={item.href}
              className="rounded-xl bg-surface border border-border p-5 hover:border-accent/40 transition-colors group">
              <p className="font-semibold text-primary group-hover:text-accent transition-colors">{item.label}</p>
              <p className="text-sm text-muted mt-1">{item.desc}</p>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-surface border border-border p-6">
          <h2 className="text-base font-semibold text-primary mb-2">Get started</h2>
          <p className="text-sm text-muted">
            Connect your Strava account in{" "}
            <a href="/settings" className="text-accent hover:underline font-medium">Settings</a>{" "}
            to start syncing your training history.
          </p>
        </div>
      )}

      {/* Annual goal widget */}
      {Object.keys(goalsThisYear).length > 0 && (
        <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">{currentYear} — Årsgoal</p>
            <a href="/settings/profile" className="text-xs text-muted hover:text-accent transition">Ändra →</a>
          </div>
          <div className="space-y-3">
            {Object.entries(goalsThisYear).map(([sport, goalKm]) => {
              const ytdKm = Math.round((ytdBySport[sport] ?? 0) / 1000);
              const pct = Math.min(Math.round((ytdKm / goalKm) * 100), 100);
              const projectedKm = Math.round((ytdKm / dayOfYear) * 365);
              const onTrack = projectedKm >= goalKm * 0.95;
              return (
                <div key={sport} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">{sport}</span>
                    <span className={onTrack ? "text-accent" : "text-warning"}>
                      {ytdKm} / {goalKm} km ({pct}%)
                      {onTrack ? " ✓" : ` — prognos ${projectedKm} km`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${onTrack ? "bg-accent" : "bg-warning"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function computeReadiness(
  tsb: number,
  latestGarmin: { hrvNightly?: number | null; sleepScore?: number | null; restingHR?: number | null } | null,
  hrv7d: number[]
): { score: number; color: string; label: string } {
  let score = 50;

  // TSB (30% weight)
  if (tsb > 10)       score += 15;
  else if (tsb > 0)   score += 8;
  else if (tsb < -25) score -= 20;
  else if (tsb < -10) score -= 10;

  // HRV trend (40% weight)
  if (latestGarmin?.hrvNightly && hrv7d.length >= 3) {
    const baseline = hrv7d.slice(1).reduce((a, b) => a + b, 0) / Math.max(hrv7d.slice(1).length, 1);
    if (baseline > 0) {
      const trendPct = (latestGarmin.hrvNightly - baseline) / baseline * 100;
      if (trendPct > 5)        score += 20;
      else if (trendPct > 0)   score += 8;
      else if (trendPct < -15) score -= 25;
      else if (trendPct < -7)  score -= 12;
    }
  }

  // Sleep score (20% weight)
  if (latestGarmin?.sleepScore != null) {
    score += (latestGarmin.sleepScore - 60) / 5;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));
  const color = score >= 70 ? "#6EE7B7" : score >= 45 ? "#FBBF24" : "#F87171";
  const label = score >= 70 ? "Redo" : score >= 45 ? "Moderat" : "Återhämta";
  return { score, color, label };
}

function ACWRCard({ acwr }: { acwr: number }) {
  const color = acwr > 1.5 ? "#F87171" : acwr > 1.3 ? "#FBBF24" : "#6EE7B7";
  const label = acwr > 1.5 ? "Injury risk — ease off" : acwr > 1.3 ? "High load — be careful" : acwr >= 0.8 ? "Green zone — good balance" : "Low load";
  const pct = Math.min(acwr / 2, 1) * 100;
  return (
    <div className="rounded-xl bg-surface border border-border p-4 flex items-center gap-6">
      <div className="shrink-0">
        <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">ACWR — Belastningskvot</p>
        <p className="text-3xl font-semibold font-mono" style={{ color }}>{acwr.toFixed(2)}</p>
        <p className="text-xs font-medium mt-0.5" style={{ color }}>{label}</p>
      </div>
      <div className="flex-1">
        <div className="relative h-2.5 rounded-full bg-surface-2 overflow-hidden">
          <div className="absolute h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted mt-1 px-0.5">
          <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
        </div>
        <p className="text-xs text-muted mt-1">Safe zone 0.8–1.3 · Source: 7-day / 28-day average load</p>
      </div>
    </div>
  );
}

function StatCard({ label, primary, sub, detail, accent }: {
  label: string; primary: string; sub: string; detail?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl bg-surface border p-4 shadow-sm ${accent ? "border-accent/30" : "border-border"}`}>
      <p className="text-xs font-medium text-muted uppercase tracking-wide">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold font-mono text-primary leading-none">{primary}</p>
      <p className="text-xs text-muted mt-1">{sub}</p>
      {detail && (
        <p className="flex items-center gap-1 text-xs text-accent mt-1.5 font-medium">
          <Footprints size={11} />{detail}
        </p>
      )}
    </div>
  );
}
