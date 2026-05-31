"use client";

import { useState } from "react";
import { Loader2, Star } from "lucide-react";

interface Split {
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
}

interface ActivityInfo {
  id: string;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  userMaxHR?: number | null;
}

interface Props {
  activity: ActivityInfo;
  splits: Split[] | null;
}

interface WorkoutRating {
  score: number;
  paceGapMin: number;
  consistencyPct: number;
  hrResponsePct: number;
  bullets: string[];
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function secPerKmStr(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function computeRating(splits: Split[] | null, activity: ActivityInfo): WorkoutRating {
  const bullets: string[] = [];

  const valid = (splits ?? []).filter(s => s.average_speed > 0 && s.moving_time > 5 && s.distance > 10);
  if (valid.length < 3 || !activity.averageSpeed) {
    return { score: 0, paceGapMin: 0, consistencyPct: 0, hrResponsePct: 0,
      bullets: ["Not enough lap data to rate this session."] };
  }

  const lapPaces = valid.map(s => 1000 / s.average_speed); // sec/km, lower = faster
  const sortedPaces = [...lapPaces].sort((a, b) => a - b);

  // Scan from the FAST end for the first gap ≥ 30 sec/km.
  // This separates intervals from easy/rest laps without being fooled by the
  // (usually larger) gap between easy laps and walk-recovery laps.
  let splitIdx = sortedPaces.length; // sentinel = no gap found
  for (let i = 1; i < sortedPaces.length; i++) {
    if (sortedPaces[i] - sortedPaces[i - 1] >= 30) {
      splitIdx = i;
      break;
    }
  }

  const hasIntervals = splitIdx < sortedPaces.length;

  if (!hasIntervals) {
    // Steady effort — no clear bimodal structure
    const avgPace = lapPaces.reduce((s, v) => s + v, 0) / lapPaces.length;
    const cv = stddev(lapPaces) / avgPace;
    const consistencyPct = Math.round(Math.max(0, Math.min(100, (1 - cv * 3) * 100)));
    const score = consistencyPct >= 85 ? 3 : consistencyPct >= 65 ? 2 : 1;
    bullets.push(`Steady effort — avg pace ${secPerKmStr(avgPace)}/km across all laps.`);
    if (consistencyPct >= 85) bullets.push(`Very consistent pacing (${consistencyPct}%).`);
    else bullets.push(`Variable pacing (${consistencyPct}%).`);
    return { score, paceGapMin: 0, consistencyPct, hrResponsePct: 0, bullets };
  }

  // Threshold between interval laps and easy/rest laps
  const threshold = (sortedPaces[splitIdx - 1] + sortedPaces[splitIdx]) / 2;

  // Easy laps: slower than threshold but NOT extremely slow (walking rests).
  // Cap at threshold × 1.8 so recovery jogs are included but standing-still laps are not.
  const maxEasyPace = threshold * 1.8;
  const isWork = lapPaces.map(p => p < threshold);

  // Easy pace: distance-weighted avg of the easy running laps (WU, CD, active recovery)
  const easyLaps = valid.filter((l, i) => !isWork[i] && (1000 / l.average_speed) <= maxEasyPace);
  const easyDist = easyLaps.reduce((s, l) => s + l.distance, 0);
  const easyPace = easyDist > 0
    ? easyLaps.reduce((s, l) => s + (1000 / l.average_speed) * l.distance, 0) / easyDist
    : 1000 / activity.averageSpeed * 1.15;

  // Merge consecutive work (interval) laps into groups.
  // Two fast laps back-to-back without a rest between them = one interval.
  const intervalGroups: { paceSecKm: number; avgHR: number | null }[] = [];
  let cur: Split[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (isWork[i]) {
      cur.push(valid[i]);
    } else if (cur.length > 0) {
      const d = cur.reduce((s, l) => s + l.distance, 0);
      const t = cur.reduce((s, l) => s + l.moving_time, 0);
      const hrs = cur.map(l => l.average_heartrate).filter((h): h is number => h != null && h > 0);
      intervalGroups.push({
        paceSecKm: d > 0 ? t / (d / 1000) : 1000 / cur[0].average_speed,
        avgHR: hrs.length > 0 ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null,
      });
      cur = [];
    }
  }
  if (cur.length > 0) {
    const d = cur.reduce((s, l) => s + l.distance, 0);
    const t = cur.reduce((s, l) => s + l.moving_time, 0);
    const hrs = cur.map(l => l.average_heartrate).filter((h): h is number => h != null && h > 0);
    intervalGroups.push({
      paceSecKm: d > 0 ? t / (d / 1000) : 1000 / cur[0].average_speed,
      avgHR: hrs.length > 0 ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null,
    });
  }

  if (intervalGroups.length === 0) {
    return { score: 0, paceGapMin: 0, consistencyPct: 0, hrResponsePct: 0,
      bullets: ["Could not identify interval structure."] };
  }

  const intervalPaces = intervalGroups.map(g => g.paceSecKm).filter(p => p > 0);
  const avgIntervalPace = intervalPaces.reduce((s, v) => s + v, 0) / intervalPaces.length;

  const paceGapSec = easyPace - avgIntervalPace;
  const paceGapMin = paceGapSec / 60;

  // Consistency: variation among interval groups only (not WU/CD/rest)
  const cv = intervalPaces.length > 1 ? stddev(intervalPaces) / avgIntervalPace : 0;
  const consistencyPct = Math.round(Math.max(0, Math.min(100, (1 - cv * 3) * 100)));

  // HR: compare max lap avg HR to physiological max HR from fitness cache
  const allLapHRs = valid.map(s => s.average_heartrate).filter((h): h is number => h != null && h > 0);
  const maxLapAvgHR = allLapHRs.length > 0 ? Math.max(...allLapHRs) : null;
  const refMaxHR = activity.userMaxHR ?? activity.maxHeartrate ?? 190;
  const hrResponsePct = maxLapAvgHR && refMaxHR ? Math.round((maxLapAvgHR / refMaxHR) * 100) : 0;

  // Score
  let score = 1;
  if (paceGapMin >= 1.5)         score += 2.0;
  else if (paceGapMin >= 0.75)   score += 1.25;
  else if (paceGapMin >= 0.3)    score += 0.5;
  if (consistencyPct >= 85)      score += 1.5;
  else if (consistencyPct >= 65) score += 0.75;
  if (hrResponsePct >= 88)       score += 1.0;
  else if (hrResponsePct >= 80)  score += 0.5;
  score = Math.round(Math.min(5, Math.max(1, score)));

  // Bullets — format gap as mm:ss/km
  const paceGapStr = secPerKmStr(paceGapSec);
  if (paceGapMin >= 1.5)
    bullets.push(`High intensity — intervals ${paceGapStr}/km faster than easy pace.`);
  else if (paceGapMin >= 0.75)
    bullets.push(`Good intensity contrast — intervals ${paceGapStr}/km faster than easy pace.`);
  else if (paceGapMin > 0)
    bullets.push(`Low intensity contrast — intervals only ${paceGapStr}/km faster than easy pace.`);
  else
    bullets.push(`Intervals were not meaningfully faster than easy pace.`);

  bullets.push(`${intervalGroups.length} interval${intervalGroups.length > 1 ? "s" : ""} detected, avg pace ${secPerKmStr(avgIntervalPace)}/km.`);

  if (intervalGroups.length > 1) {
    if (consistencyPct >= 85)
      bullets.push(`Very consistent splits (${consistencyPct}%).`);
    else if (consistencyPct >= 65)
      bullets.push(`Moderate split consistency (${consistencyPct}%).`);
    else
      bullets.push(`Uneven splits (${consistencyPct}%) — consider more even effort.`);
  }

  if (hrResponsePct > 0) {
    if (hrResponsePct >= 88)
      bullets.push(`Good cardiovascular load — peaked at ${hrResponsePct}% of max HR.`);
    else
      bullets.push(`HR reached ${hrResponsePct}% of max HR.`);
  }

  return { score, paceGapMin, consistencyPct, hrResponsePct, bullets };
}

function StarRating({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={18} className={n <= score ? "fill-warning text-warning" : "text-border"} />
      ))}
      <span className="text-sm font-medium text-muted ml-1">{score}/5</span>
    </div>
  );
}

export function WorkoutAnalysis({ activity, splits }: Props) {
  const [aiText, setAiText]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const rating = computeRating(splits, activity);

  async function requestAiAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activity.id}/analyze`, { method: "POST" });
      if (!res.ok) {
        setError((await res.text().catch(() => "")) || "Analysis failed. Check your AI API key in Settings.");
        return;
      }
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAiText(text);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-surface border border-border p-5 space-y-4">
      <p className="text-sm font-semibold text-primary">Workout analysis</p>

      {rating.score > 0 && <StarRating score={rating.score} />}
      <ul className="space-y-1">
        {rating.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted">
            <span className="shrink-0 mt-0.5 text-accent">·</span>
            {b}
          </li>
        ))}
      </ul>

      {!aiText && (
        <button
          onClick={requestAiAnalysis}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-surface-2 border border-border px-4 py-2 text-sm font-medium text-primary hover:border-accent/50 disabled:opacity-50 transition"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {loading ? "Analyzing…" : "Analyze with AI"}
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {aiText && (
        <div className="p-4 rounded-xl bg-surface-2 border border-border text-sm text-primary leading-relaxed whitespace-pre-wrap">
          {aiText}
        </div>
      )}
    </div>
  );
}
