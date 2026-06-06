"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, ChevronDown, ChevronRight, Plus, X, PanelLeftClose, LayoutTemplate } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import type { WorkoutTemplate, SportCategory } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const LIB_COLLAPSED_KEY = "planner_lib_collapsed";

interface Props {
  templates: WorkoutTemplate[];
  sports: SportCategory[];
  onAddToDate: (templateId: string) => void;
  onDeleteTemplate: (id: string) => void;
  onNewTemplate: () => void;
  onEditTemplate: (template: WorkoutTemplate) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onMobileSelectTemplate?: (templateId: string) => void;
}

export function TemplateLibrary({ templates, sports, onAddToDate, onDeleteTemplate, onNewTemplate, onEditTemplate, mobileOpen, onMobileClose, onMobileSelectTemplate }: Props) {
  const [query, setQuery] = useState("");
  const [activeSport, setActiveSport] = useState<string | null>(null);
  const [collapsedSports, setCollapsedSports] = useState<Set<string>>(new Set());
  const [libCollapsed, setLibCollapsed] = useState(false);

  useEffect(() => {
    setLibCollapsed(localStorage.getItem(LIB_COLLAPSED_KEY) === "true");
  }, []);

  function toggleLib() {
    const next = !libCollapsed;
    setLibCollapsed(next);
    localStorage.setItem(LIB_COLLAPSED_KEY, String(next));
  }

  const filtered = useMemo(() => {
    let list = templates;
    if (activeSport) list = list.filter(t => t.sportId === activeSport);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.sport.name.toLowerCase().includes(q) ||
        t.type?.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [templates, activeSport, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutTemplate[]>();
    for (const t of filtered) {
      const key = t.sport.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filtered]);

  function toggleCollapseSport(sport: string) {
    setCollapsedSports(prev => {
      const next = new Set(prev);
      if (next.has(sport)) next.delete(sport);
      else next.add(sport);
      return next;
    });
  }

  // ── Collapsed strip (desktop only) ────────────────────────────────────────
  if (!mobileOpen && libCollapsed) {
    return (
      <aside className="hidden md:flex md:flex-col md:w-10 md:shrink-0 md:h-full border-r border-border bg-surface items-center py-3 gap-3">
        <button
          onClick={toggleLib}
          title="Expand templates"
          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
        >
          <LayoutTemplate size={16} />
        </button>
        {templates.length > 0 && (
          <span className="text-[10px] text-muted font-mono">{templates.length}</span>
        )}
      </aside>
    );
  }

  // ── Full sidebar ───────────────────────────────────────────────────────────
  return (
    <aside className={cn(
      "flex flex-col border-r border-border bg-surface",
      mobileOpen
        ? "fixed inset-0 z-50 w-full"
        : "hidden md:flex md:w-64 md:shrink-0 md:h-full"
    )}>
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">Templates</p>
          <div className="flex items-center gap-1">
            {mobileOpen && (
              <button
                onClick={onMobileClose}
                className="md:hidden p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
                aria-label="Close templates"
              >
                <X size={16} />
              </button>
            )}
            {/* Collapse to strip — desktop only */}
            {!mobileOpen && (
              <button
                onClick={toggleLib}
                title="Collapse sidebar"
                className="hidden md:inline-flex p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
              >
                <PanelLeftClose size={15} />
              </button>
            )}
            <button
              onClick={onNewTemplate}
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Plus size={13} />
              New
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-surface-2 text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>

        {/* Sport filter tabs */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveSport(null)}
            className={cn(
              "px-2 py-0.5 text-xs rounded-full transition-colors",
              !activeSport ? "bg-accent/15 text-accent" : "text-muted hover:text-primary"
            )}
          >
            All
          </button>
          {sports.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSport(activeSport === s.id ? null : s.id)}
              className={cn(
                "px-2 py-0.5 text-xs rounded-full transition-colors",
                activeSport === s.id ? "text-white" : "text-muted hover:text-primary"
              )}
              style={activeSport === s.id ? { backgroundColor: s.color } : undefined}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {grouped.size === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-muted">No templates yet.</p>
            <button onClick={onNewTemplate} className="mt-2 text-xs text-accent hover:underline">
              Create your first template
            </button>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([sport, ts]) => (
            <div key={sport}>
              <button
                onClick={() => toggleCollapseSport(sport)}
                className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-medium text-muted hover:text-primary transition-colors"
              >
                {collapsedSports.has(sport) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {sport}
                <span className="ml-auto text-muted">{ts.length}</span>
              </button>

              {!collapsedSports.has(sport) && (
                <div className="space-y-1 ml-1">
                  {ts.map(t => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onAddToDate={mobileOpen && onMobileSelectTemplate ? onMobileSelectTemplate : onAddToDate}
                      onDelete={onDeleteTemplate}
                      onEdit={onEditTemplate}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
