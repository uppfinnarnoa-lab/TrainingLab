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
  const lyToday     = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  // Day-of-year for on-pace projection (1-based)
  const dayOfYear = Math.max(1, Math.ceil((now.getTime() - yearStart.getTime()) / 86400000));

  const [
    activityCount, stravaAccount, fitnessCache,
    weekData, monthData, ytdData,
    runWeek, runMonth, runYtd,
    prev4w, runLyYtd,
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
  ]);

  // Use FitnessCache for ATL/CTL/TSB — eliminates the 365-day activity fetch
  const todayLoad = {
    ctl: fitnessCache?.ctl ?? 0,
    atl: fitnessCache?.atl ?? 0,
    tsb: fitnessCache?.tsb ?? 0,
  };
  const acwr = fitnessCache?.acwr ?? null;

  const avgWeekKm4w = prev4w.km / 1000 / 4;
  const runYtdKm = runYtd.km / 1000;
  const onPaceKm = Math.round((runYtdKm / dayOfYear) * 365);
  const lyYtdKm  = Math.round(runLyYtd.km / 1000);

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

      {/* Stats grid with All sports / Running toggle */}
      <DashboardCards
        all={{
          week:  { km: weekData.km / 1000,  sec: weekData.sec,  count: weekData.count },
          month: { km: monthData.km / 1000, sec: monthData.sec, count: monthData.count },
          ytd:   { km: ytdData.km / 1000,   sec: ytdData.sec,   count: ytdData.count },
        }}
        run={{
          week:  { km: runWeek.km / 1000,  sec: runWeek.sec,  count: runWeek.count },
          month: { km: runMonth.km / 1000, sec: runMonth.sec, count: runMonth.count },
          ytd:   { km: runYtd.km / 1000,   sec: runYtd.sec,   count: runYtd.count },
          onPaceKm,
          lyYtdKm,
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
    </div>
  );
}

function ACWRCard({ acwr }: { acwr: number }) {
  const color = acwr > 1.5 ? "#F87171" : acwr > 1.3 ? "#FBBF24" : "#6EE7B7";
  const label = acwr > 1.5 ? "Skaderisk — ta det lugnt" : acwr > 1.3 ? "Hög belastning — se upp" : acwr >= 0.8 ? "Grön zon — bra balans" : "Låg belastning";
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
        <p className="text-xs text-muted mt-1">Säker zon 0.8–1.3 · Källa: 7-dagars / 28-dagars snittbelastning</p>
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
