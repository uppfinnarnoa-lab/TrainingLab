"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { TrainingBlock } from "@/lib/planner/types";
import { BLOCK_TYPE_COLORS } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const BLOCK_TYPES = [
  { value: "base",   label: "Base",   desc: "Aerobic base & high volume" },
  { value: "build",  label: "Build",  desc: "Increasing intensity & specificity" },
  { value: "peak",   label: "Peak",   desc: "Race-specific quality sessions" },
  { value: "taper",  label: "Taper",  desc: "Volume reduction, maintain intensity" },
  { value: "custom", label: "Custom", desc: "Define your own focus" },
  { value: "race",   label: "Race",   desc: "Competition — shown as a marker in the timeline" },
] as const;

const PRESET_COLORS = [
  // Blues & teals
  "#3B82F6","#60A5FA","#0EA5E9","#38BDF8","#14B8A6","#2DD4BF","#6EE7B7",
  // Greens
  "#10B981","#34D399","#84CC16","#059669",
  // Purples & pinks
  "#8B5CF6","#6366F1","#A78BFA","#C4B5FD","#EC4899","#F472B6","#E879F9","#D946EF",
  // Oranges, reds & yellows
  "#F97316","#FB923C","#EF4444","#F87171","#F59E0B","#FBBF24","#FCD34D",
  // Neutrals & special
  "#94A3B8","#64748B","#1E293B","#22D3EE",
];

interface Props {
  initial?: Partial<TrainingBlock>;
  racePlannedWorkouts?: { id: string; name: string; date: string }[];
  onSave: (data: Partial<TrainingBlock>) => Promise<boolean>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function BlockEditorModal({ initial, racePlannedWorkouts, onSave, onDelete, onClose }: Props) {
  const isNew = !initial?.id;
  const [name, setName]       = useState(initial?.name ?? "");
  const [blockType, setType]  = useState(initial?.blockType ?? "base");
  const [color, setColor]     = useState(initial?.color ?? BLOCK_TYPE_COLORS["base"]);
  const [startDate, setStart] = useState(initial?.startDate?.slice(0, 10) ?? "");
  const [endDate, setEnd]     = useState(initial?.endDate?.slice(0, 10) ?? "");
  const [notes, setNotes]     = useState(initial?.notes ?? "");
  const [kmPerWeek, setKm]    = useState(initial?.targetKmPerWeek ? String(initial.targetKmPerWeek) : "");
  const [targetRaceId, setTargetRaceId] = useState<string | null>(initial?.targetRaceId ?? null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Auto-update color when type changes (unless manually changed)
  function handleTypeChange(t: string) {
    setType(t);
    const defaultColor = BLOCK_TYPE_COLORS[t as keyof typeof BLOCK_TYPE_COLORS];
    if (defaultColor && (!initial?.color || color === BLOCK_TYPE_COLORS[initial.blockType as keyof typeof BLOCK_TYPE_COLORS])) {
      setColor(defaultColor);
    }
  }

  async function handleSave() {
    if (!name.trim() || !startDate || !effectiveEndDate) return;
    if (!isRaceType && startDate > endDate) return;
    setSaving(true);
    setSaveError(false);
    const ok = await onSave({
      name: name.trim(),
      blockType,
      color,
      startDate,
      endDate: effectiveEndDate,
      notes: notes || null,
      targetKmPerWeek: !isRaceType && kmPerWeek ? parseFloat(kmPerWeek) : null,
      targetRaceId: isRaceType ? targetRaceId : null,
    });
    setSaving(false);
    if (ok) onClose();
    else setSaveError(true);
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete();
    // onDelete closes modal via parent state — no need to call onClose here
  }

  const isRaceType = blockType === "race";
  const effectiveEndDate = isRaceType ? startDate : endDate;
  const invalidDateRange = !isRaceType && !!startDate && !!endDate && startDate > endDate;
  const weeks = !isRaceType && startDate && endDate && !invalidDateRange
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (7 * 86400000)) + 1
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <p className="font-semibold text-primary">{isNew ? "New training block" : "Edit block"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:bg-surface-2 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Block name */}
          <div>
            <label className="text-xs text-muted mb-1 block">Block name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Base 1, Build block, Peak week"
              className={inp} />
          </div>

          {/* Block type */}
          <div>
            <label className="text-xs text-muted mb-2 block">Type</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {BLOCK_TYPES.map(t => (
                <button key={t.value} onClick={() => handleTypeChange(t.value)}
                  className={cn(
                    "py-2 px-1 rounded-xl border text-xs font-medium transition text-center",
                    blockType === t.value ? "border-accent bg-accent/5 text-accent" : "border-border text-muted hover:text-primary"
                  )}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mt-1.5">
              {BLOCK_TYPES.find(t => t.value === blockType)?.desc}
            </p>
          </div>

          {/* Pick from planner — race blocks only */}
          {isRaceType && racePlannedWorkouts && racePlannedWorkouts.length > 0 && (
            <div>
              <label className="text-xs text-muted mb-1 block">Pick from planner (optional)</label>
              <select
                value={targetRaceId ?? ""}
                onChange={e => {
                  const id = e.target.value || null;
                  setTargetRaceId(id);
                  if (id) {
                    const race = racePlannedWorkouts.find(r => r.id === id);
                    if (race) {
                      setName(race.name);
                      setStart(race.date);
                    }
                  }
                }}
                className={inp}
              >
                <option value="">— Manual entry —</option>
                {racePlannedWorkouts.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.date})</option>
                ))}
              </select>
            </div>
          )}

