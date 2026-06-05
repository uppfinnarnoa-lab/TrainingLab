"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import type { WorkoutTemplate, SportCategory } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

interface Props {
  templates: WorkoutTemplate[];
  sports: SportCategory[];
  onAddToDate: (templateId: string) => void;
  onDeleteTemplate: (id: string) => void;
  onNewTemplate: () => void;
  onEditTemplate: (template: WorkoutTemplate) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function TemplateLibrary({ templates, sports, onAddToDate, onDeleteTemplate, onNewTemplate, onEditTemplate, mobileOpen, onMobileClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeSport, setActiveSport] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  // Group by sport
  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutTemplate[]>();
    for (const t of filtered) {
      const key = t.sport.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filtered]);

  function toggleCollapse(sport: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(sport)) next.delete(sport);
      else next.add(sport);
      return next;
    });
  }

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
          <div className="flex items-center gap-2">
            {mobileOpen && (
              <button
                onClick={onMobileClose}
                className="md:hidden p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
                aria-label="Close templates"
              >
                <X size={16} />
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
                onClick={() => toggleCollapse(sport)}
                className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-medium text-muted hover:text-primary transition-colors"
              >
                {collapsed.has(sport) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {sport}
                <span className="ml-auto text-muted">{ts.length}</span>
              </button>

              {!collapsed.has(sport) && (
                <div className="space-y-1 ml-1">
                  {ts.map(t => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onAddToDate={onAddToDate}
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
