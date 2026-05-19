"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TemplateLibrary } from "@/components/planner/TemplateLibrary";
import { PlannerCalendar } from "@/components/planner/PlannerCalendar";
import { WorkoutBuilder, type BuilderData } from "@/components/planner/WorkoutBuilder";
import { OutcomeModal } from "@/components/planner/OutcomeModal";
import { WorkoutEditModal } from "@/components/planner/WorkoutEditModal";
import { BlockBanner } from "@/components/planner/BlockBanner";
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
}

export function PlannerClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [templates, setTemplates] = useState(props.templates);
  const [workouts, setWorkouts] = useState(props.workouts);

  // Modals
  const [builderDate, setBuilderDate]   = useState<string | null>(null);
  const [showBuilder, setShowBuilder]   = useState(false);
  const [statusWorkout, setStatusWorkout] = useState<PlannedWorkout | null>(null);  // past → status
  const [editWorkout, setEditWorkout]   = useState<PlannedWorkout | null>(null);    // future → edit

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
  function handleAddTemplateToDate(templateId: string) {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    const date = builderDate ?? new Date().toISOString().slice(0, 10);
    createWorkout({
      date,
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

  return (
    <div className="flex flex-col h-full">
      {/* Block banner */}
      <BlockBanner
        blocks={props.blocks}
        onNewBlock={() => openBuilder()}
        onBlockClick={() => {}}
      />

      {/* Main two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Template library sidebar */}
        <TemplateLibrary
          templates={templates}
          sports={props.sports}
          onAddToDate={id => {
            const template = templates.find(t => t.id === id);
            if (!template) return;
            const date = prompt("Add to date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
            if (!date) return;
            createWorkout({
              date,
              name: template.name,
              sportType: template.sport.name,
              templateId: id,
              targetDuration: template.estimatedDuration,
              targetDistance: template.estimatedDistance,
              color: template.color ?? template.sport.color,
            });
          }}
          onDeleteTemplate={handleDeleteTemplate}
          onNewTemplate={() => openBuilder()}
        />

        {/* Calendar */}
        <div className="flex-1 p-4 overflow-auto">
          <PlannerCalendar
            workouts={workouts}
            blocks={props.blocks}
            onDayClick={date => openBuilder(date)}
            onWorkoutClick={handleWorkoutClick}
          />
        </div>
      </div>

      {/* Workout builder modal */}
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

      {/* Status modal — past workouts only */}
      {statusWorkout && (
        <OutcomeModal
          workout={statusWorkout}
          onClose={() => setStatusWorkout(null)}
          onSave={handleOutcomeSave}
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
    </div>
  );
}
