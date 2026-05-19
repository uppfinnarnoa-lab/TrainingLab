/**
 * Generates human-readable training insights for the dashboard.
 * Pure computation — no AI, no DB calls. Receives pre-fetched data.
 */

import { formatDuration } from "@/lib/utils";

export interface InsightInput {
  weekKm:   number; weekSec: number; weekCount: number;
  monthKm:  number; monthSec: number;
  ytdKm:    number; ytdSec: number;
  ctl:      number; atl: number; tsb: number;
  vo2max:   number | null; vdot: number | null;
  maxHR:    number | null;
  avgWeekKm4w: number; // 4-week average weekly km
  runKmThisWeek: number;
  runKmYtd: number;
  totalActivities: number;
}

export interface Insight {
  type: "positive" | "neutral" | "warning";
  text: string;
}

export function generateInsights(d: InsightInput): Insight[] {
  const insights: Insight[] = [];

  // ── Training load / form ───────────────────────────────────────────────
  if (d.tsb > 15) {
    insights.push({ type: "positive", text: `You're fresh (TSB +${d.tsb.toFixed(0)}) — good time to race or hit a quality session.` });
  } else if (d.tsb < -25) {
    insights.push({ type: "warning", text: `High fatigue (TSB ${d.tsb.toFixed(0)}) — consider an easier day or rest before pushing hard.` });
  } else if (d.tsb >= 0) {
    insights.push({ type: "neutral", text: `Form is balanced (TSB +${d.tsb.toFixed(0)}) — solid training block territory.` });
  }

  // ── Volume vs average ──────────────────────────────────────────────────
  if (d.avgWeekKm4w > 0) {
    const weekVsAvg = ((d.weekKm - d.avgWeekKm4w) / d.avgWeekKm4w) * 100;
    if (d.weekKm === 0) {
      insights.push({ type: "neutral", text: "No activities logged yet this week." });
    } else if (weekVsAvg > 20) {
      insights.push({ type: "warning", text: `This week is ${weekVsAvg.toFixed(0)}% above your 4-week average (${d.weekKm.toFixed(0)} vs ${d.avgWeekKm4w.toFixed(0)} km). Watch overload risk.` });
    } else if (weekVsAvg < -30 && d.weekKm > 0) {
      insights.push({ type: "neutral", text: `Lighter week — ${d.weekKm.toFixed(0)} km vs your usual ${d.avgWeekKm4w.toFixed(0)} km/week.` });
    } else if (d.weekKm > 0) {
      insights.push({ type: "positive", text: `${d.weekKm.toFixed(0)} km this week across ${d.weekCount} session${d.weekCount !== 1 ? "s" : ""} — on track with your average.` });
    }
  }

  // ── CTL trend ─────────────────────────────────────────────────────────
  if (d.ctl > 60) {
    insights.push({ type: "positive", text: `Fitness base (CTL ${d.ctl.toFixed(0)}) is strong — you're well-trained.` });
  } else if (d.ctl < 20 && d.totalActivities > 20) {
    insights.push({ type: "neutral", text: `CTL ${d.ctl.toFixed(0)} — room to build fitness base with consistent training.` });
  }

  // ── YTD highlights ────────────────────────────────────────────────────
  if (d.ytdKm > 0) {
    const ytdText = d.runKmYtd > 0 && d.runKmYtd < d.ytdKm
      ? `${d.ytdKm.toFixed(0)} km total this year (${d.runKmYtd.toFixed(0)} km running)`
      : `${d.ytdKm.toFixed(0)} km across all sports this year`;
    insights.push({ type: "neutral", text: `${ytdText} — ${formatDuration(d.ytdSec)} of total training time.` });
  }

  // ── VO2max context ────────────────────────────────────────────────────
  if (d.vo2max && d.vdot) {
    if (d.vo2max >= 60) {
      insights.push({ type: "positive", text: `VO2max ${d.vo2max.toFixed(1)} ml/kg/min (VDOT ${d.vdot.toFixed(0)}) — elite-level aerobic capacity.` });
    } else if (d.vo2max >= 50) {
      insights.push({ type: "positive", text: `VO2max ${d.vo2max.toFixed(1)} (VDOT ${d.vdot.toFixed(0)}) — well-trained endurance athlete range.` });
    }
  }

  return insights.slice(0, 4); // max 4 insights on dashboard
}
