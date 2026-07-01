"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronRight, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkoutType { id: string; name: string; color: string | null; order: number; defaultZone: number | null; isShared: boolean; }
interface Sport { id: string; name: string; color: string; icon: string; isDefault?: boolean; isRunningRelated: boolean; workoutFlagTypeId: string | null; workoutTypes: WorkoutType[]; }

const PRESET_COLORS = [
  // Greens & teals
  "#10B981","#059669","#34D399","#6EE7B7","#14B8A6","#0D9488","#2DD4BF",
  // Blues
  "#3B82F6","#0EA5E9","#38BDF8","#60A5FA","#BAE6FD","#1D4ED8","#6366F1",
  // Purples & pinks
  "#A78BFA","#8B5CF6","#7C3AED","#EC4899","#F472B6","#DB2777","#E879F9",
  // Oranges & reds
  "#F97316","#FB923C","#FBBF24","#F59E0B","#F87171","#EF4444","#DC2626",
  // Neutrals & special
  "#94A3B8","#64748B","#1E293B","#D946EF","#84CC16","#22D3EE","#FAFAFA",
];

const TYPE_COLOR_PALETTE = [
  "#FCA5A5","#F87171","#FB923C","#F97316","#FDE68A",
  "#FCD34D","#FBBF24","#84CC16","#6EE7B7","#6EE7B7",
  "#34D399","#2DD4BF","#14B8A6","#BAE6FD","#7DD3FC",
  "#60A5FA","#3B82F6","#818CF8","#C4B5FD","#A78BFA",
  "#8B5CF6","#E879F9","#F9A8D4","#F472B6","#EC4899",
];

// Canonical running type colors
const RUN_TYPE_COLORS: Record<string, string> = {
  "easy": "#7DD3FC", "lätt": "#7DD3FC", "distans": "#7DD3FC", "long": "#7DD3FC", "lång": "#7DD3FC",
  "tempo": "#2DD4BF",
  "lt": "#F472B6", "tröskel": "#F472B6", "threshold": "#F472B6",
  "at": "#818CF8", "aerob": "#818CF8",
  "speed": "#3B82F6", "intervall": "#3B82F6", "interval": "#3B82F6", "fartlek": "#3B82F6",
};

function guessTypeColor(name: string, sportColor: string): string {
  const n = name.toLowerCase();
  for (const [key, color] of Object.entries(RUN_TYPE_COLORS)) {
    if (n.includes(key)) return color;
  }
  return sportColor;
}

