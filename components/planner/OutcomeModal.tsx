"use client";

import { useState } from "react";
import { X, Loader2, Trash2, Pencil } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const MISS_REASONS = [
  { value: "illness", label: "Illness",  desc: "Sick, cold, virus" },
  { value: "injury",  label: "Injury",   desc: "Pain, injury, soreness" },
  { value: "fatigue", label: "Fatigue",  desc: "Exhausted, overloaded" },
  { value: "other",   label: "Other",    desc: "Another reason" },
];

interface Props {
  workout: PlannedWorkout;
  onClose: () => void;
  onSave: (id: string, status: string, missedReason?: string, missedNote?: string) => Promise<boolean>;
  onDelete?: (id: string) => void;
  onEdit?: (workout: PlannedWorkout) => void;
}

export function OutcomeModal({ workout, onClose, onSave, onDelete, onEdit }: Props) {
  const [step, setStep]         = useState<"choose" | "missed" | "confirm-delete">("choose");
  const [reason, setReason]     = useState(workout.missedReason ?? "");
  const [note, setNote]         = useState(workout.missedNote ?? "");
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function save(status: string, r?: string, n?: string) {
    setSaving(true);
    setSaveError(false);
    const ok = await onSave(workout.id, status, r, n);
    setSaving(false);
    if (ok) onClose();
    else setSaveError(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-primary">{workout.name}</p>
            <p className="text-xs text-muted mt-0.5">
              {new Date(workout.date + "T00:00:00").toLocaleDateString("en", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={() => { onClose(); onEdit(workout); }}
                title="Edit session"
                className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
              >
                <Pencil size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:bg-surface-2 transition">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {step === "choose" && (
            <>
              <p className="text-sm text-muted">Did you complete this session?</p>
              <div className="space-y-2">
                <button onClick={() => save("completed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-accent/40 transition text-left">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#22C55E" }} />
                  <div>
                    <p className="text-sm font-semibold text-primary">Completed</p>
                    <p className="text-xs text-muted">Session done</p>
                  </div>
                  {saving && <Loader2 size={14} className="animate-spin ml-auto" />}
                </button>

                <button onClick={() => setStep("missed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-error/30 transition text-left">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#EF4444" }} />
                  <div>
                    <p className="text-sm font-semibold text-primary">Missed</p>
                    <p className="text-xs text-muted">Session was not completed</p>
                  </div>
                </button>

                {workout.status !== "planned" && (
                  <button onClick={() => save("planned")} disabled={saving}
                    className="w-full py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition">
                    Reset to planned
                  </button>
                )}
              </div>

              {onDelete && (
                <button
                  onClick={() => setStep("confirm-delete")}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-border text-xs text-muted hover:border-error/40 hover:text-error hover:bg-error/5 transition mt-1"
                >
                  <Trash2 size={12} />
                  Delete session
                </button>
              )}
            </>
          )}

          {step === "confirm-delete" && (
            <>
              <p className="text-sm text-primary font-medium">Delete this session?</p>
              <p className="text-xs text-muted">
                <span className="font-semibold text-primary">{workout.name}</span> will be permanently deleted. This cannot be undone.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep("choose")}
                  className="flex-1 py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete!(workout.id);
                    onClose();
                  }}
                  disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-error/10 border border-error/30 text-sm font-semibold text-error hover:bg-error/20 transition"
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </div>
            </>
          )}

          {step === "missed" && (
            <>
              <p className="text-sm text-muted">Why was this session missed?</p>

              <div className="grid grid-cols-2 gap-2">
                {MISS_REASONS.map(r => (
                  <button key={r.value} onClick={() => setReason(r.value)}
                    className={cn(
                      "flex flex-col gap-0.5 p-3 rounded-xl border transition text-left",
                      reason === r.value ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
                    )}>
                    <p className={cn("text-sm font-semibold", reason === r.value ? "text-accent" : "text-primary")}>
                      {r.label}
                    </p>
                    <p className="text-[10px] text-muted leading-tight">{r.desc}</p>
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-muted mb-1 block">Note</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Describe more if you like — e.g. which leg, how long you've felt it..."
                  rows={2}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep("choose")}
                  className="px-4 py-2 text-sm text-muted hover:text-primary transition">
                  ← Back
                </button>
                <button
                  onClick={() => save("missed", reason || undefined, note || undefined)}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-error/10 border border-error/30 text-sm font-semibold text-error hover:bg-error/20 transition">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Mark as missed
                </button>
              </div>
            </>
          )}
        {saveError && (
          <p className="px-5 pb-4 text-xs text-error">Failed to save — please try again.</p>
        )}
        </div>
      </div>
    </div>
  );
}
