"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClipboardX } from "lucide-react";
import { format } from "date-fns";
import { TemplateLibrary } from "@/components/planner/TemplateLibrary";
import { PlannerCalendar, type CopiedWorkout } from "@/components/planner/PlannerCalendar";
import { WorkoutBuilder, type BuilderData } from "@/components/planner/WorkoutBuilder";
import { OutcomeModal } from "@/components/planner/OutcomeModal";
import { BlockBanner } from "@/components/planner/BlockBanner";
import { BlockEditorModal } from "@/components/planner/BlockEditorModal";
import type {
  SportCategory, WorkoutTemplate, PlannedWorkout, TrainingBlock,
} from "@/lib/planner/types";
import { STRAVA_SPORT_MAP } from "@/lib/planner/sportTypeMap";

// Normalize Strava/legacy sport type strings to user's sport category names
function normalizeSportType(type: string, sports: SportCategory[]): string {
  if (sports.some(s => s.name === type)) return type;
  const ciMatch = sports.find(s => s.name.toLowerCase() === type.toLowerCase());
  if (ciMatch) return ciMatch.name;
  const alias = STRAVA_SPORT_MAP[type];
  if (alias && sports.some(s => s.name === alias)) return alias;
  return type;
}

interface Props {
  sports: SportCategory[];
  templates: WorkoutTemplate[];
  workouts: PlannedWorkout[];
  blocks: TrainingBlock[];
  hrZoneRanges: [number, number][];
  paceZoneRanges: [number, number][];
  weekRunActivities?: { date: string; distanceM: number }[];
}

