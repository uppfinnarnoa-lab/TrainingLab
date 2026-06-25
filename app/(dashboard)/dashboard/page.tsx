import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TrendingUp, AlertTriangle, BarChart3, Footprints } from "lucide-react";
import { SyncButton } from "./sync-button";
import { DashboardCards } from "./dashboard-cards";
import { prisma } from "@/lib/db/prisma";
import { startOfWeek, startOfMonth, startOfYear, subDays } from "date-fns";
import { generateInsights } from "@/lib/fitness/insights";
import { computeHrvBaseline, computeRestingHRBaseline, computeReadinessScore, readinessLabel } from "@/lib/garmin/insights";
import { formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import { normalizeAnnualGoalsYear } from "@/lib/sports/annual-goal-metric";

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
    todayPlanned, latestGarmin, garminHistory,
    athleteProfile, trainingGoals,
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
      select: { date: true, hrvNightly: true, sleepScore: true, sleepDuration: true, restingHR: true, bodyBattery: true, stressAvg: true, trainingReadiness: true, spo2Avg: true },
    }),
    prisma.garminDailySummary.findMany({
      where: { userId, date: { gte: subDays(now, 67) } }, // 60-day HRV/restHR baseline + 7-day rolling window
      orderBy: { date: "asc" },
      select: { date: true, hrvNightly: true, restingHR: true },
    }),
    prisma.athleteProfile.findUnique({
      where: { userId },
      select: { annualGoals: true },
    }),
    prisma.trainingGoal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
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

  // Readiness score — shared with the Stats "Recovery" tab (lib/garmin/insights.ts)
  const showReadiness = fitnessCache != null || latestGarmin != null;
  const hrvBaseline = computeHrvBaseline(garminHistory, now);
  const restHRBaseline = computeRestingHRBaseline(garminHistory, now);
  const readinessResult = showReadiness ? computeReadinessScore({
    hrvRolling7dAvg:   hrvBaseline.rolling7dAvg,
    hrvBaseline60dAvg: hrvBaseline.baseline60dAvg,
    tsb:               todayLoad.tsb,
    sleepScore:        latestGarmin?.sleepScore ?? null,
    restHRDeltaBpm:    restHRBaseline.deltaBpm,
  }, latestGarmin?.trainingReadiness ?? null) : null;
  const readiness = readinessResult?.score != null
    ? { score: readinessResult.score, ...readinessLabel(readinessResult.score) }
    : null;

  // Annual goals
  const goalsThisYear = normalizeAnnualGoalsYear(
    (athleteProfile?.annualGoals as Record<string, Record<string, unknown>> | null)?.[currentYear]
  );
  const ytdBySport: Record<string, { distanceM: number; movingTimeSec: number }> = {};
  if (Object.keys(goalsThisYear).length > 0) {
    const ytdActivities = await prisma.activity.findMany({
      where: { userId, startDateLocal: { gte: yearStart } },
      select: { sportType: true, distance: true, movingTime: true },
    });
    for (const act of ytdActivities) {
      const e = ytdBySport[act.sportType] ?? { distanceM: 0, movingTimeSec: 0 };
      e.distanceM += act.distance;
      e.movingTimeSec += act.movingTime;
      ytdBySport[act.sportType] = e;
    }
  }

  // Training goals progress
  type GoalProgress = { sport: string; metric: string; period: string; target: number; actual: number };
  const goalProgress: GoalProgress[] = [];
  if (trainingGoals.length > 0) {
    // yearStart is always the earliest of the three period boundaries (year ⊇ month ⊇ week) —
    // fetch from there directly. A prior double-ternary here could never actually resolve to
    // yearStart (month/week start are always chronologically after year start), so it silently
    // queried from monthStart instead — making "year" progress identical to "month" progress.
    const goalActivities = await prisma.activity.findMany({
      where: { userId, startDateLocal: { gte: yearStart } },
      select: { sportType: true, distance: true, movingTime: true, startDateLocal: true },
    });
    const bySportPeriod: Record<string, Record<string, { km: number; min: number }>> = {};
    for (const act of goalActivities) {
      const sport = act.sportType;
      const km = act.distance / 1000;
      const min = act.movingTime / 60;
      const d = act.startDateLocal;
      const periods: string[] = [];
      if (d >= weekStart) periods.push("week");
      if (d >= monthStart) periods.push("month");
      if (d >= yearStart) periods.push("year");
      for (const p of periods) {
        for (const key of [sport, ""]) {
          if (!bySportPeriod[key]) bySportPeriod[key] = {};
          if (!bySportPeriod[key][p]) bySportPeriod[key][p] = { km: 0, min: 0 };
          bySportPeriod[key][p].km += km;
          bySportPeriod[key][p].min += min;
        }
      }
    }
    for (const g of trainingGoals) {
      const agg = bySportPeriod[g.sport]?.[g.period] ?? { km: 0, min: 0 };
      goalProgress.push({ sport: g.sport, metric: g.metric, period: g.period, target: g.target, actual: g.metric === "distance" ? agg.km : agg.min });
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
              <p className="text-xs text-muted uppercase tracking-wide">Planned today</p>
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
              <span className="text-muted/50">{garminDateLabel(latestGarmin.date, now)}</span>
              {latestGarmin.sleepScore != null && (
                <span>😴 Sleep {latestGarmin.sleepScore}/100</span>
              )}
              {latestGarmin.sleepDuration != null && (
                <span>{(latestGarmin.sleepDuration / 3600).toFixed(1)}h</span>
              )}
              {latestGarmin.hrvNightly != null && (
                <span>💗 HRV {Math.round(latestGarmin.hrvNightly)} ms</span>
              )}
              {latestGarmin.bodyBattery != null && (
                <span>⚡ BB {latestGarmin.bodyBattery}/100</span>
              )}
              {latestGarmin.trainingReadiness != null && (
                <span>🎯 Readiness {latestGarmin.trainingReadiness}/100</span>
              )}
              {latestGarmin.stressAvg != null && (
                <span>🧠 Stress {latestGarmin.stressAvg}/100</span>
              )}
              {latestGarmin.spo2Avg != null && (
                <span>🩸 SpO₂ {latestGarmin.spo2Avg.toFixed(0)}%</span>
              )}
            </div>
          )}

          {!latestGarmin && (
            <p className="text-xs text-muted">Connect Garmin in Settings for full readiness data.</p>
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

      {/* Training goals progress */}
      {goalProgress.length > 0 && (
        <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">Training Goals</p>
            <a href="/settings/goals" className="text-xs text-muted hover:text-accent transition">Edit →</a>
          </div>
          <div className="space-y-3">
            {goalProgress.map(g => {
              const pct = Math.min(Math.round((g.actual / g.target) * 100), 100);
              const onTrack = pct >= 80;
              const periodLabel = g.period === "week" ? "week" : g.period === "month" ? "month" : "year";
              const sportLabel = g.sport === "" ? "All sports" : g.sport;
              const actualStr = g.metric === "distance" ? `${g.actual.toFixed(0)} km` : `${Math.round(g.actual / 60 * 10) / 10} hours`;
              const targetStr = g.metric === "distance" ? `${g.target} km` : `${Math.round(g.target / 60 * 10) / 10} hours`;
              return (
                <div key={`${g.sport}-${g.metric}-${g.period}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">{sportLabel} · {periodLabel}</span>
                    <span className={onTrack ? "text-accent" : pct >= 50 ? "text-primary" : "text-warning"}>
                      {actualStr} / {targetStr} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${onTrack ? "bg-accent" : pct >= 50 ? "bg-blue-400" : "bg-warning"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Annual goal widget */}
      {Object.keys(goalsThisYear).length > 0 && (
        <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">{currentYear} — Annual Goal</p>
            <a href="/settings/profile" className="text-xs text-muted hover:text-accent transition">Edit →</a>
          </div>
          <div className="space-y-3">
            {Object.entries(goalsThisYear).map(([sport, goal]) => {
              if (!goal.target || goal.target <= 0) return null; // no real target set — skip rather than show NaN%
              const isTime = goal.metric === "time";
              const ytd = ytdBySport[sport] ?? { distanceM: 0, movingTimeSec: 0 };
              const ytdDisplay = isTime ? Math.round(ytd.movingTimeSec / 60 / 60 * 10) / 10 : Math.round(ytd.distanceM / 1000);
              const targetDisplay = isTime ? Math.round(goal.target / 60 * 10) / 10 : goal.target;
              const unit = isTime ? "hours" : "km";
              const pct = Math.min(Math.round((ytdDisplay / targetDisplay) * 100), 100);
              const projected = Math.round((ytdDisplay / dayOfYear) * 365 * 10) / 10;
              const onTrack = projected >= targetDisplay * 0.95;
              return (
                <div key={sport} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">{sport}</span>
                    <span className={onTrack ? "text-accent" : "text-warning"}>
                      {ytdDisplay} / {targetDisplay} {unit} ({pct}%)
                      {onTrack ? " ✓" : ` — projected ${projected} ${unit}`}
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

function ACWRCard({ acwr }: { acwr: number }) {
  const color = acwr > 1.5 ? "#F87171" : acwr > 1.3 ? "#FBBF24" : "#6EE7B7";
  const label = acwr > 1.5 ? "Injury risk — ease off" : acwr > 1.3 ? "High load — be careful" : acwr >= 0.8 ? "Green zone — good balance" : "Low load";
  const pct = Math.min(acwr / 2, 1) * 100;
  return (
    <div className="rounded-xl bg-surface border border-border p-4 flex items-center gap-6">
      <div className="shrink-0">
        <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">ACWR — Load Ratio</p>
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

function garminDateLabel(garminDate: Date, now: Date): string {
  const daysDiff = Math.round((now.getTime() - new Date(garminDate).getTime()) / 86_400_000);
  if (daysDiff <= 0) return "Today";
  if (daysDiff === 1) return "Yesterday";
  return `${daysDiff} days ago`;
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
