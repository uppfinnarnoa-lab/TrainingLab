"use client";

import { useState } from "react";
import { Plus, ChevronDown, ChevronUp, Flag, Pencil } from "lucide-react";
import { format, parseISO, differenceInWeeks } from "date-fns";
import type { TrainingBlock } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

interface Props {
  blocks: TrainingBlock[];
  onNewBlock: () => void;
  onEditBlock: (block: TrainingBlock) => void;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  base: "Base", build: "Build", peak: "Peak", taper: "Taper", custom: "Custom",
};

export function BlockBanner({ blocks, onNewBlock, onEditBlock }: Props) {
  const [open, setOpen] = useState(true);

  // Separate training blocks from race markers
  const trainingBlocks = blocks.filter(b => b.blockType !== "race");
  const raceMarkers    = blocks.filter(b => b.blockType === "race");

  if (blocks.length === 0) {
    return (
      <div className="border-b border-border bg-surface px-4 py-2.5 flex items-center justify-between">
        <button onClick={onNewBlock}
          className="flex items-center gap-1.5 text-xs text-accent hover:underline">
          <Plus size={13} />
          Add your first training block
        </button>
      </div>
    );
  }

  // Unified timeline: training blocks + race markers (blockType="race"), sorted by date
  type TimelineItem =
    | { kind: "block"; block: TrainingBlock }
    | { kind: "race"; block: TrainingBlock };

  const items: TimelineItem[] = [
    ...trainingBlocks.map(b => ({ kind: "block" as const, block: b })),
    ...raceMarkers.map(b => ({ kind: "race" as const, block: b })),
  ].sort((a, b) => a.block.startDate.localeCompare(b.block.startDate));

  return (
    <div className="border-b border-border bg-surface">
      {/* Header bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === "Enter" && setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-surface-2 transition-colors select-none"
      >
        <span className="text-xs font-semibold text-muted uppercase tracking-wide flex-1">
          Training blocks
        </span>
        <button
          onClick={e => { e.stopPropagation(); onNewBlock(); }}
          className="flex items-center gap-1 text-xs text-accent hover:underline px-1"
        >
          <Plus size={12} />
          New block
        </button>
        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
      </div>

      {/* Timeline */}
      {open && (
        <div className="px-4 pb-3 overflow-x-auto">
          <div className="flex items-start gap-2 min-w-max">
            {items.map((item, i) => {
              if (item.kind === "block") {
                const b = item.block;
                const weeks = Math.max(1,
                  differenceInWeeks(parseISO(b.endDate), parseISO(b.startDate)) + 1
                );
                const today = format(new Date(), "yyyy-MM-dd");
                const isPast    = b.endDate < today;
                const isCurrent = b.startDate <= today && b.endDate >= today;

                return (
                  <button
                    key={b.id}
                    onClick={() => onEditBlock(b)}
                    className={cn(
                      "group flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-md shrink-0",
                      isPast ? "opacity-60" : "",
                      isCurrent ? "ring-1 ring-accent/40" : ""
                    )}
                    style={{
                      borderColor: `${b.color}60`,
                      backgroundColor: `${b.color}12`,
                      minWidth: `${Math.max(120, weeks * 28)}px`,
                    }}
                  >
                    {/* Block header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                        <span className="text-xs font-semibold text-primary">{b.name}</span>
                      </div>
                      <Pencil size={11} className="text-muted opacity-0 group-hover:opacity-100 transition shrink-0" />
                    </div>

                    {/* Type + weeks */}
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      <span className="font-medium uppercase tracking-wide" style={{ color: b.color }}>
                        {BLOCK_TYPE_LABELS[b.blockType] ?? b.blockType}
                      </span>
                      <span>·</span>
                      <span>{weeks}w</span>
                      {b.targetKmPerWeek && <><span>·</span><span>{b.targetKmPerWeek} km/w</span></>}
                    </div>

                    {/* Date range */}
                    <div className="text-[10px] text-muted">
                      {format(parseISO(b.startDate), "d MMM")} – {format(parseISO(b.endDate), "d MMM yyyy")}
                    </div>

                    {/* Focus notes */}
                    {b.notes && (
                      <p className="text-[10px] text-muted line-clamp-1 mt-0.5">{b.notes}</p>
                    )}

                    {/* Actual stats (if archived) */}
                    {b.archived && b.actualKm && (
                      <p className="text-[10px] font-medium mt-0.5" style={{ color: b.color }}>
                        {b.actualKm.toFixed(0)} km achieved
                      </p>
                    )}

                    {/* Current badge */}
                    {isCurrent && (
                      <span className="text-[10px] font-semibold text-accent">← Current</span>
                    )}
                  </button>
                );
              } else {
                // Race marker (blockType="race", single day)
                const r = item.block;
                return (
                  <button
                    key={r.id}
                    onClick={() => onEditBlock(r)}
                    className="group flex flex-col items-center gap-1 shrink-0 px-2 py-2.5 rounded-xl hover:bg-surface-2 transition"
                  >
                    <Flag size={16} className="text-warning" />
                    <span className="text-[10px] font-semibold text-primary max-w-[80px] text-center leading-tight">
                      {r.name}
                    </span>
                    <span className="text-[10px] text-muted">
                      {format(parseISO(r.startDate), "d MMM yyyy")}
                    </span>
                    <Pencil size={10} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                  </button>
                );
              }
            })}
          </div>
        </div>
      )}
    </div>
  );
}
