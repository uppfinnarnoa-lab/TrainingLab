"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, AlignJustify, PanelLeft, CalendarRange, Calendar, LayoutTemplate, Copy, ClipboardPaste, Plus, MoveRight, X } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  addMonths, subMonths, subWeeks, addWeeks,
} from "date-fns";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { WorkoutPill } from "./WorkoutPill";
import { WeekSummaryStrip } from "./WeekSummaryStrip";
import type { PlannedWorkout, TrainingBlock, SportCategory, WorkoutTemplate } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

type SummaryLayout = "row" | "sidebar";
type CalendarMode = "month" | "rolling";
const PREF_KEY = "planner_summary_layout";
const MODE_KEY = "planner_calendar_mode";

export interface CopiedWorkout {
  name: string;
  sportType: string;
  targetDuration: number | null;
  targetDistance: number | null;
  notes: string | null;
  color: string | null;
  templateId: string | null;
  typeId: string | null;
}

interface ContextMenuState {
  type: "workout" | "day";
  x: number; y: number;
  workout?: PlannedWorkout;
  date?: string;
}

// ── dnd-kit droppable day cell wrapper ──────────────────────────────────────
// Renders a zero-footprint wrapper that registers the drop zone with dnd-kit.
function DroppableDay({ dateStr, children }: {
  dateStr: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: dateStr });
  return (
    <div ref={setNodeRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

// ── dnd-kit draggable workout pill wrapper ───────────────────────────────────
function DraggableWorkout({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging && "opacity-40")}
    >
      {children}
    </div>
  );
}

interface Props {
  workouts: PlannedWorkout[];
  blocks: TrainingBlock[];
  sports: SportCategory[];
  onDayClick: (date: string) => void;
  onWorkoutClick: (workout: PlannedWorkout) => void;
  onTemplateDrop?: (templateId: string, date: string) => void;
  onWorkoutMove?: (workoutId: string, newDate: string) => void;
  weekRunActivities?: { date: string; distanceM: number }[];
  onOpenTemplates?: () => void;
  copiedWorkout?: CopiedWorkout | null;
  onPasteWorkout?: (date: string) => void;
  onCopyWorkout?: (workout: PlannedWorkout) => void;
  onClearCopy?: () => void;
  placingTemplate?: WorkoutTemplate | null;
  onPlaceTemplate?: (date: string) => void;
  onCancelPlaceTemplate?: () => void;
  onWeekClick?: (weekStart: Date, weekWorkouts: PlannedWorkout[]) => void;
}

