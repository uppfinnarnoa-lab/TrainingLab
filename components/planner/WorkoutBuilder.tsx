"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Plus, GripVertical, Trash2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { ZoneBar } from "./ZoneBar";
import { formatDuration, formatDistance } from "@/lib/utils";
import { secPerKmToPaceStr } from "@/lib/fitness/paces";
import type { SportCategory, WorkoutSection, WorkoutType } from "@/lib/planner/types";
import { ZONE_COLORS } from "@/lib/planner/types";
import { workoutColor } from "@/lib/planner/colors";
import { estimateSections } from "@/lib/planner/estimate";
import { cn } from "@/lib/utils";

interface NewSection extends Omit<WorkoutSection, "id"> { _key: number; }

import type { WorkoutTemplate } from "@/lib/planner/types";

interface Props {
  sports: SportCategory[];
  paceZones?: number[][];
  hrZones?: number[][];
  onSave: (data: BuilderData) => void;
  onCancel: () => void;
  onDelete?: () => void;
  initialDate?: string;
  editTemplate?: WorkoutTemplate;
  plannedWorkoutMode?: boolean;
  onSportsUpdated?: (sports: SportCategory[]) => void;
  // Debounced, fired automatically as fields change while editing an existing
  // template/workout (never for new ones — there's nothing to attach to yet).
  onAutoSave?: (data: BuilderData) => void;
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
  totalDuration: number | null;
  totalDistance: number | null;
}

let _key = 0;
const newKey = () => ++_key;

