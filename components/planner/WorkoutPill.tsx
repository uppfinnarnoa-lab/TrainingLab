"use client";

import { useState, useRef } from "react";
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
  onContextMenu?: (e: React.MouseEvent, workout: PlannedWorkout) => void;
  onLongPressMenu?: (workout: PlannedWorkout, x: number, y: number) => void;
}

export function WorkoutPill({ workout, isPast, onClick, compact, onContextMenu, onLongPressMenu }: Props) {
  const [dragging, setDragging] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const touchX = useRef(0);
  const touchY = useRef(0);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("workoutId", workout.id);
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragEnd() { setDragging(false); }

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    touchX.current = touch.clientX;
    touchY.current = touch.clientY;
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(50);
      onLongPressMenu?.(workout, touchX.current, touchY.current);
    }, 500);
  }

  function handleTouchMove() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  function handleTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  const typeColor = workout.color ?? workoutColor(workout.sportType, workout.template?.type?.name ?? null);
  const isMissed    = workout.status === "missed";
  const isCompleted = workout.status === "completed" || workout.status === "partial";
  const showStatus  = isPast;

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={e => {
        e.stopPropagation();
        if (didLongPress.current) { didLongPress.current = false; return; }
        onClick(workout);
      }}
      onContextMenu={e => { e.preventDefault(); onContextMenu?.(e, workout); }}
      className={cn(
        "w-full text-left rounded-lg text-xs transition-all group relative overflow-hidden select-none",
        "border",
        compact ? "px-2 py-0.5" : "px-2 py-1.5",
        dragging ? "opacity-40 scale-95" :
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
          className="absolute top-1 right-1 w-2 h-2 rounded-full"
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

      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0 mt-0.5 pl-0.5 text-muted overflow-hidden">
        {workout.targetDuration  && <span className="shrink-0">{formatDuration(workout.targetDuration)}</span>}
        {workout.targetDistance  && <span className="shrink-0">{formatDistance(workout.targetDistance)}</span>}
      </div>

      {isMissed && showStatus && workout.missedReason && (
        <p className="mt-0.5 pl-0.5 text-[10px] text-muted capitalize">
          {workout.missedReason}
        </p>
      )}
    </button>
  );
}
