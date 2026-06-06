"use client";

import { useState, useCallback } from "react";
import { X, Plus, GripVertical, Trash2, ChevronDown } from "lucide-react";
import { ZoneBar } from "./ZoneBar";
import { formatDuration, formatDistance } from "@/lib/utils";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";
import type { SportCategory, WorkoutSection } from "@/lib/planner/types";
import { ZONE_COLORS } from "@/lib/planner/types";
import { workoutColor } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

interface NewSection extends Omit<WorkoutSection, "id"> {
  _key: number; // local key for React list
}

import type { WorkoutTemplate } from "@/lib/planner/types";

interface Props {
  sports: SportCategory[];
  paceZones?: number[][];
  hrZones?: number[][];
  onSave: (data: BuilderData) => void;
  onCancel: () => void;
  onDelete?: () => void;         // shown when plannedWorkoutMode is true
  initialDate?: string;
  editTemplate?: WorkoutTemplate; // pre-fills form for editing
  plannedWorkoutMode?: boolean;   // changes title to "Edit workout" (not "Edit template")
}

export interface BuilderData {
  name: string;
  sportId: string;
  typeId: string | null;
  description: string;
  color: string | null;
  sections: Omit<NewSection, "_key">[];
  saveAsTemplate: boolean;
  date?: string;
}

let _key = 0;
const newKey = () => ++_key;

function emptySection(): NewSection {
  return {
    _key: newKey(), order: 0, name: "Section",
    durationType: "time", duration: 600, distance: null,
    repetitions: null, zoneType: "pace_zone", targetZone: 2,
    targetPaceLow: null, targetPaceHigh: null,
    targetHRLow: null, targetHRHigh: null, targetRPE: null, notes: null,
  };
}