export function SportsManager({ sports: initial }: { sports: Sport[] }) {
  const router = useRouter();
  const [sports, setSports] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initial.map(s => s.id)));
  const [saving, setSaving] = useState(false);
  const [confirmDeleteSportId, setConfirmDeleteSportId] = useState<string | null>(null);
  const [editingColorFor, setEditingColorFor] = useState<string | null>(null);
  const [editingSportColorFor, setEditingSportColorFor] = useState<string | null>(null);

  // New sport form
  const [newSportName, setNewSportName]   = useState("");
  const [newSportColor, setNewSportColor] = useState(PRESET_COLORS[0]);
  const [newSportIsRunningRelated, setNewSportIsRunningRelated] = useState(false);

  // New type form per sport
  const [newTypeName,  setNewTypeName]  = useState<Record<string, string>>({});
  const [newTypeColor, setNewTypeColor] = useState<Record<string, string>>({});

  async function addSport() {
    if (!newSportName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sport", name: newSportName.trim(), color: newSportColor, icon: "run", isRunningRelated: newSportIsRunningRelated }),
    });
    if (res.ok) {
      const sport = await res.json();
      setSports(prev => [...prev, { ...sport, workoutTypes: [] }]);
      setNewSportName("");
      setNewSportIsRunningRelated(false);
      setExpanded(e => new Set([...e, sport.id]));
    }
    setSaving(false);
  }

  async function deleteSport(id: string) {
    if (confirmDeleteSportId !== id) { setConfirmDeleteSportId(id); return; }
    setConfirmDeleteSportId(null);
    await fetch(`/api/sports?id=${id}&kind=sport`, { method: "DELETE" });
    setSports(prev => prev.filter(s => s.id !== id));
  }

  async function updateSport(id: string, patch: Partial<Pick<Sport, "name" | "color" | "isRunningRelated" | "workoutFlagTypeId">>) {
    setSports(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    await fetch("/api/sports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sport", id, ...patch }),
    });
  }

  async function addType(sportId: string) {
    const name = newTypeName[sportId]?.trim();
    if (!name) return;
    setSaving(true);
    const sport = sports.find(s => s.id === sportId)!;
    const color = newTypeColor[sportId] ?? guessTypeColor(name, sport.color);
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "type", name, sportId, color }),
    });
    if (res.ok) {
      const type = await res.json();
      setSports(prev => prev.map(s => s.id === sportId
        ? { ...s, workoutTypes: [...s.workoutTypes, type] }
        : s
      ));
      setNewTypeName(prev => ({ ...prev, [sportId]: "" }));
      setNewTypeColor(prev => ({ ...prev, [sportId]: "" }));
    }
    setSaving(false);
  }

  async function deleteType(sportId: string, typeId: string) {
    await fetch(`/api/sports?id=${typeId}&kind=type`, { method: "DELETE" });
    setSports(prev => prev.map(s => s.id === sportId
      ? { ...s, workoutTypes: s.workoutTypes.filter(t => t.id !== typeId) }
      : s
    ));
  }

  async function updateType(sportId: string, typeId: string, patch: Partial<Pick<WorkoutType, "name" | "color" | "order" | "defaultZone">>) {
    const sport = sports.find(s => s.id === sportId);
    const type = sport?.workoutTypes.find(t => t.id === typeId);
    const isShared = type?.isShared ?? false;
    // `order` is per-sport list position — never propagate it to other sports' copies.
    const { order, ...syncPatch } = patch;

    setSports(prev => prev.map(s => ({
      ...s,
      workoutTypes: s.workoutTypes.map(t => {
        if (t.id === typeId) return { ...t, ...patch };
        if (isShared && t.isShared) return { ...t, ...syncPatch };
        return t;
      }),
    })));

    await fetch("/api/sports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "type", id: typeId, ...patch }),
    });
  }

  // Reorder by swapping with the adjacent type and renumbering the whole list
  // sequentially — types created via "Add type" all default to order 0, so a
  // plain swap of equal values would be a no-op on first use.
  async function moveType(sportId: string, typeId: string, dir: "up" | "down") {
    const sport = sports.find(s => s.id === sportId);
    if (!sport) return;
    const types = [...sport.workoutTypes];
    const idx = types.findIndex(t => t.id === typeId);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= types.length) return;
    [types[idx], types[swapIdx]] = [types[swapIdx], types[idx]];
    const renumbered = types.map((t, i) => ({ ...t, order: i }));
    setSports(prev => prev.map(s => s.id === sportId ? { ...s, workoutTypes: renumbered } : s));
    await Promise.all(renumbered.map(t =>
      fetch("/api/sports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "type", id: t.id, order: t.order }),
      })
    ));
  }

  return (
    <div className="space-y-4">
      {/* Sport list */}
      {sports.map(sport => (
        <div key={sport.id} className="rounded-2xl bg-surface border border-border overflow-hidden">
          {/* Sport header */}
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors"
            onClick={() => setExpanded(e => { const n = new Set(e); n.has(sport.id) ? n.delete(sport.id) : n.add(sport.id); return n; })}
          >
            <button
              onClick={e => { e.stopPropagation(); setEditingSportColorFor(c => c === sport.id ? null : sport.id); }}
              className="w-3 h-3 rounded-full shrink-0 border border-border/40"
              style={{ backgroundColor: sport.color }}
            />
            <input
              defaultValue={sport.name}
              onClick={e => e.stopPropagation()}
              onBlur={e => {
                const name = e.target.value.trim();
                if (name && name !== sport.name) updateSport(sport.id, { name });
                else e.target.value = sport.name;
              }}
              className="font-semibold text-primary flex-1 min-w-0 bg-transparent px-1 py-0.5 rounded truncate focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
            />
            {sport.isRunningRelated && (
              <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">Running</span>
            )}
            <span className="hidden sm:inline text-xs text-muted shrink-0">{sport.workoutTypes.length} types</span>
            {!sport.isDefault && (
              confirmDeleteSportId === sport.id ? (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setConfirmDeleteSportId(null)}
                    className="px-2 py-0.5 rounded text-xs text-muted hover:bg-surface-2 transition"
                  >Cancel</button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteSport(sport.id); }}
                    className="px-2 py-0.5 rounded text-xs font-semibold text-error bg-error/10 hover:bg-error/20 transition"
                  >Delete</button>
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); deleteSport(sport.id); }}
                  className="p-1 text-muted hover:text-error transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )
            )}
            {expanded.has(sport.id) ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
          </div>

          {/* Sport color picker */}
          {editingSportColorFor === sport.id && (
            <div className="border-t border-border px-4 py-2 flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { updateSport(sport.id, { color: c }); setEditingSportColorFor(null); }}
                  className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ backgroundColor: c, borderColor: sport.color === c ? "white" : "transparent" }}
                />
              ))}
            </div>
          )}

          {/* Types */}
          {expanded.has(sport.id) && (
            <div className="border-t border-border px-4 py-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input type="checkbox" checked={sport.isRunningRelated}
                  onChange={e => updateSport(sport.id, { isRunningRelated: e.target.checked })} className="rounded" />
                Related to running (counts toward weekly running distance)
              </label>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="shrink-0">Workout flag maps to:</span>
                <select
                  value={sport.workoutFlagTypeId ?? ""}
                  onChange={e => updateSport(sport.id, { workoutFlagTypeId: e.target.value || null })}
                  className="flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                  title="Color used when Strava marks an activity as a generic workout (flag icon)"
                >
                  <option value="">Auto-detect (by name)</option>
                  {sport.workoutTypes.filter(t => !t.isShared).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                {sport.workoutTypes.map((type, i) => (
                  <div key={type.id} className="rounded-xl border border-border bg-surface-2 overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                      {/* Reorder */}
                      <div className="flex flex-col shrink-0">
                        <button onClick={() => moveType(sport.id, type.id, "up")} disabled={i === 0}
                          className="text-muted hover:text-primary disabled:opacity-25 transition leading-none">
                          <ChevronUp size={12} />
                        </button>
                        <button onClick={() => moveType(sport.id, type.id, "down")} disabled={i === sport.workoutTypes.length - 1}
                          className="text-muted hover:text-primary disabled:opacity-25 transition leading-none">
                          <ChevronDown size={12} />
                        </button>
                      </div>

                      {/* Color */}
                      <button
                        onClick={() => setEditingColorFor(c => c === type.id ? null : type.id)}
                        className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/40"
                        style={{ backgroundColor: type.color ?? sport.color }}
                      />

                      {/* Name */}
                      <input
                        defaultValue={type.name}
                        onBlur={e => {
                          const name = e.target.value.trim();
                          if (name && name !== type.name) updateType(sport.id, type.id, { name });
                          else e.target.value = type.name;
                        }}
                        className="flex-1 min-w-0 bg-transparent text-sm text-primary px-1 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                      />

                      {/* Shared badge */}
                      {type.isShared && (
                        <span
                          className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded shrink-0"
                          title="Editing this updates it for every sport"
                        >
                          Shared
                        </span>
                      )}

                      {/* Default zone */}
                      <select
                        value={type.defaultZone != null ? String(type.defaultZone) : ""}
                        onChange={e => updateType(sport.id, type.id, { defaultZone: e.target.value ? parseInt(e.target.value, 10) : null })}
                        className="text-[11px] rounded-lg border border-border bg-surface px-1.5 py-1 text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                        title="Default intensity zone for this type"
                      >
                        <option value="">Auto zone</option>
                        {[1, 2, 3, 4, 5].map(z => <option key={z} value={String(z)}>Z{z}</option>)}
                      </select>

                      {/* Delete */}
                      {!type.isShared && (
                        <button
                          onClick={() => deleteType(sport.id, type.id)}
                          className="p-1 text-muted hover:text-error transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    {/* Color picker */}
                    {editingColorFor === type.id && (
                      <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                        {TYPE_COLOR_PALETTE.map(c => (
                          <button
                            key={c}
                            onClick={() => { updateType(sport.id, type.id, { color: c }); setEditingColorFor(null); }}
                            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                            style={{ backgroundColor: c, borderColor: (type.color ?? sport.color) === c ? "white" : "transparent" }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add type */}
              <div className="space-y-2 mt-2">
                <div className="flex gap-2">
                  <input
                    value={newTypeName[sport.id] ?? ""}
                    onChange={e => {
                      const n = e.target.value;
                      setNewTypeName(p => ({ ...p, [sport.id]: n }));
                      // Auto-guess color from name if not manually set
                      const guessed = guessTypeColor(n, sport.color);
                      setNewTypeColor(p => ({ ...p, [sport.id]: guessed }));
                    }}
                    onKeyDown={e => e.key === "Enter" && addType(sport.id)}
                    placeholder="New type name (e.g. Easy Run, LT, Tempo)"
                    className="flex-1 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <button
                    onClick={() => addType(sport.id)}
                    disabled={saving || !newTypeName[sport.id]?.trim()}
                    className="px-3 py-1.5 rounded-xl bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  </button>
                </div>
                {/* Color picker for new type */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted">Color:</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {TYPE_COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewTypeColor(p => ({ ...p, [sport.id]: c }))}
                        className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: (newTypeColor[sport.id] ?? guessTypeColor(newTypeName[sport.id] ?? "", sport.color)) === c
                            ? "white" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <span className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: newTypeColor[sport.id] ?? guessTypeColor(newTypeName[sport.id] ?? "", sport.color) }} />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add sport */}
      <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
        <p className="text-sm font-semibold text-primary">Add new sport</p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">Sport name</label>
            <input
              value={newSportName}
              onChange={e => setNewSportName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSport()}
              placeholder="e.g. Swimming, Triathlon"
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Color</label>
            <div className="flex gap-1.5 flex-wrap w-full sm:w-40">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewSportColor(c)}
                  className={cn("w-6 h-6 rounded-full border-2 transition", newSportColor === c ? "border-white scale-110" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input type="checkbox" checked={newSportIsRunningRelated}
            onChange={e => setNewSportIsRunningRelated(e.target.checked)} className="rounded" />
          Related to running (counts toward weekly running distance)
        </label>
        <button
          onClick={addSport}
          disabled={saving || !newSportName.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-40 transition"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <Plus size={14} />
          Add sport
        </button>
      </div>
    </div>
  );
}