export function PlannerClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // One-time backfill: add default section to templates that have none.
  useEffect(() => {
    if (localStorage.getItem("planner_sections_backfilled_v1")) return;
    fetch("/api/planner/backfill-sections", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          localStorage.setItem("planner_sections_backfilled_v1", "1");
          if (data.fixed > 0) startTransition(() => router.refresh());
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time fix: clear stale stored colors for OL planned workouts.
  useEffect(() => {
    if (localStorage.getItem("planner_ol_colors_fixed_v1")) return;
    fetch("/api/planner/fix-ol-colors", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          localStorage.setItem("planner_ol_colors_fixed_v1", "1");
          if ((data.workoutsFixed ?? 0) > 0) startTransition(() => router.refresh());
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time backfill: mark Running/Orienteering sports as running-related.
  useEffect(() => {
    if (localStorage.getItem("planner_running_sports_backfilled_v1")) return;
    fetch("/api/planner/backfill-running-sports", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          localStorage.setItem("planner_running_sports_backfilled_v1", "1");
          if ((data.sportsFixed ?? 0) > 0) startTransition(() => router.refresh());
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time backfill: ensure every sport has a shared "Race" workout type.
  useEffect(() => {
    if (localStorage.getItem("planner_shared_race_type_backfilled_v1")) return;
    fetch("/api/planner/backfill-shared-race-type", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          localStorage.setItem("planner_shared_race_type_backfilled_v1", "1");
          if ((data.sportsFixed ?? 0) > 0) startTransition(() => router.refresh());
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time backfill: recompute stale workout/template colors that were baked in
  // from the static workoutColor() regex instead of the real Settings color.
  useEffect(() => {
    if (localStorage.getItem("planner_workout_colors_backfilled_v1")) return;
    fetch("/api/planner/backfill-workout-colors", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          localStorage.setItem("planner_workout_colors_backfilled_v1", "1");
          if ((data.templatesFixed ?? 0) > 0 || (data.workoutsFixed ?? 0) > 0) startTransition(() => router.refresh());
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [plannerError, setPlannerError] = useState<string | null>(null);
  function showError(msg: string) {
    setPlannerError(msg);
    setTimeout(() => setPlannerError(null), 4000);
  }

  const [sports, setSports]       = useState(props.sports);
  const [templates, setTemplates] = useState(props.templates);
  // Normalize sport types on load so "Run" → "Running" etc.
  const [workouts, setWorkouts]   = useState(() =>
    props.workouts.map(w => ({ ...w, sportType: normalizeSportType(w.sportType, sports) }))
  );
  const [blocks, setBlocks]       = useState(props.blocks);

  // Mobile template library overlay
  const [mobileLibOpen, setMobileLibOpen] = useState(false);
  // When a template is tapped on mobile, the user picks its destination day
  // directly on the calendar (placement mode) instead of drag-dropping.
  const [placingTemplate, setPlacingTemplate] = useState<WorkoutTemplate | null>(null);

  // Copy-paste state
  const [copiedWorkout, setCopiedWorkout] = useState<CopiedWorkout | null>(null);

  // Modals
  const [builderDate, setBuilderDate]           = useState<string | null>(null);
  const [showBuilder, setShowBuilder]           = useState(false);
  const [editingTemplate, setEditingTemplate]   = useState<WorkoutTemplate | null>(null);
  const [statusWorkout, setStatusWorkout]       = useState<PlannedWorkout | null>(null);
  const [editWorkout, setEditWorkout]           = useState<PlannedWorkout | null>(null);
  const [editingBlock, setEditingBlock]         = useState<TrainingBlock | null>(null);
  const [showNewBlock, setShowNewBlock]         = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const editTemplate = useMemo<WorkoutTemplate | null>(() => {
    if (!editWorkout) return null;
    if (editWorkout.template) {
      // The workout may carry its own typeId override distinct from the template's.
      if (editWorkout.typeId !== editWorkout.template.typeId) {
        return { ...editWorkout.template, typeId: editWorkout.typeId, type: editWorkout.type };
      }
      return editWorkout.template;
    }
    const sport = sports.find(s =>
      s.name.toLowerCase() === editWorkout.sportType.toLowerCase()
    ) ?? sports[0];
    return {
      id: editWorkout.id,
      name: editWorkout.name,
      description: editWorkout.notes,
      sportId: sport?.id ?? "",
      typeId: editWorkout.typeId,
      color: editWorkout.color,
      estimatedDuration: editWorkout.targetDuration,
      estimatedDistance: editWorkout.targetDistance,
      estimatedZoneDistribution: null,
      sections: [],
      sport: sport ?? { id: "", name: editWorkout.sportType, color: null, icon: "", order: 0, isRunningRelated: false, workoutTypes: [] },
      type: editWorkout.type,
    };
  }, [editWorkout, sports]);

  function handleWorkoutClick(w: PlannedWorkout) {
    if (w.date > today) {
      setEditWorkout(w);     // future → edit
    } else {
      setStatusWorkout(w);   // past/today → status
    }
  }

  // ── Open builder ────────────────────────────────────────────────────
  function openBuilder(date?: string) {
    setBuilderDate(date ?? null);
    setShowBuilder(true);
  }

  // ── Add template to a date ─────────────────────────────────────────
  function handleAddTemplateToDate(templateId: string, date?: string) {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    const targetDate = date ?? builderDate ?? new Date().toISOString().slice(0, 10);
    createWorkout({
      date: targetDate,
      name: template.name,
      sportType: template.sport.name,
      templateId,
      typeId: template.typeId ?? null,
      targetDuration: template.estimatedDuration,
      targetDistance: template.estimatedDistance,
      color: template.type?.color ?? template.sport.color,
    });
  }

  // ── Create workout via API ─────────────────────────────────────────
  async function createWorkout(data: Record<string, unknown>) {
    const res = await fetch("/api/planner/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) { showError("Failed to save workout — please try again."); return; }
    const w: PlannedWorkout = await res.json();
    const normalized = { ...w, sportType: normalizeSportType(w.sportType, sports) };
    setWorkouts(prev => [...prev, normalized].sort((a, b) => a.date.localeCompare(b.date)));
  }

  // ── Copy / paste workouts ──────────────────────────────────────────
  function handleCopyWorkout(workout: PlannedWorkout) {
    setCopiedWorkout({
      name: workout.name,
      sportType: workout.sportType,
      targetDuration: workout.targetDuration,
      targetDistance: workout.targetDistance,
      notes: workout.notes,
      color: workout.color,
      templateId: workout.templateId,
      typeId: workout.typeId,
    });
  }

  async function handlePasteWorkout(date: string) {
    if (!copiedWorkout) return;
    await createWorkout({
      date,
      name: copiedWorkout.name,
      sportType: copiedWorkout.sportType,
      templateId: copiedWorkout.templateId ?? null,
      typeId: copiedWorkout.typeId ?? null,
      targetDuration: copiedWorkout.targetDuration,
      targetDistance: copiedWorkout.targetDistance,
      notes: copiedWorkout.notes,
      color: copiedWorkout.color,
    });
  }

  // ── Mobile: tap template in overlay → pick destination day on calendar ─────
  function handleMobileTemplateSelect(templateId: string) {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    setMobileLibOpen(false);
    setPlacingTemplate(template);
  }

  // ── Mobile: day tapped while placing a template → add it directly ─────────
  function handlePlaceTemplate(date: string) {
    if (!placingTemplate) return;
    handleAddTemplateToDate(placingTemplate.id, date);
    setPlacingTemplate(null);
  }

  // ── Move workout to another date ──────────────────────────────────
  async function handleMoveWorkout(workoutId: string, newDate: string) {
    const res = await fetch(`/api/planner/workouts/${workoutId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: newDate }),
    });
    if (!res.ok) return;
    setWorkouts(prev => prev.map(w => w.id === workoutId ? { ...w, date: newDate } : w));
  }

  // ── Update existing template — also used as the debounced auto-save while editing ──
  async function handleTemplateAutoSave(data: BuilderData) {
    if (!editingTemplate) return;
    const res = await fetch(`/api/planner/templates/${editingTemplate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name, sportId: data.sportId, typeId: data.typeId,
        description: data.description, color: data.color, sections: data.sections,
      }),
    });
    if (res.ok) {
      const updated: WorkoutTemplate = await res.json();
      setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
    } else {
      showError("Failed to save template changes — please try again.");
    }
  }

  async function handleTemplateUpdate(data: BuilderData) {
    setEditingTemplate(null);
    await handleTemplateAutoSave(data);
    startTransition(() => router.refresh());
  }

  // Revert the template on the server back to how it was when the editor opened.
  async function handleTemplateEditCancel() {
    const snapshot = editingTemplate;
    setEditingTemplate(null);
    if (!snapshot) return;
    await fetch(`/api/planner/templates/${snapshot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: snapshot.name, sportId: snapshot.sportId, typeId: snapshot.typeId,
        description: snapshot.description, color: snapshot.color, sections: snapshot.sections,
      }),
    });
    setTemplates(prev => prev.map(t => t.id === snapshot.id ? snapshot : t));
    startTransition(() => router.refresh());
  }

  // ── Save workout from builder ──────────────────────────────────────
  async function handleBuilderSave(data: BuilderData) {
    let templateId: string | null = null;

    if (data.saveAsTemplate) {
      const res = await fetch("/api/planner/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          sportId: data.sportId,
          typeId: data.typeId,
          description: data.description,
          color: data.color,
          sections: data.sections,
        }),
      });
      if (res.ok) {
        const t: WorkoutTemplate = await res.json();
        templateId = t.id;
        setTemplates(prev => [...prev, t]);
      }
    }

    if (data.date) {
      const sport = sports.find(s => s.id === data.sportId);
      if (!sport) return;
      await createWorkout({
        date: data.date,
        name: data.name,
        sportType: sport.name,
        templateId,
        typeId: data.typeId,
        notes: data.description || null,
        color: data.color,
        targetDuration: data.totalDuration,
        targetDistance: data.totalDistance,
      });
    }

    setShowBuilder(false);
    startTransition(() => router.refresh());
  }

  // ── Delete template ────────────────────────────────────────────────
  async function handleDeleteTemplate(id: string) {
    const res = await fetch(`/api/planner/templates/${id}`, { method: "DELETE" });
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== id));
    else showError("Failed to delete template — please try again.");
  }

  // ── Status save (past workouts) ────────────────────────────────────
  async function handleOutcomeSave(
    id: string, status: string, missedReason?: string, missedNote?: string
  ): Promise<boolean> {
    const res = await fetch(`/api/planner/workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, missedReason: missedReason ?? null, missedNote: missedNote ?? null }),
    });
    if (!res.ok) return false;
    const updated: PlannedWorkout = await res.json();
    setWorkouts(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    setStatusWorkout(null);
    return true;
  }

  // ── Edit save (future workouts via WorkoutBuilder) — also the debounced auto-save ──
  async function handleWorkoutAutoSave(data: BuilderData) {
    if (!editWorkout) return;
    const id = editWorkout.id;
    const sport = sports.find(s => s.id === data.sportId);

    const res = await fetch(`/api/planner/workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        sportType: sport?.name ?? editWorkout.sportType,
        date: data.date ?? editWorkout.date,
        typeId: data.typeId,
        notes: data.description || null,
        color: data.color,
        targetDuration: data.totalDuration,
        targetDistance: data.totalDistance,
      }),
    });
    if (res.ok) {
      const updated: PlannedWorkout = await res.json();
      setWorkouts(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    } else {
      showError("Failed to save workout changes — please try again.");
      return;
    }

    // If the workout has a linked template, update its sections and metadata too
    if (editWorkout.templateId) {
      await fetch(`/api/planner/templates/${editWorkout.templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          sportId: data.sportId,
          typeId: data.typeId,
          description: data.description,
          color: data.color,
          sections: data.sections,
        }),
      });
    }
  }

  async function handleEditBuilderSave(data: BuilderData) {
    setEditWorkout(null);
    await handleWorkoutAutoSave(data);
    startTransition(() => router.refresh());
  }

  // Revert the workout (and its linked template, if any) back to how they
  // were when the editor opened.
  async function handleWorkoutEditCancel() {
    const snapshotWorkout = editWorkout;
    const snapshotTemplate = editTemplate;
    setEditWorkout(null);
    if (!snapshotWorkout) return;

    await fetch(`/api/planner/workouts/${snapshotWorkout.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: snapshotWorkout.name,
        sportType: snapshotWorkout.sportType,
        date: snapshotWorkout.date,
        typeId: snapshotWorkout.typeId,
        notes: snapshotWorkout.notes,
        color: snapshotWorkout.color,
        targetDuration: snapshotWorkout.targetDuration,
        targetDistance: snapshotWorkout.targetDistance,
      }),
    });
    setWorkouts(prev => prev.map(w => w.id === snapshotWorkout.id ? snapshotWorkout : w));

    // Only revert the template if it's a real, persisted one (synthetic
    // ad-hoc "template" objects built in the editTemplate memo below don't
    // exist as actual WorkoutTemplate rows and have nothing to revert).
    if (snapshotWorkout.templateId && snapshotTemplate) {
      await fetch(`/api/planner/templates/${snapshotWorkout.templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: snapshotTemplate.name,
          sportId: snapshotTemplate.sportId,
          typeId: snapshotTemplate.typeId,
          description: snapshotTemplate.description,
          color: snapshotTemplate.color,
          sections: snapshotTemplate.sections,
        }),
      });
    }

    startTransition(() => router.refresh());
  }

  // ── Delete workout ─────────────────────────────────────────────────
  async function handleDeleteWorkout(id: string) {
    const res = await fetch(`/api/planner/workouts/${id}`, { method: "DELETE" });
    if (res.ok) setWorkouts(prev => prev.filter(w => w.id !== id));
    else showError("Failed to delete workout — please try again.");
  }

  // ── Block CRUD ─────────────────────────────────────────────────────
  async function handleBlockSave(data: Partial<TrainingBlock>): Promise<boolean> {
    if (editingBlock) {
      const res = await fetch(`/api/planner/blocks/${editingBlock.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const updated: TrainingBlock = await res.json();
      setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
    } else {
      const res = await fetch("/api/planner/blocks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const created: TrainingBlock = await res.json();
      setBlocks(prev => [...prev, created].sort((a, b) => a.startDate.localeCompare(b.startDate)));
    }
    setEditingBlock(null); setShowNewBlock(false);
    startTransition(() => router.refresh());
    return true;
  }

  async function handleBlockDelete() {
    if (!editingBlock) return;
    const id = editingBlock.id;
    setEditingBlock(null);
    setBlocks(prev => prev.filter(b => b.id !== id));
    await fetch(`/api/planner/blocks/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  // Debounced auto-save while editing an existing block (never fires for a new one).
  async function handleBlockAutoSave(data: Partial<TrainingBlock>) {
    if (!editingBlock) return;
    const res = await fetch(`/api/planner/blocks/${editingBlock.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) { showError("Failed to save block changes — please try again."); return; }
    const updated: TrainingBlock = await res.json();
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
  }

  // Revert the block on the server back to how it was when the editor opened.
  async function handleBlockCancel() {
    const snapshot = editingBlock;
    setEditingBlock(null); setShowNewBlock(false);
    if (!snapshot) return;
    await fetch(`/api/planner/blocks/${snapshot.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: snapshot.name, blockType: snapshot.blockType, color: snapshot.color,
        startDate: snapshot.startDate, endDate: snapshot.endDate, notes: snapshot.notes,
        targetKmPerWeek: snapshot.targetKmPerWeek, targetRaceId: snapshot.targetRaceId,
      }),
    });
    setBlocks(prev => prev.map(b => b.id === snapshot.id ? snapshot : b));
    startTransition(() => router.refresh());
  }

  // Planned workouts of type "Race" — selectable in the block builder's race picker.
  const racePlannedWorkouts = useMemo(() =>
    workouts
      .filter(w => w.type?.name === "Race")
      .map(w => ({ id: w.id, name: w.name, date: w.date }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  [workouts]);

  return (
    <div className="flex flex-col h-full">
      {/* Block banner — race markers added manually as blockType="race" */}
      <BlockBanner
        blocks={blocks}
        onNewBlock={() => setShowNewBlock(true)}
        onEditBlock={b => setEditingBlock(b)}
      />

      {/* Copy mode banner — shows when a workout is copied */}
      {copiedWorkout && (
        <div className="border-b border-accent/30 bg-accent/5 px-4 py-2 flex items-center gap-2.5 shrink-0">
          <ClipboardX size={13} className="text-accent shrink-0" />
          <span className="text-xs text-accent font-medium flex-1">
            &ldquo;{copiedWorkout.name}&rdquo; copied
            <span className="ml-1 text-accent/70">
              <span className="hidden md:inline">— click a day to paste (or right-click for options)</span>
              <span className="md:hidden">— tap a day to paste</span>
            </span>
          </span>
          <button
            onClick={() => setCopiedWorkout(null)}
            className="text-xs text-muted hover:text-primary transition px-1"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error banner */}
      {plannerError && (
        <div className="border-b border-error/30 bg-error/5 px-4 py-2 flex items-center gap-2.5 shrink-0">
          <span className="text-xs text-error font-medium flex-1">{plannerError}</span>
          <button onClick={() => setPlannerError(null)} className="text-xs text-muted hover:text-primary transition px-1">✕</button>
        </div>
      )}

      {/* Main two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Template library sidebar — hidden on mobile, toggle via calendar header button */}
        <TemplateLibrary
          templates={templates}
          sports={sports}
          onAddToDate={id => handleAddTemplateToDate(id)}
          onDeleteTemplate={handleDeleteTemplate}
          onNewTemplate={() => openBuilder()}
          onEditTemplate={t => setEditingTemplate(t)}
          mobileOpen={mobileLibOpen}
          onMobileClose={() => setMobileLibOpen(false)}
          onMobileSelectTemplate={handleMobileTemplateSelect}
        />

        {/* Calendar */}
        <div className="flex-1 p-3 md:p-4 overflow-x-auto">
          <PlannerCalendar
            workouts={workouts}
            blocks={blocks}
            sports={sports}
            onDayClick={date => openBuilder(date)}
            onWorkoutClick={handleWorkoutClick}
            onTemplateDrop={(templateId, date) => handleAddTemplateToDate(templateId, date)}
            onWorkoutMove={handleMoveWorkout}
            weekRunActivities={props.weekRunActivities ?? []}
            onOpenTemplates={() => setMobileLibOpen(true)}
            copiedWorkout={copiedWorkout}
            onCopyWorkout={handleCopyWorkout}
            onPasteWorkout={handlePasteWorkout}
            onClearCopy={() => setCopiedWorkout(null)}
            placingTemplate={placingTemplate}
            onPlaceTemplate={handlePlaceTemplate}
            onCancelPlaceTemplate={() => setPlacingTemplate(null)}
          />
        </div>
      </div>

      {/* Workout builder — create new */}
      {showBuilder && (
        <WorkoutBuilder
          sports={sports}
          paceZones={props.paceZoneRanges}
          hrZones={props.hrZoneRanges}
          initialDate={builderDate ?? undefined}
          onSave={handleBuilderSave}
          onCancel={() => setShowBuilder(false)}
          onSportsUpdated={setSports}
        />
      )}

      {/* Workout builder — edit existing template */}
      {editingTemplate && (
        <WorkoutBuilder
          sports={sports}
          paceZones={props.paceZoneRanges}
          hrZones={props.hrZoneRanges}
          editTemplate={editingTemplate}
          onSave={handleTemplateUpdate}
          onAutoSave={handleTemplateAutoSave}
          onCancel={handleTemplateEditCancel}
          onSportsUpdated={setSports}
        />
      )}

      {/* Status modal — past workouts only */}
      {statusWorkout && (
        <OutcomeModal
          workout={statusWorkout}
          onClose={() => setStatusWorkout(null)}
          onSave={handleOutcomeSave}
          onDelete={id => { handleDeleteWorkout(id); setStatusWorkout(null); }}
          onEdit={w => { setStatusWorkout(null); setEditWorkout(w); }}
        />
      )}

      {/* Workout builder — edit future workout */}
      {editWorkout && editTemplate && (
        <WorkoutBuilder
          sports={sports}
          paceZones={props.paceZoneRanges}
          hrZones={props.hrZoneRanges}
          editTemplate={editTemplate}
          initialDate={editWorkout.date}
          plannedWorkoutMode
          onSave={handleEditBuilderSave}
          onAutoSave={handleWorkoutAutoSave}
          onDelete={() => { handleDeleteWorkout(editWorkout.id); setEditWorkout(null); }}
          onCancel={handleWorkoutEditCancel}
          onSportsUpdated={setSports}
        />
      )}

      {/* Block editor — new or edit */}
      {(showNewBlock || editingBlock) && (
        <BlockEditorModal
          initial={editingBlock ?? undefined}
          racePlannedWorkouts={racePlannedWorkouts}
          onSave={handleBlockSave}
          onAutoSave={handleBlockAutoSave}
          onDelete={editingBlock ? handleBlockDelete : undefined}
          onClose={editingBlock ? handleBlockCancel : () => setShowNewBlock(false)}
        />
      )}
    </div>
  );
}
