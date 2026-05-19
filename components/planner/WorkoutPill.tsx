"use client";

import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";
import { formatDuration, formatDistance } from "@/lib/utils";
import { workoutColor, statusBorderColor } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

interface Props {
  workout: PlannedWorkout;
  isPast: boolean;
  onClick: (workout: PlannedWorkout) => void;
}

const STATUS_ICONS = {
  completed: <CheckCircle size={11} className="shrink-0" style={{ color: "#22C55E" }} />,
  missed:    <XCircle    size={11} className="shrink-0" style={{ color: "#EF4444" }} />,
  partial:   <AlertCircle size={11} className="shrink-0" style={{ color: "#F97316" }} />,
  planned:   null,
};

export function WorkoutPill({ workout, isPast, onClick }: Props) {
  // Primary color = workout type (from template type + sport)
  const typeColor = workout.color
    ?? workoutColor(workout.sportType, workout.template?.type?.name ?? null);

  // Status border = separate visual layer on top
  const statusColor = statusBorderColor(workout.status, workout.date);

  const isMissed    = workout.status === "missed";
  const isCompleted = workout.status === "completed" || workout.status === "partial";
  const isPastUnlogged = isPast && workout.status === "planned";

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(workout); }}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all group relative overflow-hidden",
        "border hover:shadow-sm",
        isMissed    ? "opacity-60 bg-surface border-border" :
        isCompleted ? "bg-surface border-border" :
                      "bg-surface border-border hover:border-accent/30"
      )}
    >
      {/* Left border — workout TYPE color */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
        style={{ backgroundColor: typeColor }}
      />

      {/* Top-right corner — STATUS color dot */}
      {statusColor && (
        <div
          className="absolute top-1 right-1 w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
      )}

      <div className="flex items-center gap-1.5 pl-0.5">
        {STATUS_ICONS[workout.status as keyof typeof STATUS_ICONS]}
        <span className={cn(
          "font-medium truncate flex-1",
          isMissed ? "line-through text-muted" : "text-primary"
        )}>
          {workout.name}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-0.5 pl-0.5 text-muted">
        {workout.targetDuration && (
          <span>{formatDuration(workout.targetDuration)}</span>
        )}
        {workout.targetDistance && (
          <span>{formatDistance(workout.targetDistance)}</span>
        )}
        {isPastUnlogged && (
          <span className="ml-auto text-[10px] font-semibold" style={{ color: "#FBBF24" }}>
            Log?
          </span>
        )}
      </div>

      {isMissed && workout.missedReason && (
        <p className="mt-0.5 pl-0.5 text-[10px] text-muted capitalize">
          {workout.missedReason}
        </p>
      )}
    </button>
  );
}
