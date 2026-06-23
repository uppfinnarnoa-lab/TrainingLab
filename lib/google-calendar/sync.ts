// Planner → Google Calendar one-way sync. See docs/integrations/google-calendar.md.
import { prisma } from "@/lib/db/prisma";
import { googleCalendarFetch, GoogleCalendarNotFoundError } from "./client";

interface SectionForDescription {
  order: number;
  name: string;
  durationType: string;
  duration: number | null;
  distance: number | null;
  repetitions: number | null;
  targetZone: number | null;
  restDurationType: string | null;
  restDuration: number | null;
  restDistance: number | null;
  restTargetZone: number | null;
}

export interface WorkoutForEvent {
  id: string;
  name: string;
  sportType: string;
  date: Date;
  notes: string | null;
  status: string;
  googleEventId: string | null;
  template?: { sections: SectionForDescription[] } | null;
}

function formatSection(s: SectionForDescription): string {
  const reps = s.repetitions && s.repetitions > 1 ? `${s.repetitions}× ` : "";
  const amount = s.durationType === "time" && s.duration
    ? `${Math.round(s.duration / 60)}min`
    : s.durationType === "distance" && s.distance
    ? `${(s.distance / 1000).toFixed(1)}km`
    : "";
  const zone = s.targetZone ? ` Z${s.targetZone}` : "";
  let rest = "";
  if (s.restDurationType) {
    const restAmount = s.restDurationType === "time" && s.restDuration
      ? `${s.restDuration}s`
      : s.restDurationType === "distance" && s.restDistance
      ? `${s.restDistance}m`
      : "";
    rest = ` + ${restAmount}${s.restTargetZone ? ` Z${s.restTargetZone}` : ""} rest`;
  }
  const summary = `${reps}${amount}${zone}${rest}`.trim();
  return summary ? `${s.name}: ${summary}` : s.name;
}

function buildTitle(w: WorkoutForEvent): string {
  if (w.status === "completed") return `✓ ${w.name}`;
  if (w.status === "missed") return `✗ ${w.name}`;
  return w.name;
}

function buildDescription(w: WorkoutForEvent): string {
  const parts: string[] = [w.sportType];
  if (w.notes) parts.push(w.notes);
  if (w.template?.sections?.length) {
    parts.push(w.template.sections.slice().sort((a, b) => a.order - b.order).map(formatSection).join("\n"));
  }
  parts.push("— Synced from TrainingLab");
  return parts.join("\n\n");
}

// Google all-day events use an EXCLUSIVE end date — a one-day event on 2026-06-24
// needs end.date = "2026-06-25" (the day after), not the same day.
function toAllDayRange(date: Date): { start: string; end: string } {
  const start = date.toISOString().slice(0, 10);
  const end = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

function buildEventBody(w: WorkoutForEvent) {
  const { start, end } = toAllDayRange(w.date);
  return {
    summary: buildTitle(w),
    description: buildDescription(w),
    start: { date: start },
    end: { date: end },
  };
}

async function getActiveAccount(userId: string) {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId } });
  if (!account || account.needsReconnect) return null;
  return account;
}

export async function createEvent(userId: string, workout: WorkoutForEvent): Promise<string | null> {
  const account = await getActiveAccount(userId);
  if (!account) return null;

  const created = await googleCalendarFetch(
    userId,
    `/calendars/${encodeURIComponent(account.calendarId)}/events`,
    { method: "POST", body: JSON.stringify(buildEventBody(workout)) },
  ) as { id: string };

  await Promise.all([
    prisma.plannedWorkout.update({ where: { id: workout.id }, data: { googleEventId: created.id } }),
    prisma.googleCalendarAccount.update({ where: { userId }, data: { lastSyncAt: new Date() } }),
  ]);
  return created.id;
}

export async function updateEvent(userId: string, workout: WorkoutForEvent): Promise<void> {
  if (!workout.googleEventId) { await createEvent(userId, workout); return; }
  const account = await getActiveAccount(userId);
  if (!account) return;

  try {
    await googleCalendarFetch(
      userId,
      `/calendars/${encodeURIComponent(account.calendarId)}/events/${workout.googleEventId}`,
      { method: "PATCH", body: JSON.stringify(buildEventBody(workout)) },
    );
    await prisma.googleCalendarAccount.update({ where: { userId }, data: { lastSyncAt: new Date() } });
  } catch (e) {
    if (!(e instanceof GoogleCalendarNotFoundError)) throw e;
    // Event was deleted on Google's side — clear the stale link and recreate it.
    await prisma.plannedWorkout.update({ where: { id: workout.id }, data: { googleEventId: null } });
    await createEvent(userId, { ...workout, googleEventId: null });
  }
}

export async function deleteEvent(userId: string, googleEventId: string): Promise<void> {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId } });
  if (!account) return;
  try {
    await googleCalendarFetch(
      userId,
      `/calendars/${encodeURIComponent(account.calendarId)}/events/${googleEventId}`,
      { method: "DELETE" },
    );
  } catch (e) {
    if (!(e instanceof GoogleCalendarNotFoundError)) throw e; // already gone — fine
  }
}

/**
 * Explicit, user-initiated backfill — pushes every future PlannedWorkout that
 * doesn't have a googleEventId yet. Never touches past workouts.
 */
export async function pushUpcomingWorkouts(userId: string): Promise<{ pushed: number; errors: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const workouts = await prisma.plannedWorkout.findMany({
    where: { userId, googleEventId: null, date: { gte: new Date(today) } },
    include: { template: { include: { sections: { orderBy: { order: "asc" } } } } },
  });

  let pushed = 0, errors = 0;
  for (const w of workouts) {
    try {
      const id = await createEvent(userId, w);
      if (id) pushed++;
    } catch (e) {
      console.error("[google-calendar] pushUpcomingWorkouts failed for", w.id, e);
      errors++;
    }
  }
  return { pushed, errors };
}
