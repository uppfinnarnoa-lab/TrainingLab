"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const MISS_REASONS = [
  { value: "illness",      label: "Sjukdom",   emoji: "🤒", desc: "Sjuk, förkylning, virus" },
  { value: "injury",       label: "Skada",     emoji: "🤕", desc: "Smärta, skada, ont" },
  { value: "fatigue",      label: "Sliten",    emoji: "😴", desc: "Utmattad, överbelastad" },
  { value: "other",        label: "Annat",     emoji: "💬", desc: "Annan anledning" },
];

interface Props {
  workout: PlannedWorkout;
  onClose: () => void;
  onSave: (id: string, status: string, missedReason?: string, missedNote?: string) => Promise<void>;
}

export function OutcomeModal({ workout, onClose, onSave }: Props) {
  const [step, setStep]       = useState<"choose" | "missed">("choose");
  const [reason, setReason]   = useState("");
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);

  const isPast = workout.date <= new Date().toISOString().split("T")[0];

  async function save(status: string, r?: string, n?: string) {
    setSaving(true);
    await onSave(workout.id, status, r, n);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-primary">{workout.name}</p>
            <p className="text-xs text-muted mt-0.5">
              {new Date(workout.date + "T00:00:00").toLocaleDateString("sv", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:bg-surface-2 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === "choose" && (
            <>
              <p className="text-sm text-muted">
                {workout.status !== "planned"
                  ? "Uppdatera status för detta pass:"
                  : "Genomförde du detta pass?"}
              </p>

              <div className="space-y-2">
                <button onClick={() => save("completed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-accent/40 transition text-left">
                  <span className="text-lg">✅</span>
                  <div>
                    <p className="text-sm font-semibold text-primary">Genomfört</p>
                    <p className="text-xs text-muted">Passet är klart</p>
                  </div>
                </button>

                <button onClick={() => save("partial")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-accent/40 transition text-left">
                  <span className="text-lg">⚡</span>
                  <div>
                    <p className="text-sm font-semibold text-primary">Delvis genomfört</p>
                    <p className="text-xs text-muted">Kortare eller lättare än planerat</p>
                  </div>
                </button>

                <button onClick={() => setStep("missed")} disabled={saving}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-surface-2 border border-border hover:border-error/30 transition text-left">
                  <span className="text-lg">❌</span>
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
            </>
          )}

          {step === "missed" && (
            <>
              <p className="text-sm text-muted">Varför missades passet?</p>

              <div className="grid grid-cols-2 gap-2">
                {MISS_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 p-3 rounded-xl border transition text-left",
                      reason === r.value
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-accent/40"
                    )}
                  >
                    <span className="text-xl">{r.emoji}</span>
                    <p className={cn("text-sm font-semibold", reason === r.value ? "text-accent" : "text-primary")}>
                      {r.label}
                    </p>
                    <p className="text-[10px] text-muted leading-tight">{r.desc}</p>
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-muted mb-1.5 block">Anteckning (valfri)</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Beskriv mer om du vill — exv. vilket ben, hur länge du har känt av det..."
                  rows={2}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep("choose")} className="px-4 py-2 text-sm text-muted hover:text-primary transition">
                  ← Tillbaka
                </button>
                <button
                  onClick={() => save("missed", reason || undefined, note || undefined)}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-error/10 border border-error/30 text-sm font-semibold text-error hover:bg-error/20 transition"
                >
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
