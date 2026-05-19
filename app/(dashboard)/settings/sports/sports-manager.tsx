"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkoutType { id: string; name: string; color: string | null; }
interface Sport { id: string; name: string; color: string; icon: string; isDefault?: boolean; workoutTypes: WorkoutType[]; }

const PRESET_COLORS = [
  "#10B981","#059669","#6366F1","#38BDF8","#0EA5E9",
  "#F87171","#FBBF24","#F97316","#A78BFA","#EC4899",
];

export function SportsManager({ sports: initial }: { sports: Sport[] }) {
  const router = useRouter();
  const [sports, setSports] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initial.map(s => s.id)));
  const [saving, setSaving] = useState(false);

  // New sport form
  const [newSportName, setNewSportName]   = useState("");
  const [newSportColor, setNewSportColor] = useState(PRESET_COLORS[0]);

  // New type form per sport
  const [newTypeName, setNewTypeName] = useState<Record<string, string>>({});

  async function addSport() {
    if (!newSportName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sport", name: newSportName.trim(), color: newSportColor, icon: "run" }),
    });
    if (res.ok) {
      const sport = await res.json();
      setSports(prev => [...prev, { ...sport, workoutTypes: [] }]);
      setNewSportName("");
      setExpanded(e => new Set([...e, sport.id]));
    }
    setSaving(false);
  }

  async function deleteSport(id: string) {
    if (!confirm("Delete this sport and all its workout types?")) return;
    await fetch(`/api/sports?id=${id}&kind=sport`, { method: "DELETE" });
    setSports(prev => prev.filter(s => s.id !== id));
  }

  async function addType(sportId: string) {
    const name = newTypeName[sportId]?.trim();
    if (!name) return;
    setSaving(true);
    const sport = sports.find(s => s.id === sportId)!;
    const res = await fetch("/api/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "type", name, sportId, color: sport.color }),
    });
    if (res.ok) {
      const type = await res.json();
      setSports(prev => prev.map(s => s.id === sportId
        ? { ...s, workoutTypes: [...s.workoutTypes, type] }
        : s
      ));
      setNewTypeName(prev => ({ ...prev, [sportId]: "" }));
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
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sport.color }} />
            <span className="font-semibold text-primary flex-1">{sport.name}</span>
            <span className="text-xs text-muted">{sport.workoutTypes.length} types</span>
            {!sport.isDefault && (
              <button
                onClick={e => { e.stopPropagation(); deleteSport(sport.id); }}
                className="p-1 text-muted hover:text-error transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
            {expanded.has(sport.id) ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
          </div>

          {/* Types */}
          {expanded.has(sport.id) && (
            <div className="border-t border-border px-4 py-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {sport.workoutTypes.map(type => (
                  <div key={type.id} className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-border text-sm">
                    <span className="text-primary">{type.name}</span>
                    <button
                      onClick={() => deleteType(sport.id, type.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-error transition"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add type */}
              <div className="flex gap-2 mt-2">
                <input
                  value={newTypeName[sport.id] ?? ""}
                  onChange={e => setNewTypeName(p => ({ ...p, [sport.id]: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && addType(sport.id)}
                  placeholder="New type name (e.g. Easy Run, LT Run)"
                  className="flex-1 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <button
                  onClick={() => addType(sport.id)}
                  disabled={saving || !newTypeName[sport.id]?.trim()}
                  className="px-3 py-1.5 rounded-xl bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add sport */}
      <div className="rounded-2xl bg-surface border border-border p-4 space-y-3">
        <p className="text-sm font-semibold text-primary">Add new sport</p>
        <div className="flex gap-3 items-end">
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
            <div className="flex gap-1.5 flex-wrap w-40">
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
