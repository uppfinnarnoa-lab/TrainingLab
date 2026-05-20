import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TrendingUp, AlertTriangle, BarChart3, Footprints } from "lucide-react";
import { SyncButton } from "./sync-button";
import { prisma } from "@/lib/db/prisma";
import { startOfWeek, startOfMonth, startOfYear, subDays } from "date-fns";
import { generateInsights } from "@/lib/fitness/insights";
import { formatDuration } from "@/lib/utils";
import { buildLoadCurve, computeTSS } from "@/lib/fitness/training-load";
import { format } from "date-fns";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(0)} km`;
}

async function aggSince(userId: string, since: Date, sportFilter?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId, startDateLocal: { gte: new Date(localDateStr(since)) } };
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

  const [
    activityCount, stravaAccount, fitnessCache,
    weekData, monthData, ytdData,
    runWeek, runYtd,
    prev4w,
    recentActivities,
  ] = await Promise.all([
    prisma.activity.count({ where: { userId } }),
    prisma.stravaAccount.findUnique({ where: { userId }, select: { totalSynced: true, lastSyncAt: true } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    aggSince(userId, weekStart),
    aggSince(userId, monthStart),
    aggSince(userId, yearStart),
    aggSince(userId, weekStart,  "run"),
    aggSince(userId, yearStart,  "run"),
    aggSince(userId, fourWeeksAgo),
    prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(now, 365) } },
      select: { movingTime: true, averageHeartrate: true, maxHeartrate: true, startDate: true },
      orderBy: { startDate: "asc" },
    }),
  ]);

  // Compute ATL/CTL/TSB for insights
  const maxHR  = fitnessCache?.maxHR  ?? 190;
  const restHR = fitnessCache?.restHR ?? 50;
  const tssMap = new Map<string, number>();
  for (const a of recentActivities) {
    const key = format(a.startDate, "yyyy-MM-dd");
    const tss = computeTSS({ movingTimeSec: a.movingTime, avgHR: a.averageHeartrate, maxHR, restHR });
    tssMap.set(key, (tssMap.get(key) ?? 0) + tss);
  }
  const loadCurve = buildLoadCurve(tssMap, subDays(now, 42), now);
  const todayLoad = loadCurve.at(-1) ?? { ctl: 0, atl: 0, tsb: 0 };

  const avgWeekKm4w = prev4w.km / 1000 / 4;

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

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* This week */}
        <StatCard label="This week" primary={hasActivities ? formatKm(weekData.km) : "—"}
          sub={hasActivities ? `${formatDuration(weekData.sec)} · ${weekData.count} sessions` : "No activities yet"}
          detail={hasRun && runWeek.km > 0 ? `Run: ${formatKm(runWeek.km)}` : undefined} />

        {/* This month */}
        <StatCard label="This month" primary={hasActivities ? formatKm(monthData.km) : "—"}
          sub={hasActivities ? formatDuration(monthData.sec) : "Sync Strava to see data"} />

        {/* YTD total */}
        <StatCard label="Year to date" primary={hasActivities ? formatKm(ytdData.km) : "—"}
          sub={hasActivities ? formatDuration(ytdData.sec) : "Sync Strava to see data"}
          detail={hasRun ? `Run: ${formatKm(runYtd.km)} · ${formatDuration(runYtd.sec)}` : undefined}
          accent />

        {/* Fitness */}
        <StatCard
          label={fitnessCache ? "Fitness (CTL)" : "Activities synced"}
          primary={fitnessCache ? todayLoad.ctl.toFixed(0) : activityCount.toLocaleString()}
          sub={fitnessCache
            ? `TSB ${todayLoad.tsb > 0 ? "+" : ""}${todayLoad.tsb.toFixed(0)} · VO2max ${fitnessCache.vo2max.toFixed(1)}`
            : stravaAccount ? `${stravaAccount.totalSynced.toLocaleString()} total` : "Connect Strava"}
        />
      </div>

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