          {/* Date range — race only shows start date */}
          <div className={isRaceType ? "" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
            <div>
              <label className="text-xs text-muted mb-1 block">{isRaceType ? "Race date *" : "Start date *"}</label>
              <input type="date" value={startDate} onChange={e => setStart(e.target.value)} className={inp} />
            </div>
            {!isRaceType && (
              <div>
                <label className="text-xs text-muted mb-1 block">End date *</label>
                <input type="date" value={endDate} onChange={e => setEnd(e.target.value)} className={inp} />
              </div>
            )}
          </div>
          {weeks != null && (
            <p className="text-xs text-muted -mt-2">{weeks} week{weeks !== 1 ? "s" : ""}</p>
          )}
          {invalidDateRange && (
            <p className="text-xs text-error -mt-2">End date must be after start date.</p>
          )}

          {/* Target km/week — hidden for races */}
          {!isRaceType && (
            <div>
              <label className="text-xs text-muted mb-1 block">Target km/week (optional)</label>
              <input type="number" min={0} step={5} value={kmPerWeek}
                onChange={e => setKm(e.target.value)}
                placeholder="e.g. 80" className={inp} />
            </div>
          )}

          {/* Focus notes */}
          <div>
            <label className="text-xs text-muted mb-1 block">Focus / notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="What's the goal of this block?"
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none" />
          </div>

          {/* Color */}
          <div>
            <label className="text-xs text-muted mb-2 block">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={cn("w-7 h-7 rounded-full border-2 transition-all",
                    color === c ? "border-white scale-110 shadow-lg" : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex flex-wrap items-center gap-2">
          {!isNew && onDelete && !confirmDelete && (
            <button onClick={handleDelete} disabled={deleting}
              className="px-3 py-2 rounded-xl border border-border text-sm text-muted hover:text-error hover:border-error/30 transition flex items-center gap-1.5">
              Delete
            </button>
          )}
          {!isNew && onDelete && confirmDelete && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface-2 transition">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-3 py-2 rounded-xl border border-error/30 bg-error/10 text-sm font-semibold text-error hover:bg-error/20 transition flex items-center gap-1.5">
                {deleting ? <Loader2 size={13} className="animate-spin" /> : "Confirm deletion"}
              </button>
            </div>
          )}
          {saveError && <p className="text-xs text-error">Failed to save — please try again.</p>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-primary transition">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim() || !startDate || !effectiveEndDate || invalidDateRange}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition"
            style={{ backgroundColor: color }}>
            {saving ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
            {isNew ? "Create block" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50";
