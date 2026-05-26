"use client";

import { useState } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import type { PlannedWorkout } from "@/lib/planner/types";

interface Props {
  workout: PlannedWorkout;
  onClose: () => void;
  onSave: (id: string, patch: Partial<PlannedWorkout>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WorkoutEditModal({ workout, onClose, onSave, onDelete }: Props) {
  const [name, setName]               = useState(workout.name);
  const [date, setDate]               = useState(workout.date.slice(0, 10));
  const [notes, setNotes]             = useState(workout.notes ?? "");
  const [targetDuration, setDuration] = useState(
    workout.targetDuration ? String(Math.round(workout.targetDuration / 60)) : ""
  );
  const [targetDistance, setDistance] = useState(
    workout.targetDistance ? String(workout.targetDistance / 1000) : ""
  );
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(workout.id, {
      name: name.trim(),
      date: date as PlannedWorkout["date"],
      notes: notes || null,
      targetDuration: targetDuration ? parseInt(targetDuration) * 60 : null,
      targetDistance: targetDistance ? parseFloat(targetDistance) * 1000 : null,
    });
    setSaving(false);
    onClose();
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete(workout.id);
    setDeleting(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-primary">Redigera pass</p>
            <p className="text-xs text-muted mt-0.5">{workout.sportType}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:bg-surface-2 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted mb-1 block">Namn</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Datum</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Tid (min)</label>
              <input type="number" min={1} value={targetDuration}
                onChange={e => setDuration(e.target.value)}
                placeholder="45" className={inp} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Distans (km)</label>
            <input type="number" min={0} step={0.1} value={targetDistance}
              onChange={e => setDistance(e.target.value)}
              placeholder="10" className={inp} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Anteckningar</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Mål, fokus, detaljer..."
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            {!confirmDelete ? (
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm text-muted hover:text-error hover:border-error/30 transition">
                <Trash2 size={14} />
                Ta bort
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition">
                  Avbryt
                </button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-error/30 bg-error/10 text-sm font-semibold text-error hover:bg-error/20 transition">
                  {deleting && <Loader2 size={13} className="animate-spin" />}
                  Bekräfta
                </button>
              </div>
            )}
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-primary transition">
              Avbryt
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Spara
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50";
