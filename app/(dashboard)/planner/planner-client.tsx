"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TemplateLibrary } from "@/components/planner/TemplateLibrary";
import { PlannerCalendar } from "@/components/planner/PlannerCalendar";
import { WorkoutBuilder, type BuilderData } from "@/components/planner/WorkoutBuilder";
import { OutcomeModal } from "@/components/planner/OutcomeModal";
import { WorkoutEditModal } from "@/components/planner/WorkoutEditModal";
import { BlockBanner } from "@/components/planner/BlockBanner";
import { BlockEditorModal } from "@/components/planner/BlockEditorModal";
import type {
  SportCategory, WorkoutTemplate, PlannedWorkout, TrainingBlock,
} from "@/lib/planner/types";

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

  const [templates, setTemplates] = useState(props.templates);
  const [workouts, setWorkouts]   = useState(props.workouts);
  const [blocks, setBlocks]       = useState(props.blocks);

  // Modals
  const [builderDate, setBuilderDate]           = useState<string | null>(null);
  const [showBuilder, setShowBuilder]           = useState(false);
  const [editingTemplate, setEditingTemplate]   = useState<WorkoutTemplate | null>(null);
  const [statusWorkout, setStatusWorkout]       = useState<PlannedWorkout | null>(null);
  const [editWorkout, setEditWorkout]           = useState<PlannedWorkout | null>(null);
  const [editingBlock, setEditingBlock]         = useState<TrainingBlock | null>(null);
  const [showNewBlock, setShowNewBlock]         = useState(false);

  const today = new Date().toISOString().split("T")[0];

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
      targetDuration: template.estimatedDuration,
      targetDistance: template.estimatedDistance,
      color: template.color ?? template.sport.color,
    });
  }

  // ── Create workout via API ─────────────────────────────────────────
  async function createWorkout(data: Record<string, unknown>) {
    const res = await fetch("/api/planner/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return;
    const w: PlannedWorkout = await res.json();
    setWorkouts(prev => [...prev, w].sort((a, b) => a.date.localeCompare(b.date)));
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

  // ── Update existing template ───────────────────────────────────────
  async function handleTemplateUpdate(data: BuilderData) {
    if (!editingTemplate) return;
    setEditingTemplate(null);
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
    }
    startTransition(() => router.refresh());
  }

  // ── Save workout from builder ──────────────────────────────────────
  async function handleBuilderSave(data: BuilderData) {
    setShowBuilder(false);

    let templateId: string | null = null;

    if (data.saveAsTemplate) {
      // Create template first
      const sport = props.sports.find(s => s.id === data.sportId);
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
      const sport = props.sports.find(s => s.id === data.sportId);
      if (!sport) {
        console.error("Sport not found for id:", data.sportId);
        return;
      }
      await createWorkout({
        date: data.date,
        name: data.name,
        sportType: sport.name,
        templateId,
        notes: data.description || null,
        color: data.color,
      });
    }

    startTransition(() => router.refresh());
  }

  // ── Delete template ────────────────────────────────────────────────
  async function handleDeleteTemplate(id: string) {
    const res = await fetch(`/api/planner/templates/${id}`, { method: "DELETE" });
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== id));
  }

  // ── Status save (past workouts) ────────────────────────────────────
  async function handleOutcomeSave(
    id: string, status: string, missedReason?: string, missedNote?: string
  ) {
    const res = await fetch(`/api/planner/workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, missedReason: missedReason ?? null, missedNote: missedNote ?? null }),
    });
    if (res.ok) {
      const updated: PlannedWorkout = await res.json();
      setWorkouts(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    }
    setStatusWorkout(null);
  }

  // ── Edit save (future workouts) ────────────────────────────────────
  async function handleEditSave(id: string, patch: Partial<PlannedWorkout>) {
    const res = await fetch(`/api/planner/workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated: PlannedWorkout = await res.json();
      setWorkouts(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    }
    setEditWorkout(null);
  }

  // ── Delete workout ─────────────────────────────────────────────────
  async function handleDeleteWorkout(id: string) {
    await fetch(`/api/planner/workouts/${id}`, { method: "DELETE" });
    setWorkouts(prev => prev.filter(w => w.id !== id));
  }

  // ── Block CRUD ─────────────────────────────────────────────────────
  async function handleBlockSave(data: Partial<TrainingBlock>) {
    if (editingBlock) {
      const res = await fetch(`/api/planner/blocks/${editingBlock.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated: TrainingBlock = await res.json();
        setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
      }
    } else {
      const res = await fetch("/api/planner/blocks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const created: TrainingBlock = await res.json();
        setBlocks(prev => [...prev, created].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      }
    }
    setEditingBlock(null); setShowNewBlock(false);
    startTransition(() => router.refresh());
  }

  async function handleBlockDelete() {
    if (!editingBlock) return;
    await fetch(`/api/planner/blocks/${editingBlock.id}`, { method: "DELETE" });
    setBlocks(prev => prev.filter(b => b.id !== editingBlock.id));
    setEditingBlock(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Block banner — race markers added manually as blockType="race" */}
      <BlockBanner
        blocks={blocks}
        onNewBlock={() => setShowNewBlock(true)}
        onEditBlock={b => setEditingBlock(b)}
      />

      {/* Main two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Template library sidebar */}
        <TemplateLibrary
          templates={templates}
          sports={props.sports}
          onAddToDate={id => handleAddTemplateToDate(id)}
          onDeleteTemplate={handleDeleteTemplate}
          onNewTemplate={() => openBuilder()}
          onEditTemplate={t => setEditingTemplate(t)}
        />

        {/* Calendar */}
        <div className="flex-1 p-4 overflow-auto">
          <PlannerCalendar
            workouts={workouts}
            blocks={props.blocks}
            onDayClick={date => openBuilder(date)}
            onWorkoutClick={handleWorkoutClick}
            onTemplateDrop={(templateId, date) => handleAddTemplateToDate(templateId, date)}
            onWorkoutMove={handleMoveWorkout}
            weekRunActivities={props.weekRunActivities ?? []}
          />
        </div>
      </div>

      {/* Workout builder — create new */}
      {showBuilder && (
        <WorkoutBuilder
          sports={props.sports}
          paceZones={props.paceZoneRanges}
          hrZones={props.hrZoneRanges}
          initialDate={builderDate ?? undefined}
          onSave={handleBuilderSave}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* Workout builder — edit existing template */}
      {editingTemplate && (
        <WorkoutBuilder
          sports={props.sports}
          paceZones={props.paceZoneRanges}
          hrZones={props.hrZoneRanges}
          editTemplate={editingTemplate}
          onSave={handleTemplateUpdate}
          onCancel={() => setEditingTemplate(null)}
        />
      )}

      {/* Status modal — past workouts only */}
      {statusWorkout && (
        <OutcomeModal
          workout={statusWorkout}
          onClose={() => setStatusWorkout(null)}
          onSave={handleOutcomeSave}
          onDelete={id => { handleDeleteWorkout(id); setStatusWorkout(null); }}
        />
      )}

      {/* Edit modal — future workouts only */}
      {editWorkout && (
        <WorkoutEditModal
          workout={editWorkout}
          onClose={() => setEditWorkout(null)}
          onSave={handleEditSave}
          onDelete={handleDeleteWorkout}
        />
      )}

      {/* Block editor — new or edit */}
      {(showNewBlock || editingBlock) && (
        <BlockEditorModal
          initial={editingBlock ?? undefined}
          onSave={handleBlockSave}
          onDelete={editingBlock ? handleBlockDelete : undefined}
          onClose={() => { setShowNewBlock(false); setEditingBlock(null); }}
        />
      )}
    </div>
  );
}
