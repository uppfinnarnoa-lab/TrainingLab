"use client";

import { useState, useRef, useEffect } from "react";
import { RUN_TYPE_OPTIONS, resolveActivityColor, inferTypeName } from "@/lib/planner/colors";
import type { SportCategory } from "@/lib/planner/types";

interface Props {
  activityId: string;
  name: string;
  sportType: string;
  isRace: boolean;
  workoutType: number | null;
  customTypeName: string | null;
  sports: SportCategory[];
  onUpdate: (customTypeName: string | null) => void;
  size?: "sm" | "xs";
}

const IS_RUN = /run|trail|virtual/i;

export function TypePicker({
  activityId, name, sportType, isRace, workoutType, customTypeName, sports, onUpdate, size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only show the picker for running sports — other sports are coloured by sport, not type
  if (isRace || !IS_RUN.test(sportType)) return null;

  const color = resolveActivityColor(sports, sportType, isRace, workoutType, customTypeName, name);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function select(value: string | null) {
    setSaving(true);
    setOpen(false);
    try {
      await fetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTypeName: value }),
      });
      onUpdate(value);
    } finally {
      setSaving(false);
    }
  }

  const dotSize = size === "xs" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <div ref={ref} className="relative inline-flex shrink-0">
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        disabled={saving}
        title="Change workout type"
        className={`${dotSize} rounded-full transition-transform hover:scale-125 disabled:opacity-50`}
        style={{ backgroundColor: color }}
      />
      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 z-50 min-w-[170px] rounded-xl border border-border bg-surface shadow-xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold text-muted border-b border-border uppercase tracking-wide">
            Workout type
          </p>
          {RUN_TYPE_OPTIONS.map(opt => {
            const active = (customTypeName ?? inferTypeName(workoutType)) === opt.value;
            return (
              <button
                key={String(opt.value)}
                onClick={() => select(opt.value)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-surface-2 transition ${active ? "font-semibold" : ""}`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                <span className="text-primary">{opt.label}</span>
                {active && <span className="ml-auto text-accent text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
