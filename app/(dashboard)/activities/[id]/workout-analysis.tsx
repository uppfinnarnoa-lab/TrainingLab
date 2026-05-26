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
}

interface Props {
  activity: ActivityInfo;
  splits: Split[] | null;
}

interface WorkoutRating {
  score: number;           // 1–5
  intensityIndex: number;  // lap avg pace / overall avg pace ratio
  consistencyPct: number;  // 0–100, higher = more consistent lap paces
  hrResponsePct: number;   // max lap HR / maxHR × 100
  bullets: string[];
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function computeRating(splits: Split[] | null, activity: ActivityInfo): WorkoutRating {
  const bullets: string[] = [];

  // Need at least 3 laps and overall speed to rate
  if (!splits || splits.length < 3 || !activity.averageSpeed) {
    return { score: 0, intensityIndex: 0, consistencyPct: 0, hrResponsePct: 0, bullets: ["Not enough lap data to rate this session."] };
  }

  // Use the "work" laps only — skip first/last if they look like warm-up/cool-down
  // (shorter or significantly slower than median). Keep it simple: use all laps.
  const speeds = splits.map(s => s.average_speed).filter(s => s > 0);
  const meanSpeed = speeds.reduce((s, v) => s + v, 0) / speeds.length;

  // Intensity index: how much faster than overall avg pace are the laps on average
  const overallSpeed = activity.averageSpeed;
  const intensityIndex = meanSpeed / overallSpeed;

  // Consistency: 1 - coefficient of variation (lower stddev relative to mean = more consistent)
  const cv = stddev(speeds) / meanSpeed;
  const consistencyPct = Math.round(Math.max(0, Math.min(100, (1 - cv * 5) * 100)));

  // HR response
  const lapHRs = splits.map(s => s.average_heartrate).filter((h): h is number => h != null && h > 0);
  const maxLapHR = lapHRs.length > 0 ? Math.max(...lapHRs) : null;
  const refMaxHR = activity.maxHeartrate ?? 195;
  const hrResponsePct = maxLapHR ? Math.round((maxLapHR / refMaxHR) * 100) : 0;

  // Score: weighted sum
  let score = 1;
  if (intensityIndex > 1.12)       score += 1.5;
  else if (intensityIndex > 1.05)  score += 0.75;
  if (consistencyPct > 85)         score += 1.5;
  else if (consistencyPct > 70)    score += 0.75;
  if (hrResponsePct > 88)          score += 1;
  else if (hrResponsePct > 80)     score += 0.5;
  score = Math.round(Math.min(5, Math.max(1, score)));

  // Bullets
  if (intensityIndex > 1.12)
    bullets.push(`Strong intensity — laps averaged ${((intensityIndex - 1) * 100).toFixed(0)}% faster than overall pace.`);
  else if (intensityIndex > 1.05)
    bullets.push(`Moderate intensity — laps averaged ${((intensityIndex - 1) * 100).toFixed(0)}% above overall pace.`);
  else
    bullets.push("Low intensity contrast — intervals barely faster than easy pace.");

  if (consistencyPct > 85)
    bullets.push(`Very consistent laps (${consistencyPct}% consistency score).`);
  else if (consistencyPct > 65)
    bullets.push(`Moderate consistency between laps (${consistencyPct}%).`);
  else
    bullets.push(`High pace variation between laps (${consistencyPct}% consistency) — consider more even splits.`);

  if (hrResponsePct > 88)
    bullets.push(`Good cardiovascular load — peaked at ${hrResponsePct}% of max HR.`);
  else if (hrResponsePct > 0)
    bullets.push(`HR reached ${hrResponsePct}% of max — consider pushing harder on key intervals.`);

  return { score, intensityIndex, consistencyPct, hrResponsePct, bullets };
}

function StarRating({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={18}
          className={n <= score ? "fill-warning text-warning" : "text-border"}
        />
      ))}
      <span className="text-sm font-medium text-muted ml-1">{score}/5</span>
    </div>
  );
}

export function WorkoutAnalysis({ activity, splits }: Props) {
  const [aiText, setAiText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rating = computeRating(splits, activity);

  async function requestAiAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activity.id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(msg || "Analysis failed. Check your AI API key in Settings.");
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

      {/* Computed rating */}
      {rating.score > 0 && <StarRating score={rating.score} />}
      <ul className="space-y-1">
        {rating.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted">
            <span className="shrink-0 mt-0.5 text-accent">·</span>
            {b}
          </li>
        ))}
      </ul>

      {/* AI analysis */}
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