function FloatingMenu({ items, x, y, onClose }: {
  items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean }[];
  x: number; y: number; onClose: () => void;
}) {
  if (items.length === 0) { onClose(); return null; }
  const safeTop  = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - items.length * 40 - 16);
  const safeLeft = Math.min(x, (typeof window !== "undefined" ? window.innerWidth  : 1200) - 200);
  return (
    <>
      <div className="fixed inset-0 z-[9990]" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-[9991] min-w-[168px] rounded-xl bg-surface border border-border shadow-xl py-1 overflow-hidden"
        style={{ top: safeTop, left: safeLeft }}
      >
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-surface-2 transition-colors",
              item.danger ? "text-error" : "text-primary"
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function PlannerCalendar({
  workouts, blocks, sports, onDayClick, onWorkoutClick, onTemplateDrop, onWorkoutMove,
  weekRunActivities = [], onOpenTemplates,
  copiedWorkout, onPasteWorkout, onCopyWorkout, onClearCopy,
  placingTemplate, onPlaceTemplate, onCancelPlaceTemplate,
  onWeekClick,
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [summaryLayout, setSummaryLayout] = useState<SummaryLayout>("row");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moveWorkout, setMoveWorkout] = useState<PlannedWorkout | null>(null);

  // dnd-kit: track which workout is being dragged (for DragOverlay)
  const [dndActiveWorkout, setDndActiveWorkout] = useState<PlannedWorkout | null>(null);
  // dnd-kit: track which day is being hovered during drag
  const [dndOverDate, setDndOverDate] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
  );

  function handleDndDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const w = workouts.find(x => x.id === id);
    setDndActiveWorkout(w ?? null);
  }

  function handleDndDragOver(event: DragOverEvent) {
    setDndOverDate(event.over ? (event.over.id as string) : null);
  }

  function handleDndDragEnd(event: DragEndEvent) {
    setDndActiveWorkout(null);
    setDndOverDate(null);
    const { active, over } = event;
    if (!over) return;
    const workoutId = active.id as string;
    const targetDate = over.id as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return;
    const w = workouts.find(x => x.id === workoutId);
    if (w && w.date === targetDate) return; // no-op if same day
    onWorkoutMove?.(workoutId, targetDate);
  }

  // Refs for keyboard shortcuts — avoid stale closures
  const lastContextWorkout = useRef<PlannedWorkout | null>(null);
  const hoveredDateRef     = useRef<string | null>(null);
  const copiedRef          = useRef(copiedWorkout);
  useEffect(() => { copiedRef.current = copiedWorkout; }, [copiedWorkout]);

  // Keyboard shortcuts: Ctrl/Cmd+C to copy last right-clicked workout,
  // Ctrl/Cmd+V to paste to hovered day, Escape to clear copy mode
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

      if (e.key === "Escape") { setContextMenu(null); onClearCopy?.(); return; }

      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        const w = lastContextWorkout.current;
        if (w) { onCopyWorkout?.(w); e.preventDefault(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        const d = hoveredDateRef.current;
        if (copiedRef.current && d && onPasteWorkout) { onPasteWorkout(d); e.preventDefault(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCopyWorkout, onPasteWorkout, onClearCopy]);

  // Persist preferences
  useEffect(() => {
    const saved = localStorage.getItem(PREF_KEY) as SummaryLayout | null;
    if (saved === "sidebar" || saved === "row") setSummaryLayout(saved);
    const savedMode = localStorage.getItem(MODE_KEY) as CalendarMode | null;
    if (savedMode === "month" || savedMode === "rolling") setCalendarMode(savedMode);
  }, []);

  function toggleLayout() {
    const next: SummaryLayout = summaryLayout === "row" ? "sidebar" : "row";
    setSummaryLayout(next);
    localStorage.setItem(PREF_KEY, next);
  }

  function toggleMode() {
    const next: CalendarMode = calendarMode === "month" ? "rolling" : "month";
    setCalendarMode(next);
    localStorage.setItem(MODE_KEY, next);
  }

  const days = useMemo(() => {
    if (calendarMode === "rolling") {
      const now = new Date();
      const start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const end   = endOfWeek(addWeeks(now, 2), { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    }
    const monthStart = startOfMonth(currentMonth);
    const monthEnd   = endOfMonth(currentMonth);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end:   endOfWeek(monthEnd,   { weekStartsOn: 1 }),
    });
  }, [calendarMode, currentMonth]);

  const byDate = useMemo(() => {
    const map = new Map<string, PlannedWorkout[]>();
    for (const w of workouts) {
      const key = w.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return map;
  }, [workouts]);

  const blockByDate = useMemo(() => {
    const map = new Map<string, TrainingBlock>();
    for (const b of blocks) {
      if (b.archived) continue;
      const start  = new Date(b.startDate + "T00:00:00");
      const end    = new Date(b.endDate   + "T00:00:00");
      const cursor = new Date(start);
      while (cursor <= end) {
        map.set(format(cursor, "yyyy-MM-dd"), b);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [blocks]);

  function blockForDate(date: Date): TrainingBlock | undefined {
    return blockByDate.get(format(date, "yyyy-MM-dd"));
  }

  const weeks = useMemo(() => {
    const ws: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) ws.push(days.slice(i, i + 7));
    return ws;
  }, [days]);

  const today = format(new Date(), "yyyy-MM-dd");

  // ── Feature 5D: taper start markers ──────────────────────────────────────
  // Build a Set of dates where taper starts (N weeks before a future race).
  function taperWeeks(raceName: string, targetDuration?: number | null): number {
    const n = raceName.toLowerCase();
    if (/marathon|42/.test(n)) return 3;
    if (/half|21/.test(n)) return 2;
    if (/10k|10\./.test(n)) return 1;
    return targetDuration && targetDuration > 60 * 60 ? 2 : 1;
  }

  const taperDates = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const w of workouts) {
      if (w.date <= today) continue; // only future races
      const isRace =
        w.type?.name === "Race" ||
        /race|tävling/i.test(w.name);
      if (!isRace) continue;
      const raceDate = new Date(w.date + "T00:00:00");
      const weeks = taperWeeks(w.name, w.targetDuration);
      const taperDate = new Date(raceDate);
      taperDate.setDate(taperDate.getDate() - weeks * 7);
      set.add(format(taperDate, "yyyy-MM-dd"));
    }
    return set;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts, today]);

  const rollingLabel = useMemo(() => {
    if (calendarMode !== "rolling") return null;
    const first = days[0];
    const last  = days[days.length - 1];
    const sameMonth = format(first, "M") === format(last, "M");
    return sameMonth
      ? `${format(first, "d")}–${format(last, "d MMM")}`
      : `${format(first, "d MMM")} – ${format(last, "d MMM")}`;
  }, [calendarMode, days]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDndDragStart}
      onDragOver={handleDndDragOver}
      onDragEnd={handleDndDragEnd}
    >
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header / navigation */}
      <div className="flex items-center justify-between px-1 pb-3">
        {calendarMode === "month" ? (
          <button onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
            <ChevronLeft size={18} />
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="text-xs text-muted">Rolling</span>
          </div>
        )}

        <h2 className="text-base font-semibold text-primary">
          {calendarMode === "rolling" ? rollingLabel : format(currentMonth, "MMMM yyyy")}
        </h2>

        <div className="flex items-center gap-1">
          {/* Mobile: open template library overlay */}
          {onOpenTemplates && (
            <button
              onClick={onOpenTemplates}
              className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted hover:text-primary hover:bg-surface-2 transition"
            >
              <LayoutTemplate size={14} />
              Templates
            </button>
          )}
          {/* Rolling / month mode toggle */}
          <button
            onClick={toggleMode}
            title={calendarMode === "month" ? "Switch to rolling 4-week view" : "Switch to month view"}
            className={cn(
              "p-1.5 rounded-lg transition",
              calendarMode === "rolling"
                ? "text-accent bg-accent/10"
                : "text-muted hover:text-primary hover:bg-surface-2"
            )}
          >
            {calendarMode === "rolling" ? <CalendarRange size={16} /> : <Calendar size={16} />}
          </button>
          {/* Layout toggle — desktop only */}
          <button
            onClick={toggleLayout}
            title={summaryLayout === "row" ? "Switch to sidebar view" : "Switch to row view"}
            className="hidden md:inline-flex p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
          >
            {summaryLayout === "row" ? <PanelLeft size={16} /> : <AlignJustify size={16} />}
          </button>
          {calendarMode === "month" && (
            <button onClick={() => setCurrentMonth(m => addMonths(m, 1))}
              className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition">
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Move mode banner */}
      {moveWorkout && (
        <div className="flex items-center gap-2.5 mb-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
          <MoveRight size={13} className="shrink-0" />
          <span className="flex-1 font-medium">Moving &ldquo;{moveWorkout.name}&rdquo; — tap a day to move here</span>
          <button onClick={() => setMoveWorkout(null)} className="text-muted hover:text-primary transition">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Template placement mode banner (mobile "+" on a template) */}
      {placingTemplate && (
        <div className="flex items-center gap-2.5 mb-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
          <Plus size={13} className="shrink-0" />
          <span className="flex-1 font-medium">Placing &ldquo;{placingTemplate.name}&rdquo; — tap a day to add it here</span>
          <button onClick={onCancelPlaceTemplate} className="text-muted hover:text-primary transition">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Weekday headers — always 7 columns on mobile, sidebar mode only on md+.
          Sidebar mode uses minmax(140px,1fr) per day so columns are wide enough
          to read workout names; the container scrolls horizontally if needed. */}
      <div
        className="mb-1 gap-x-1 grid grid-cols-7"
        style={summaryLayout === "sidebar"
          ? { gridTemplateColumns: "120px repeat(7, minmax(140px, 1fr))" }
          : undefined}
      >
        {summaryLayout === "sidebar" && <div className="hidden md:block" />}
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-2">
        {weeks.map((week, wi) => {
          const weekStart    = week[0];
          const weekWorkouts = week.flatMap(d => byDate.get(format(d, "yyyy-MM-dd")) ?? []);
          const weekBlock    = blockForDate(weekStart);
          const isSidebar    = summaryLayout === "sidebar";

          const rollingWeekLabel = (() => {
            if (calendarMode !== "rolling") return null;
            const now = new Date();
            const thisWeekStart = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
            const wk = format(weekStart, "yyyy-MM-dd");
            if (wk === format(startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }), "yyyy-MM-dd")) return "Last week";
            if (wk === thisWeekStart) return "This week";
            if (wk === format(startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }), "yyyy-MM-dd")) return "Next week";
            return "In 2 weeks";
          })();

          return (
            <div key={wi}>
              <div
                className="gap-x-1 grid grid-cols-7"
                style={isSidebar
                  ? { gridTemplateColumns: "120px repeat(7, minmax(140px, 1fr))" }
                  : undefined}
              >
                {/* Rolling week label spans all columns so the line reaches the full grid width */}
                {rollingWeekLabel && (
                  <div
                    className="flex items-center gap-2 px-1 pt-1 pb-0.5"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <span className={cn(
                      "text-xs font-semibold",
                      rollingWeekLabel === "This week" ? "text-accent" : "text-muted"
                    )}>
                      {rollingWeekLabel}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {/* Sidebar summary column — hidden on mobile, overflow-hidden to clip content */}
                {isSidebar && (
                  <div className="hidden md:flex items-stretch overflow-hidden min-w-0">
                    {weekWorkouts.length > 0 ? (
                      <WeekSummaryStrip
                        weekStart={weekStart}
                        workouts={weekWorkouts}
                        block={weekBlock}
                        sports={sports}
                        compact
                        onClick={onWeekClick ? () => onWeekClick(weekStart, weekWorkouts) : undefined}
                      />
                    ) : <div className="w-full" />}
                  </div>
                )}

                {/* Day cells */}
                {week.map(day => {
                  const key          = format(day, "yyyy-MM-dd");
                  const dayWorkouts  = byDate.get(key) ?? [];
                  const isCurrentMonth = calendarMode === "rolling" || isSameMonth(day, currentMonth);
                  const isPast       = key <= today;
                  const blockHere    = blockForDate(day);
                  const isDragOver   = dragOverDate === key || dndOverDate === key;
                  const isPasteMode  = !!copiedWorkout;
                  const isMoveMode   = !!moveWorkout;
                  const isPlaceMode  = !!placingTemplate;
                  const isTaperStart = taperDates.has(key);

                  return (
                    <DroppableDay key={key} dateStr={key}>
                    <div
                      onClick={() => {
                        if (dndActiveWorkout) return; // dnd-kit drag in progress, ignore click
                        if (isPlaceMode && onPlaceTemplate) { onPlaceTemplate(key); }
                        else if (moveWorkout && onWorkoutMove) { onWorkoutMove(moveWorkout.id, key); setMoveWorkout(null); }
                        else if (isPasteMode && onPasteWorkout) { onPasteWorkout(key); }
                        else { onDayClick(key); }
                      }}
                      onMouseEnter={() => { hoveredDateRef.current = key; }}
                      onMouseLeave={() => { hoveredDateRef.current = null; }}
                      onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ type: "day", x: e.clientX, y: e.clientY, date: key });
                      }}
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverDate(key); }}
                      onDragLeave={() => setDragOverDate(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverDate(null);
                        const templateId = e.dataTransfer.getData("templateId");
                        if (templateId && onTemplateDrop) onTemplateDrop(templateId, key);
                      }}
                      className={cn(
                        "min-h-[70px] md:min-h-[88px] rounded-xl p-1 md:p-1.5 cursor-pointer border transition-colors overflow-hidden",
                        isDragOver
                          ? "border-accent bg-accent/10"
                          : isPasteMode || isMoveMode || isPlaceMode
                          ? "border-accent/30 hover:border-accent hover:bg-accent/5"
                          : isToday(day)
                          ? "border-accent/50 bg-accent/5"
                          : "border-transparent hover:border-border hover:bg-surface",
                        !isCurrentMonth && "opacity-35"
                      )}
                      style={blockHere && !isDragOver && !isPasteMode ? {
                        backgroundColor: `${blockHere.color}22`,
                        borderLeftColor: blockHere.color,
                        borderLeftWidth: "3px",
                        borderLeftStyle: "solid",
                      } : undefined}
                    >
                      {/* Day number — shows paste icon in paste mode on hover */}
                      <div className="mb-1 flex items-center justify-between">
                        <span className={cn(
                          "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full",
                          isToday(day) ? "bg-accent text-white" : isPast ? "text-muted" : "text-primary"
                        )}>
                          {format(day, "d")}
                        </span>
                        {isPlaceMode && (
                          <Plus size={10} className="text-accent/50 shrink-0" />
                        )}
                        {!isPlaceMode && isMoveMode && (
                          <MoveRight size={10} className="text-accent/50 shrink-0" />
                        )}
                        {!isPlaceMode && !isMoveMode && isPasteMode && (
                          <ClipboardPaste size={10} className="text-accent/50 shrink-0" />
                        )}
                      </div>

                      {/* Feature 5D: taper start marker */}
                      {isTaperStart && (
                        <div className="text-[9px] font-semibold text-warning/70 leading-tight mb-0.5">
                          ⚡ Taper start
                        </div>
                      )}

                      {/* Workouts — show up to 5, compact when >3 */}
                      <div className="space-y-0.5">
                        {dayWorkouts.slice(0, 5).map(w => (
                          <DraggableWorkout key={w.id} id={w.id}>
                            <WorkoutPill
                              workout={w}
                              isPast={isPast}
                              onClick={onWorkoutClick}
                              compact={dayWorkouts.length > 3}
                              inMoveMode={!!moveWorkout}
                              onContextMenu={(e, workout) => {
                                e.preventDefault();
                                e.stopPropagation();
                                lastContextWorkout.current = workout;
                                setContextMenu({ type: "workout", x: e.clientX, y: e.clientY, workout });
                              }}
                              onLongPressMenu={(workout, x, y) => {
                                lastContextWorkout.current = workout;
                                setContextMenu({ type: "workout", x, y, workout });
                              }}
                            />
                          </DraggableWorkout>
                        ))}
                        {dayWorkouts.length > 5 && (
                          <p className="text-xs text-muted pl-1">+{dayWorkouts.length - 5}</p>
                        )}
                      </div>
                    </div>
                    </DroppableDay>
                  );
                })}
              </div>

              {/* Row mode: full-width summary below */}
              {!isSidebar && weekWorkouts.length > 0 && (
                <WeekSummaryStrip
                  weekStart={weekStart}
                  workouts={weekWorkouts}
                  block={weekBlock}
                  sports={sports}
                  weekRunActivities={weekRunActivities}
                  onClick={onWeekClick ? () => onWeekClick(weekStart, weekWorkouts) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* DragOverlay — renders a ghost pill while dragging via dnd-kit (touch) */}
      <DragOverlay>
        {dndActiveWorkout ? (
          <div className="opacity-80 pointer-events-none">
            <WorkoutPill
              workout={dndActiveWorkout}
              isPast={dndActiveWorkout.date <= today}
              onClick={() => {}}
              inMoveMode={false}
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* Floating context menu */}
      {contextMenu && (
        <FloatingMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.type === "workout" && contextMenu.workout
              ? [
                  {
                    label: "Copy  Ctrl+C",
                    icon: <Copy size={14} />,
                    onClick: () => {
                      lastContextWorkout.current = contextMenu.workout!;
                      onCopyWorkout?.(contextMenu.workout!);
                    },
                  },
                  {
                    label: "Move to…",
                    icon: <MoveRight size={14} />,
                    onClick: () => { setMoveWorkout(contextMenu.workout!); },
                  },
                ]
              : contextMenu.type === "day" && contextMenu.date
              ? [
                  ...(copiedWorkout
                    ? [{
                        label: `Paste "${copiedWorkout.name}"  Ctrl+V`,
                        icon: <ClipboardPaste size={14} />,
                        onClick: () => onPasteWorkout?.(contextMenu.date!),
                      }]
                    : []),
                  {
                    label: "Add workout",
                    icon: <Plus size={14} />,
                    onClick: () => onDayClick(contextMenu.date!),
                  },
                ]
              : []
          }
        />
      )}
    </div>
    </DndContext>
  );
}
