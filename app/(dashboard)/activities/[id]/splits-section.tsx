"use client";

import { useState } from "react";
import { SplitsChart } from "./splits-chart";
import { SplitsTable } from "./splits-table";
import { mergeLapsIntoSegments } from "@/lib/activity/interval-segments";

interface Split {
  split: number | string;
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
}

interface Props {
  splits: Split[];
  isLaps: boolean;
  workoutType: number | null;
  avgSpeedMs: number;
  color: string;
  pvi?: number | null;
}

export function SplitsSection({ splits, isLaps, workoutType, avgSpeedMs, color, pvi }: Props) {
  const [mergeIntervals, setMergeIntervals] = useState(false);

  const showToggle = isLaps && workoutType === 3 && splits.length >= 3;

  const displaySplits: Split[] = mergeIntervals
    ? mergeLapsIntoSegments(splits).map(seg => ({
        split: seg.label,
        distance: seg.distance,
        moving_time: seg.moving_time,
        average_speed: seg.average_speed,
        average_heartrate: seg.average_heartrate,
        elevation_difference: seg.elevation_difference,
      }))
    : splits;

  return (
    <div className="space-y-4">
      {showToggle && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMergeIntervals(v => !v)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              mergeIntervals
                ? "bg-accent text-white border-accent"
                : "bg-surface-2 text-muted border-border hover:text-primary"
            }`}
          >
            {mergeIntervals ? "Visa laps" : "Visa intervaller"}
          </button>
        </div>
      )}
      <div className="rounded-2xl bg-surface border border-border p-5">
        <SplitsChart splits={displaySplits} avgSpeedMs={avgSpeedMs} isLaps={isLaps} color={color} />
      </div>
      <SplitsTable splits={displaySplits} isLaps={isLaps} pvi={pvi} />
    </div>
  );
}
