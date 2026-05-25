"use client";

import { Check, X } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";
import { formatDuration, formatDistance } from "@/lib/utils";
import { workoutColor } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

interface Props {
  workout: PlannedWorkout;
  isPast: boolean;
  onClick: (workout: PlannedWorkout) => void;
  compact?: boolean;
}

export function WorkoutPill({ workout, isPast, onClick, compact }: Props) {
  function handleDragStart(e: React.DragEvent) {
    if (isPast) { e.preventDefault(); return; }
    e.dataTransfer.setData("workoutId", workout.id);
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  }
  const typeColor = workout.color
    ?? workoutColor(workout.sportType, workout.template?.type?.name ?? null);

  const isMissed    = workout.status === "missed";
  const isCompleted = workout.status === "completed" || workout.status === "partial";
  // Only show status indicators on past workouts
  const showStatus  = isPast;

  return (
    <button
      draggable={!isPast}
      onDragStart={handleDragStart}
      onClick={e => { e.stopPropagation(); onClick(workout); }}
      className={cn(
        "w-full text-left rounded-lg text-xs transition-all group relative overflow-hidden",
        "border",
        compact ? "px-2 py-0.5" : "px-2 py-1.5",
        isMissed && showStatus    ? "opacity-55 bg-surface border-border" :
        isCompleted && showStatus ? "bg-surface border-border" :
                                    "bg-surface border-border hover:border-accent/30"
      )}
    >
      {/* Left border — workout TYPE colour */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[5px] rounded-l-lg"
        style={{ backgroundColor: typeColor }}
      />

      {/* Status dot — only for past workouts */}
      {showStatus && (isCompleted || isMissed) && (
        <div
          className={cn(
            "absolute top-1 right-1 w-2 h-2 rounded-full flex items-center justify-center",
          )}
          style={{ backgroundColor: isCompleted ? "#22C55E" : "#EF4444" }}
        />
      )}

      <div className="flex items-center gap-1.5 pl-0.5">
        {showStatus && isCompleted && <Check size={10} className="shrink-0" style={{ color: "#22C55E" }} />}
        {showStatus && isMissed    && <X     size={10} className="shrink-0" style={{ color: "#EF4444" }} />}
        <span className={cn(
          "font-medium truncate flex-1",
          isMissed && showStatus ? "line-through text-muted" : "text-primary"
        )}>
          {workout.name}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-0.5 pl-0.5 text-muted">
        {workout.targetDuration  && <span>{formatDuration(workout.targetDuration)}</span>}
        {workout.targetDistance  && <span>{formatDistance(workout.targetDistance)}</span>}
        {/* Past unlogged prompt */}
        {isPast && workout.status === "planned" && (
          <span className="ml-auto text-[10px] font-semibold text-warning">Logga?</span>
        )}
      </div>

      {isMissed && showStatus && workout.missedReason && (
        <p className="mt-0.5 pl-0.5 text-[10px] text-muted capitalize">
          {workout.missedReason}
        </p>
      )}
    </button>
  );
}