const ZONE_NAMES = ["", "Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];

const COLOR_PALETTE = [
  // Blues
  "#7DD3FC","#BAE6FD","#60A5FA","#3B82F6","#2563EB","#1D4ED8",
  // Teals & greens
  "#2DD4BF","#14B8A6","#0D9488","#34D399","#6EE7B7","#10B981","#84CC16",
  // Purples & pinks
  "#818CF8","#6366F1","#A78BFA","#8B5CF6","#C4B5FD","#E879F9","#F472B6","#EC4899","#F9A8D4",
  // Oranges & reds & yellows
  "#FB923C","#F97316","#FBBF24","#FCD34D","#FDE68A","#F87171","#FCA5A5","#EF4444",
  // Neutrals
  "#94A3B8","#64748B","#D946EF","#22D3EE",
];

/** Map a workout type name to a default target zone (1–5). Zone 1 for no type. */
function typeToZone(typeName: string | null): number {
  if (!typeName) return 1;
  const t = typeName.toLowerCase();
  if (/race|tävl|lopp|mila|stafett|competition|comp\b/.test(t)) return 5;
  if (/speed|speedwork|intervall|interval|fartlek|tabata/.test(t)) return 5;
  if (/\blt\b|threshold|tröskel|lactate/.test(t)) return 4;
  if (/\bat\b|aerobic threshold|aerob tröskel/.test(t)) return 3;
  if (/tempo/.test(t)) return 3;
  if (/easy|distans|base|aerob|recovery|lugn/.test(t)) return 2;
  return 1;
}

function makeDefaultSection(duration: number | null, distance: number | null, zone: number): NewSection {
  let durationType: "time" | "distance" | "open" = "open";
  if (duration) durationType = "time";
  else if (distance) durationType = "distance";
  return {
    _key: newKey(), order: 0, name: "Section",
    durationType, duration, distance,
    repetitions: null, zoneType: "pace_zone", targetZone: zone,
    targetPaceLow: null, targetPaceHigh: null,
    targetHRLow: null, targetHRHigh: null, targetRPE: null, notes: null,
    restDurationType: null, restDuration: null, restDistance: null, restTargetZone: null,
  };
}

function emptySection(): NewSection {
  return {
    _key: newKey(), order: 0, name: "Section",
    durationType: "time", duration: 600, distance: null,
    repetitions: null, zoneType: "pace_zone", targetZone: 2,
    targetPaceLow: null, targetPaceHigh: null,
    targetHRLow: null, targetHRHigh: null, targetRPE: null, notes: null,
    restDurationType: null, restDuration: null, restDistance: null, restTargetZone: null,
  };
}

// ── Color usage helpers ────────────────────────────────────────────────────

function ColorUsageTable({ sports, context }: { sports: SportCategory[]; context: "sport" | "type"; sportId?: string }) {
  const rows: { color: string; label: string }[] = [];
  for (const s of sports) {
    if (context === "sport") {
      rows.push({ color: s.color, label: s.name });
    } else {
      for (const t of s.workoutTypes) {
        rows.push({ color: t.color ?? s.color, label: `${s.name}: ${t.name}` });
      }
    }
  }
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted uppercase tracking-wide">Colors in use</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-[11px] text-muted">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_PALETTE.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{ backgroundColor: c, borderColor: value === c ? "white" : "transparent" }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function WorkoutBuilder({ sports: sportsProp, paceZones, hrZones, onSave, onCancel, onDelete, initialDate, editTemplate, plannedWorkoutMode, onSportsUpdated, onAutoSave }: Props) {
  const isEditing = !!editTemplate;

  const [localSports, setLocalSports] = useState<SportCategory[]>(sportsProp);

  const [name, setName]           = useState(editTemplate?.name ?? "");
  const [sportId, setSportId]     = useState(editTemplate?.sportId ?? localSports[0]?.id ?? "");
  const [typeId, setTypeId]       = useState<string | null>(editTemplate?.typeId ?? null);
  const [description, setDescription] = useState(editTemplate?.description ?? "");

  // Top-level totals — drive the default single section when !sectionsCustomized
  const [totalDurMin, setTotalDurMin] = useState<number | "">(
    editTemplate?.estimatedDuration ? Math.round(editTemplate.estimatedDuration / 60) : ""
  );
  const [totalDistKm, setTotalDistKm] = useState<number | "">(
    editTemplate?.estimatedDistance ? Math.round(editTemplate.estimatedDistance / 100) / 10 : ""
  );

  // True when the user has manually added/removed sections (disables auto-sync)
  const [sectionsCustomized, setSectionsCustomized] = useState(
    (editTemplate?.sections.length ?? 0) > 0
  );

  // Initialize default section from template data if no sections exist
  const [sections, setSections] = useState<NewSection[]>(() => {
    if (editTemplate?.sections.length) {
      return editTemplate.sections.map(s => ({ ...s, _key: newKey() }));
    }
    const dur = editTemplate?.estimatedDuration ?? null;
    const dist = editTemplate?.estimatedDistance ?? null;
    const zone = editTemplate?.type?.defaultZone ?? typeToZone(editTemplate?.type?.name ?? null);
    return [makeDefaultSection(dur, dist, zone)];
  });

  const showTemplateOption = !isEditing;
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [date, setDate]           = useState(initialDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Add-type panel ────────────────────────────────────────────────────────
  const [showAddType, setShowAddType]     = useState(false);
  const [addTypeName, setAddTypeName]     = useState("");
  const [addTypeColor, setAddTypeColor]   = useState(COLOR_PALETTE[0]);
  const [addTypeSaving, setAddTypeSaving] = useState(false);

  // ── Add-sport panel ───────────────────────────────────────────────────────
  const [showAddSport, setShowAddSport]     = useState(false);
  const [addSportName, setAddSportName]     = useState("");
  const [addSportColor, setAddSportColor]   = useState(COLOR_PALETTE[9]);
  const [addSportIsRunningRelated, setAddSportIsRunningRelated] = useState(false);
  const [addSportSaving, setAddSportSaving] = useState(false);

  const selectedSport = localSports.find(s => s.id === sportId);
  const selectedType  = selectedSport?.workoutTypes.find(t => t.id === typeId);
  const effectiveTypeName = selectedType?.name ?? null;
  const autoColor = selectedType?.color ?? selectedSport?.color ?? workoutColor(selectedSport?.name ?? "", effectiveTypeName);

  // ── Sync helpers for the single default section ───────────────────────────

  function syncDefaultSection(opts: {
    durMin?: number | "";
    distKm?: number | "";
    typeName?: string | null;
    type?: WorkoutType | null;
  }) {
    if (sectionsCustomized || sections.length !== 1) return;
    const dur = opts.durMin !== undefined ? opts.durMin : totalDurMin;
    const dist = opts.distKm !== undefined ? opts.distKm : totalDistKm;
    const typeName = opts.typeName !== undefined ? opts.typeName : effectiveTypeName;
    const type = opts.type !== undefined ? opts.type : selectedType;
    const zone = type?.defaultZone ?? typeToZone(typeName);
    const durationSec = typeof dur === "number" && dur > 0 ? Math.round(dur * 60) : null;
    const distanceM   = typeof dist === "number" && dist > 0 ? Math.round(dist * 1000) : null;
    updateSection(sections[0]._key, {
      duration: durationSec,
      distance: distanceM,
      durationType: durationSec ? "time" : distanceM ? "distance" : "open",
      targetZone: zone,
    });
  }

  function handleTotalDurChange(val: number | "") {
    setTotalDurMin(val);
    syncDefaultSection({ durMin: val });
  }

  function handleTotalDistChange(val: number | "") {
    setTotalDistKm(val);
    syncDefaultSection({ distKm: val });
  }

  // ── Sport / type creators ─────────────────────────────────────────────────

  async function handleAddType() {
    if (!addTypeName.trim() || !sportId) return;
    setAddTypeSaving(true);
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "type", name: addTypeName.trim(), sportId, color: addTypeColor }),
    });
    if (res.ok) {
      const newType: WorkoutType = await res.json();
      const updated = localSports.map(s =>
        s.id === sportId
          ? { ...s, workoutTypes: [...s.workoutTypes, newType] }
          : s
      );
      setLocalSports(updated);
      onSportsUpdated?.(updated);
      setTypeId(newType.id);
      syncDefaultSection({ typeName: newType.name, type: newType });
      setAddTypeName("");
      setShowAddType(false);
    }
    setAddTypeSaving(false);
  }

  async function handleAddSport() {
    if (!addSportName.trim()) return;
    setAddSportSaving(true);
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sport", name: addSportName.trim(), color: addSportColor, icon: "run", isRunningRelated: addSportIsRunningRelated }),
    });
    if (res.ok) {
      const newSport: SportCategory = await res.json();
      const updated = [...localSports, newSport];
      setLocalSports(updated);
      onSportsUpdated?.(updated);
      setSportId(newSport.id);
      setTypeId(null);
      syncDefaultSection({ typeName: null, type: null });
      setAddSportName("");
      setAddSportIsRunningRelated(false);
      setShowAddSport(false);
    }
    setAddSportSaving(false);
  }

  // ── Section helpers ────────────────────────────────────────────────────────

  function addSection() {
    setSectionsCustomized(true);
    setSections(prev => [...prev, { ...emptySection(), order: prev.length }]);
  }
  function removeSection(key: number) {
    setSectionsCustomized(true);
    setSections(prev => prev.filter(s => s._key !== key).map((s, i) => ({ ...s, order: i })));
  }
  function updateSection(key: number, patch: Partial<NewSection>) {
    setSections(prev => prev.map(s => s._key === key ? { ...s, ...patch } : s));
  }

  // ── Section drag-and-drop reorder ─────────────────────────────────────────
  const [draggedKey, setDraggedKey] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<number | null>(null);

  function moveSection(fromKey: number, toKey: number) {
    if (fromKey === toKey) return;
    setSectionsCustomized(true);
    setSections(prev => {
      const fromIdx = prev.findIndex(s => s._key === fromKey);
      const toIdx = prev.findIndex(s => s._key === toKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }

  function moveSectionStep(key: number, dir: "up" | "down") {
    const idx = sections.findIndex(s => s._key === key);
    const targetIdx = dir === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || targetIdx < 0 || targetIdx >= sections.length) return;
    moveSection(key, sections[targetIdx]._key);
  }

  const estimated = useCallback(() => {
    return estimateSections(sections, paceZones);
  }, [sections, paceZones]);

  const est = estimated();

  // Auto-grow the top-level totals to match custom sections — the displayed
  // total can never be less than what the sections add up to. Skipped for the
  // single auto-synced default section (!sectionsCustomized), since its
  // distance→time pace estimate would otherwise bleed into Total time.
  useEffect(() => {
    if (!sectionsCustomized) return;

    const sectionsMin = Math.round(est.totalSec / 60);
    const curDur = typeof totalDurMin === "number" ? totalDurMin : 0;
    if (sectionsMin > curDur) setTotalDurMin(sectionsMin);

    const sectionsKm = Math.round(est.totalM / 100) / 10;
    const curDist = typeof totalDistKm === "number" ? totalDistKm : 0;
    if (sectionsKm > curDist) setTotalDistKm(sectionsKm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [est.totalSec, est.totalM, sectionsCustomized]);

  function buildData(): BuilderData {
    const secs = sections.map(({ _key, ...s }, i) => ({ ...s, order: i }));

    // Compute totals from sections; fall back to top-level fields if sections are open/empty
    let totalDuration: number | null = null;
    let totalDistance: number | null = null;
    for (const s of secs) {
      const reps = s.repetitions ?? 1;
      if (s.durationType === "time" && s.duration) totalDuration = (totalDuration ?? 0) + s.duration * reps;
      else if (s.durationType === "distance" && s.distance) totalDistance = (totalDistance ?? 0) + s.distance * reps;
      if (s.restDurationType === "time" && s.restDuration) totalDuration = (totalDuration ?? 0) + s.restDuration * reps;
      else if (s.restDurationType === "distance" && s.restDistance) totalDistance = (totalDistance ?? 0) + s.restDistance * reps;
    }
    if (!totalDuration && typeof totalDurMin === "number" && totalDurMin > 0)
      totalDuration = Math.round(totalDurMin * 60);
    if (!totalDistance && typeof totalDistKm === "number" && totalDistKm > 0)
      totalDistance = Math.round(totalDistKm * 1000);

    return {
      name: name.trim(), sportId, typeId,
      description, color: autoColor,
      sections: secs,
      saveAsTemplate, date: date || undefined,
      totalDuration, totalDistance,
    };
  }

  function handleSave() {
    if (!name.trim()) return;
    onSave(buildData());
  }

  // Debounced auto-save while editing an existing template/workout — skips
  // the very first run so opening the modal doesn't immediately re-save
  // identical data back to the server.
  const autoSaveSkippedFirst = useRef(false);
  useEffect(() => {
    if (!isEditing || !onAutoSave || !name.trim()) return;
    if (!autoSaveSkippedFirst.current) { autoSaveSkippedFirst.current = true; return; }
    const timer = setTimeout(() => onAutoSave(buildData()), 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, sportId, typeId, description, autoColor, sections, date, totalDurMin, totalDistKm]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-primary">
            {isEditing ? (plannedWorkoutMode ? "Edit workout" : "Edit template") : "Build workout"}
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 p-5">

            {/* Name */}
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted mb-1 block">Workout name *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Threshold run, Easy long run, 5×1km"
                className={inputCls} />
            </div>

            {/* Sport */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted block">Sport</label>
              <select value={sportId} onChange={e => {
                const newSportId = e.target.value;
                setSportId(newSportId);
                setTypeId(null);
                setShowAddType(false);
                syncDefaultSection({ typeName: null, type: null });
              }} className={inputCls}>
                {localSports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!showAddSport ? (
                <button type="button" onClick={() => setShowAddSport(true)}
                  className="text-[11px] text-accent hover:underline flex items-center gap-0.5">
                  <Plus size={11} /> Add sport
                </button>
              ) : (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-3">
                  <p className="text-xs font-semibold text-primary">New sport</p>
                  <div>
                    <label className="text-[11px] text-muted mb-1 block">Name</label>
                    <input value={addSportName} onChange={e => setAddSportName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAddSport()}
                      placeholder="e.g. Swimming, Triathlon"
                      className={inputCls} autoFocus />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted mb-1 block">Color</label>
                    <ColorSwatches value={addSportColor} onChange={setAddSportColor} />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                    <input type="checkbox" checked={addSportIsRunningRelated}
                      onChange={e => setAddSportIsRunningRelated(e.target.checked)} className="rounded" />
                    Related to running (counts toward weekly running distance)
                  </label>
                  <ColorUsageTable sports={localSports} context="sport" />
                  <p className="text-[11px] text-muted/70">Race type (🏆 yellow) added automatically.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAddSport(false)}
                      className="text-xs text-muted hover:text-primary transition">Cancel</button>
                    <button type="button" onClick={handleAddSport}
                      disabled={addSportSaving || !addSportName.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-xs font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition">
                      {addSportSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Create sport
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Type + color preview */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted flex items-center gap-2">
                Type
                <span className="inline-block w-3 h-3 rounded-full border border-border/60"
                  style={{ backgroundColor: autoColor }} title={`Color: ${autoColor}`} />
              </label>
              <select value={typeId ?? ""} onChange={e => {
                const val = e.target.value || null;
                setTypeId(val);
                const newType = localSports.find(s => s.id === sportId)?.workoutTypes.find(t => t.id === val) ?? null;
                syncDefaultSection({ typeName: newType?.name ?? null, type: newType });
              }} className={inputCls}>
                <option value="">No type</option>
                {selectedSport?.workoutTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {!showAddType ? (
                <button type="button" onClick={() => setShowAddType(true)}
                  className="text-[11px] text-accent hover:underline flex items-center gap-0.5">
                  <Plus size={11} /> Add type to {selectedSport?.name ?? "sport"}
                </button>
              ) : (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-3">
                  <p className="text-xs font-semibold text-primary">New type for {selectedSport?.name}</p>
                  <div>
                    <label className="text-[11px] text-muted mb-1 block">Name</label>
                    <input value={addTypeName} onChange={e => setAddTypeName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAddType()}
                      placeholder="e.g. Easy, Tempo, LT, Intervals"
                      className={inputCls} autoFocus />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted mb-1 block">Color</label>
                    <ColorSwatches value={addTypeColor} onChange={setAddTypeColor} />
                  </div>
                  <ColorUsageTable sports={localSports} context="type" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAddType(false)}
                      className="text-xs text-muted hover:text-primary transition">Cancel</button>
                    <button type="button" onClick={handleAddType}
                      disabled={addTypeSaving || !addTypeName.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-xs font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition">
                      {addTypeSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Add type
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Total time — always shown, drives default section when !sectionsCustomized */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Total time (min) *</label>
              <input
                type="number" min={1}
                value={totalDurMin}
                onChange={e => handleTotalDurChange(parseFloat(e.target.value) || "")}
                placeholder="e.g. 60"
                className={inputCls}
              />
            </div>

            {/* Total distance — optional */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Total distance (km)</label>
              <input
                type="number" min={0.1} step={0.1}
                value={totalDistKm}
                onChange={e => handleTotalDistChange(parseFloat(e.target.value) || "")}
                placeholder="e.g. 10"
                className={inputCls}
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">
                {plannedWorkoutMode ? "Date" : "Date (leave blank to add to library only)"}
              </label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Notes</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Optional notes" className={inputCls} />
            </div>
          </div>

          {/* Sections */}
          <div className="px-5 pb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-primary">Sections</p>
              <button onClick={addSection} className="flex items-center gap-1 text-xs text-accent hover:underline">
                <Plus size={13} /> Add section
              </button>
            </div>
            <div className="space-y-2">
              {sections.map((s, i) => (
                <SectionRow key={s._key} section={s} paceZones={paceZones} hrZones={hrZones}
                  onChange={patch => updateSection(s._key, patch)}
                  onRemove={() => removeSection(s._key)}
                  canRemove={sections.length > 1}
                  isDragging={draggedKey === s._key}
                  isDragOver={dragOverKey === s._key && draggedKey !== s._key}
                  onDragStart={() => setDraggedKey(s._key)}
                  onDragOver={() => setDragOverKey(s._key)}
                  onDragLeave={() => setDragOverKey(prev => prev === s._key ? null : prev)}
                  onDrop={() => {
                    if (draggedKey != null) moveSection(draggedKey, s._key);
                    setDraggedKey(null);
                    setDragOverKey(null);
                  }}
                  onDragEnd={() => { setDraggedKey(null); setDragOverKey(null); }}
                  canMoveUp={i > 0}
                  canMoveDown={i < sections.length - 1}
                  onMoveUp={() => moveSectionStep(s._key, "up")}
                  onMoveDown={() => moveSectionStep(s._key, "down")} />
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
                {est.activeSec > 0 && est.activeSec !== est.totalSec && (
                  <p className="text-xs text-muted">
                    Active interval time: <span className="font-mono text-primary">{formatDuration(est.activeSec)}</span>
                  </p>
                )}
                <ZoneBar distribution={est.zoneSec} height={6} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3 flex-wrap">
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)} className="px-3 py-2 text-sm text-red-500 hover:text-red-400 transition">
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
              <input type="checkbox" checked={saveAsTemplate} onChange={e => setSaveAsTemplate(e.target.checked)} className="rounded" />
              Save as reusable template
            </label>
          )}
          <div className="flex-1" />
          <button onClick={onCancel} className="px-4 py-2 text-sm text-muted hover:text-primary transition">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-5 py-2 rounded-xl bg-accent text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition">
            {isEditing ? "Save changes" : date ? "Add to plan" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sectionSummary(s: NewSection): string {
  const reps = s.repetitions ?? 1;
  const activeLabel = s.durationType === "time" && s.duration ? formatDuration(s.duration)
    : s.durationType === "distance" && s.distance ? formatDistance(s.distance) : "";
  const zoneLabel = s.targetZone ? ` Z${s.targetZone}` : "";
  if (reps <= 1) return `${activeLabel}${zoneLabel}`;

  const restLabel = s.restDurationType === "time" && s.restDuration ? formatDuration(s.restDuration)
    : s.restDurationType === "distance" && s.restDistance ? formatDistance(s.restDistance) : "";
  const restZoneLabel = s.restTargetZone ? ` Z${s.restTargetZone}` : "";
  const rest = restLabel ? ` + ${restLabel}${restZoneLabel} rest` : "";
  return `${reps}× ${activeLabel}${zoneLabel}${rest}`;
}

// ── Section row ────────────────────────────────────────────────────────────

function SectionRow({ section: s, paceZones, hrZones, onChange, onRemove, canRemove, isDragging, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: {
  section: NewSection;
  paceZones?: number[][];
  hrZones?: number[][];
  onChange: (patch: Partial<NewSection>) => void;
  onRemove: () => void;
  canRemove: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [open, setOpen] = useState(false);

  const zoneLabel = s.targetZone
    ? ZONE_NAMES[s.targetZone] + (paceZones?.[s.targetZone - 1]
      ? ` · ${secPerKmToPaceStr(paceZones[s.targetZone - 1][1])}–${secPerKmToPaceStr(paceZones[s.targetZone - 1][0])}`
      : "")
    : "No zone";

  return (
    <div className={cn("rounded-xl border overflow-hidden transition", isDragOver ? "border-accent" : "border-border", isDragging && "opacity-40")}>
      <div
        className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface transition cursor-pointer"
        onClick={() => setOpen(o => !o)}
        draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); onDragStart(); }}
        onDragOver={e => { e.preventDefault(); onDragOver(); }}
        onDragLeave={onDragLeave}
        onDrop={e => { e.preventDefault(); onDrop(); }}
        onDragEnd={onDragEnd}
      >
        <GripVertical size={14} className="text-muted shrink-0 cursor-grab active:cursor-grabbing hidden sm:block" />
        <div className="flex flex-col shrink-0">
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={!canMoveUp}
            className="text-muted hover:text-primary disabled:opacity-25 transition leading-none">
            <ChevronUp size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={!canMoveDown}
            className="text-muted hover:text-primary disabled:opacity-25 transition leading-none">
            <ChevronDown size={12} />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-primary">{s.name}</span>
          <span className="ml-2 text-xs text-muted">{sectionSummary(s)}</span>
        </div>
        {s.targetZone && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ZONE_COLORS[s.targetZone] }} />}
        <ChevronDown size={14} className={cn("text-muted transition-transform shrink-0", open && "rotate-180")} />
        {canRemove && (
          <button onClick={e => { e.stopPropagation(); onRemove(); }} className="p-1 rounded hover:text-error transition-colors text-muted">
            <Trash2 size={13} />
          </button>
        )}
      </div>

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

          {(s.repetitions ?? 1) > 1 && (
            <div className="sm:col-span-2 rounded-xl border border-border/60 bg-surface-2 p-2.5 space-y-1.5">
              <label className="text-xs text-muted block">Rest between reps</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select value={s.restDurationType ?? ""} onChange={e => {
                  const val = e.target.value as "" | "time" | "distance";
                  onChange(val
                    ? { restDurationType: val }
                    : { restDurationType: null, restDuration: null, restDistance: null, restTargetZone: null });
                }} className={inputCls}>
                  <option value="">No rest</option>
                  <option value="time">Time</option>
                  <option value="distance">Distance</option>
                </select>

                {s.restDurationType === "time" && (
                  <input type="number" min={1} value={s.restDuration ?? ""}
                    onChange={e => onChange({ restDuration: parseInt(e.target.value) || null })}
                    className={inputCls} placeholder="Seconds, e.g. 90" />
                )}
                {s.restDurationType === "distance" && (
                  <input type="number" min={1} value={s.restDistance ?? ""}
                    onChange={e => onChange({ restDistance: parseFloat(e.target.value) || null })}
                    className={inputCls} placeholder="Meters, e.g. 200" />
                )}

                {s.restDurationType && (
                  <select value={s.restTargetZone ?? ""} onChange={e => onChange({ restTargetZone: parseInt(e.target.value) || null })} className={inputCls}>
                    <option value="">No zone</option>
                    {[1, 2, 3, 4, 5].map(z => (
                      <option key={z} value={z}>
                        {ZONE_NAMES[z]}
                        {paceZones?.[z - 1] ? ` (${secPerKmToPaceStr(paceZones[z - 1][1])}–${secPerKmToPaceStr(paceZones[z - 1][0])})` : ""}
                        {hrZones?.[z - 1] ? ` · ${hrZones[z - 1][0]}–${hrZones[z - 1][1]} bpm` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

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
