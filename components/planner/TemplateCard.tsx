"use client";

import { Clock, Ruler, Plus, Trash2, Pencil } from "lucide-react";
import { ZoneBar } from "./ZoneBar";
import { formatDuration, formatDistance } from "@/lib/utils";
import type { WorkoutTemplate } from "@/lib/planner/types";
import { workoutColor } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

interface Props {
  template: WorkoutTemplate;
  onAddToDate?: (templateId: string) => void;
  onDelete?: (templateId: string) => void;
  onEdit?: (template: WorkoutTemplate) => void;
  compact?: boolean;
}

export function TemplateCard({ template, onAddToDate, onDelete, onEdit, compact }: Props) {
  // Always derive color from sport + type so new type-based colors apply automatically
  const color = workoutColor(template.sport.name, template.type?.name ?? null);

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("templateId", template.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "group rounded-xl bg-surface border border-border p-3 space-y-2 hover:border-accent/40 transition-colors cursor-grab active:cursor-grabbing",
        compact && "p-2 space-y-1.5"
      )}
      style={{ borderLeftWidth: 5, borderLeftColor: color }}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-primary truncate">{template.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${template.sport.color}20`, color: template.sport.color }}
            >
              {template.sport.name}
            </span>
            {template.type && (
              <span className="text-xs text-muted">{template.type.name}</span>
            )}
          </div>
        </div>

        {/* Actions — always visible on mobile (hover unavailable on touch).
            onPointerDown stop-propagation prevents the draggable card from
            intercepting the touch before the button click fires. */}
        <div className="shrink-0 flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(template); }}
              onPointerDown={e => e.stopPropagation()}
              className="p-2 rounded-lg hover:bg-surface-2 text-muted hover:text-primary transition-colors"
              title="Edit template"
            >
              <Pencil size={13} />
            </button>
          )}
          {onAddToDate && (
            <button
              onClick={e => { e.stopPropagation(); onAddToDate(template.id); }}
              onPointerDown={e => e.stopPropagation()}
              className="p-2 rounded-lg hover:bg-accent/10 text-muted hover:text-accent transition-colors"
              title="Add to plan"
            >
              <Plus size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(template.id); }}
              onPointerDown={e => e.stopPropagation()}
              className="p-2 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors"
              title="Delete template"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {(template.estimatedDuration || template.estimatedDistance) && (
        <div className="flex items-center gap-3 text-xs text-muted">
          {template.estimatedDuration && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatDuration(template.estimatedDuration)}
            </span>
          )}
          {template.estimatedDistance && (
            <span className="flex items-center gap-1">
              <Ruler size={11} />
              {formatDistance(template.estimatedDistance)}
            </span>
          )}
          <span className="text-muted">{template.sections.length} sections</span>
        </div>
      )}

      {/* Zone bar */}
      {template.estimatedZoneDistribution && (
        <ZoneBar distribution={template.estimatedZoneDistribution} height={3} />
      )}
    </div>
  );
}
