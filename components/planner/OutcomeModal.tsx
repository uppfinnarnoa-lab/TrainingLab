"use client";

import { useState } from "react";
import { X, Loader2, Trash2, Pencil } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const MISS_REASONS = [
  { value: "illness", label: "Sjukdom",  desc: "Sjuk, förkylning, virus" },
  { value: "injury",  label: "Skada",    desc: "Smärta, skada, ont" },
  { value: "fatigue", label: "Sliten",   desc: "Utmattad, överbelastad" },
  { value: "other",   label: "Annat",    desc: "Annan anledning" },
];

interface Props {
  workout: PlannedWorkout;
  onClose: () => void;
  onSave: (id: string, status: string, missedReason?: string, missedNote?: string) => Promise<void>;
  onDelete?: (id: string) => void;
  onEdit?: (workout: PlannedWorkout) => void;
}

export function OutcomeModal({ workout, onClose, onSave, onDelete, onEdit }: Props) {
  const [step, setStep]         = useState<"choose" | "missed" | "confirm-delete">("choose");
  const [reason, setReason]     = useState(workout.missedReason ?? "");
  const [note, setNote]         = useState(workout.missedNote ?? "");
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(status: string, r?: string, n?: string) {
    setSaving(true);
    await onSave(workout.id, status, r, n);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-primary">{workout.name}</p>
            <p className="text-xs text-muted mt-0.5">
              {new Date(workout.date + "T00:00:00").toLocaleDateString("sv", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={() => { onClose(); onEdit(workout); }}
                title="Redigera pass"
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
              <p className="text-sm text-muted">Genomförde du detta pass?</p>
              <div className="space-y-2">
                <button onClick={() => save("completed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-accent/40 transition text-left">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#22C55E" }} />
                  <div>
                    <p className="text-sm font-semibold text-primary">Genomfört</p>
                    <p className="text-xs text-muted">Passet är klart</p>
                  </div>
                  {saving && <Loader2 size={14} className="animate-spin ml-auto" />}
                </button>

                <button onClick={() => setStep("missed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-error/30 transition text-left">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#EF4444" }} />
                  <div>
                    <p className="text-sm font-semibold text-primary">Missades</p>
                    <p className="text-xs text-muted">Passet genomfördes inte</p>
                  </div>
                </button>

                {workout.status !== "planned" && (
                  <button onClick={() => save("planned")} disabled={saving}
                    className="w-full py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition">
                    Återställ till planerat
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
                  Ta bort pass
                </button>
              )}
            </>
          )}

          {step === "confirm-delete" && (
            <>
              <p className="text-sm text-primary font-medium">Ta bort passet?</p>
              <p className="text-xs text-muted">
                <span className="font-semibold text-primary">{workout.name}</span> raderas permanent. Det går inte att ångra.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep("choose")}
                  className="flex-1 py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition"
                >
                  Avbryt
                </button>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    onDelete!(workout.id);
                    onClose();
                  }}
                  disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-error/10 border border-error/30 text-sm font-semibold text-error hover:bg-error/20 transition"
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  Ta bort
                </button>
              </div>
            </>
          )}

          {step === "missed" && (
            <>
              <p className="text-sm text-muted">Varför missades passet?</p>

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
                <label className="text-xs text-muted mb-1 block">Anteckning</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Beskriv mer om du vill — t.ex. vilket ben, hur länge du känt av det..."
                  rows={2}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep("choose")}
                  className="px-4 py-2 text-sm text-muted hover:text-primary transition">
                  ← Tillbaka
                </button>
                <button
                  onClick={() => save("missed", reason || undefined, note || undefined)}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-error/10 border border-error/30 text-sm font-semibold text-error hover:bg-error/20 transition">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Spara som missat
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