const ZONE_NAMES = ["", "Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];

export function WorkoutBuilder({ sports, paceZones, hrZones, onSave, onCancel, onDelete, initialDate, editTemplate, plannedWorkoutMode }: Props) {
  const isEditing = !!editTemplate;

  const [name, setName]           = useState(editTemplate?.name ?? "");
  const [sportId, setSportId]     = useState(editTemplate?.sportId ?? sports[0]?.id ?? "");
  const [typeId, setTypeId]           = useState<string | null>(editTemplate?.typeId ?? null);
  const [description, setDescription] = useState(editTemplate?.description ?? "");
  const [sections, setSections]       = useState<NewSection[]>(
    editTemplate?.sections.length
      ? editTemplate.sections.map(s => ({ ...s, _key: newKey() }))
      : [emptySection()]
  );
  // Hide template option only when editing an existing template (saves = update, not new).
  const showTemplateOption = !isEditing;
  // Default: unchecked when adding from calendar (one-off), checked when opening from library.
  const [saveAsTemplate, setSaveAsTemplate] = useState(!isEditing && !initialDate);
  const [date, setDate]               = useState(initialDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedSport = sports.find(s => s.id === sportId);
  const selectedType  = selectedSport?.workoutTypes.find(t => t.id === typeId);

  // Auto-computed color from sport + type — used when saving
  const autoColor = workoutColor(selectedSport?.name ?? "", selectedType?.name ?? null);

  // ── Section helpers ────────────────────────────────────────────────
  function addSection() {
    setSections(prev => [...prev, { ...emptySection(), order: prev.length }]);
  }

  function removeSection(key: number) {
    setSections(prev => prev.filter(s => s._key !== key).map((s, i) => ({ ...s, order: i })));
  }

  function updateSection(key: number, patch: Partial<NewSection>) {
    setSections(prev => prev.map(s => s._key === key ? { ...s, ...patch } : s));
  }

  // ── Estimated totals from sections ────────────────────────────────
  const estimated = useCallback(() => {
    let totalSec = 0;
    let totalM = 0;
    const zoneSec: Record<string, number> = {};
    for (const s of sections) {
      const reps = s.repetitions ?? 1;
      let dur = 0;
      if (s.durationType === "time" && s.duration) {
        dur = s.duration * reps;
        totalSec += dur;
      } else if (s.durationType === "distance" && s.distance) {
        const pace = s.targetPaceHigh
          ? ((s.targetPaceLow ?? s.targetPaceHigh) + s.targetPaceHigh) / 2
          : 360;
        dur = (s.distance * reps / 1000) * pace;
        totalSec += dur;
        totalM += s.distance * reps;
      }
      if (s.targetZone && dur > 0) {
        const z = `z${s.targetZone}`;
        zoneSec[z] = (zoneSec[z] ?? 0) + dur;
      }
    }
    return { totalSec, totalM, zoneSec };
  }, [sections]);

  const est = estimated();

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      name: name.trim(), sportId, typeId, description, color: autoColor,
      sections: sections.map(({ _key, ...s }, i) => ({ ...s, order: i })),
      saveAsTemplate, date: date || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-primary">{isEditing ? (plannedWorkoutMode ? "Edit workout" : "Edit template") : "Build workout"}</h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 p-5">
            {/* Name */}
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted mb-1 block">Workout name *</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Threshold run, Easy long run, 5×1km"
                className={inputCls}
              />
            </div>

            {/* Sport */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Sport</label>
              <select value={sportId} onChange={e => { setSportId(e.target.value); setTypeId(null); }} className={inputCls}>
                {sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* Type + color preview */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 flex items-center gap-2">
                Type
                {/* Live colour swatch */}
                <span
                  className="inline-block w-3 h-3 rounded-full border border-border/60"
                  style={{ backgroundColor: autoColor }}
                  title={`Colour: ${autoColor}`}
                />
              </label>
              <select value={typeId ?? ""} onChange={e => setTypeId(e.target.value || null)} className={inputCls}>
                <option value="">No type</option>
                {selectedSport?.workoutTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Date (leave blank to add to library only)</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Notes</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes" className={inputCls} />
            </div>
          </div>

          {/* Sections */}
          <div className="px-5 pb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-primary">Sections</p>
              <button onClick={addSection} className="flex items-center gap-1 text-xs text-accent hover:underline">
                <Plus size={13} />
                Add section
              </button>
            </div>

            <div className="space-y-2">
              {sections.map((s) => (
                <SectionRow
                  key={s._key}
                  section={s}
                  paceZones={paceZones}
                  hrZones={hrZones}
                  onChange={patch => updateSection(s._key, patch)}
                  onRemove={() => removeSection(s._key)}
                  canRemove={sections.length > 1}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          {est.totalSec > 0 && (
            <div className="px-5 pb-5 mt-4">
              <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2">
                <p className="text-xs font-medium text-muted uppercase tracking-wide">Estimated</p>
                <div className="flex gap-4 text-sm">
                  <span className="font-mono text-primary">{formatDuration(est.totalSec)}</span>
                  {est.totalM > 0 && <span className="font-mono text-muted">{formatDistance(est.totalM)}</span>}
                </div>
                <ZoneBar distribution={est.zoneSec} height={6} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3">
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 text-sm text-red-500 hover:text-red-400 transition">
              Delete
            </button>
          )}
          {onDelete && confirmDelete && (
            <>
              <span className="text-xs text-muted">Delete this workout?</span>
              <button onClick={onDelete} className="px-3 py-1.5 rounded-lg bg-red-500 text-xs font-medium text-white hover:bg-red-400 transition">Confirm</button>
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs text-muted hover:text-primary transition">No</button>
            </>
          )}
          {showTemplateOption && (
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={saveAsTemplate} onChange={e => setSaveAsTemplate(e.target.checked)}
                className="rounded" />
              Save as reusable template
            </label>
          )}
          <div className="flex-1" />
          <button onClick={onCancel} className="px-4 py-2 text-sm text-muted hover:text-primary transition">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-5 py-2 rounded-xl bg-accent text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition"
          >
            {isEditing ? "Save changes" : date ? "Add to plan" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section row ────────────────────────────────────────────────────────────

function SectionRow({ section: s, paceZones, hrZones, onChange, onRemove, canRemove }: {
  section: NewSection;
  paceZones?: number[][];
  hrZones?: number[][];
  onChange: (patch: Partial<NewSection>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);

  const zoneLabel = s.targetZone
    ? ZONE_NAMES[s.targetZone] + (paceZones?.[s.targetZone - 1]
      ? ` · ${secPerKmToPaceStr(paceZones[s.targetZone - 1][1])}–${secPerKmToPaceStr(paceZones[s.targetZone - 1][0])}`
      : "")
    : "No zone";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Collapsed header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface transition cursor-pointer" onClick={() => setOpen(o => !o)}>
        <GripVertical size={14} className="text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-primary">{s.name}</span>
          <span className="ml-2 text-xs text-muted">
            {s.durationType === "time" && s.duration ? formatDuration(s.duration * (s.repetitions ?? 1)) : ""}
            {s.durationType === "distance" && s.distance ? formatDistance(s.distance * (s.repetitions ?? 1)) : ""}
            {s.repetitions && s.repetitions > 1 ? ` ×${s.repetitions}` : ""}
            {s.targetZone && ` · Z${s.targetZone}`}
          </span>
        </div>
        {s.targetZone && (
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ZONE_COLORS[s.targetZone] }} />
        )}
        <ChevronDown size={14} className={cn("text-muted transition-transform shrink-0", open && "rotate-180")} />
        {canRemove && (
          <button onClick={e => { e.stopPropagation(); onRemove(); }}
            className="p-1 rounded hover:text-error transition-colors text-muted">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Expanded editor */}
      {open && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border bg-surface">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted mb-1 block">Section name</label>
            <input value={s.name} onChange={e => onChange({ name: e.target.value })} className={inputCls} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Duration type</label>
            <select value={s.durationType} onChange={e => onChange({ durationType: e.target.value as "time" | "distance" | "open" })} className={inputCls}>
              <option value="time">Time</option>
              <option value="distance">Distance</option>
              <option value="open">Open (no target)</option>
            </select>
          </div>

          {s.durationType === "time" && (
            <div>
              <label className="text-xs text-muted mb-1 block">Duration (min)</label>
              <input type="number" min={1} value={s.duration ? Math.round(s.duration / 60) : ""}
                onChange={e => onChange({ duration: parseInt(e.target.value) * 60 || null })}
                className={inputCls} placeholder="15" />
            </div>
          )}

          {s.durationType === "distance" && (
            <div>
              <label className="text-xs text-muted mb-1 block">Distance (m)</label>
              <input type="number" min={100} value={s.distance ?? ""}
                onChange={e => onChange({ distance: parseFloat(e.target.value) || null })}
                className={inputCls} placeholder="1000" />
            </div>
          )}

          <div>
            <label className="text-xs text-muted mb-1 block">Repetitions</label>
            <input type="number" min={1} value={s.repetitions ?? ""}
              onChange={e => onChange({ repetitions: parseInt(e.target.value) || null })}
              className={inputCls} placeholder="1" />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Intensity zone</label>
            <select value={s.targetZone ?? ""} onChange={e => onChange({ targetZone: parseInt(e.target.value) || null })} className={inputCls}>
              <option value="">No zone</option>
              {[1, 2, 3, 4, 5].map(z => (
                <option key={z} value={z}>
                  {ZONE_NAMES[z]}
                  {paceZones?.[z - 1] ? ` (${secPerKmToPaceStr(paceZones[z - 1][1])}–${secPerKmToPaceStr(paceZones[z - 1][0])})` : ""}
                  {hrZones?.[z - 1] ? ` · ${hrZones[z - 1][0]}–${hrZones[z - 1][1]} bpm` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-muted mb-1 block">Notes</label>
            <input value={s.notes ?? ""} onChange={e => onChange({ notes: e.target.value || null })}
              placeholder="Optional section notes" className={inputCls} />
          </div>

          {s.targetZone && (
            <div className="sm:col-span-2 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ZONE_COLORS[s.targetZone] }} />
              <p className="text-xs text-muted">{zoneLabel}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
