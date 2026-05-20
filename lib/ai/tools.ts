/**
 * AI Coach tool definitions and executor.
 * Tools let the AI create/read planned workouts and update the athlete profile.
 *
 * Both Claude (tools array) and Gemini (functionDeclarations) use these.
 * The executor runs server-side; results are returned to the AI as tool_result.
 */

import { prisma } from "@/lib/db/prisma";
import { addDays, subDays, format } from "date-fns";

// ── Tool schema (Claude format — converted to Gemini format in the Gemini client) ──

export const COACH_TOOLS = [
  {
    name: "create_workout",
    description:
      "Add a planned workout session to the training calendar. Use this when the athlete asks to schedule training.",
    input_schema: {
      type: "object" as const,
      properties: {
        date:              { type: "string", description: "Date in YYYY-MM-DD format" },
        name:              { type: "string", description: "Workout name, e.g. 'Lätt löpning 8km' or 'Tröskelintervaller'" },
        sportType:         { type: "string", description: "Sport: Run | Cycling | NordicSki | RollerSki | WeightTraining | Other" },
        targetDurationMin: { type: "number", description: "Target duration in minutes (optional)" },
        targetDistanceKm:  { type: "number", description: "Target distance in km (optional)" },
        targetIntensity:   { type: "string", description: "Intensity: Easy | Moderate | Hard | Race (optional)" },
        notes:             { type: "string", description: "Additional notes, workout description, or instructions (optional)" },
      },
      required: ["date", "name", "sportType"],
    },
  },
  {
    name: "get_upcoming_plan",
    description: "Fetch the athlete's upcoming planned workouts. Use this to check what's already scheduled before adding new sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "How many days ahead to fetch (default: 14, max: 60)" },
      },
    },
  },
  {
    name: "delete_workout",
    description: "Remove a planned workout from the calendar. Use only when the athlete explicitly asks to cancel or remove a session.",
    input_schema: {
      type: "object" as const,
      properties: {
        workoutId: { type: "string", description: "The ID of the workout to delete" },
      },
      required: ["workoutId"],
    },
  },
  {
    name: "update_profile",
    description: "Update the athlete's profile data. Use when the athlete states new goals, reports weight changes, or updates training history.",
    input_schema: {
      type: "object" as const,
      properties: {
        primaryGoal:    { type: "string", description: "Primary training goal, e.g. 'sub-38 10K', 'orienteering elite'" },
        yearsTraining:  { type: "number", description: "Years of structured training" },
        weightKg:       { type: "number", description: "Body weight in kg" },
      },
    },
  },
  {
    name: "search_activities",
    description:
      "Search the athlete's training history by keyword, date range, or sport. Use this when the athlete asks about a specific session, e.g. 'my last Tisdagsbana', 'runs in April', 'that long run last weekend'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query:      { type: "string",  description: "Keyword to search in activity name or description (optional)" },
        sport:      { type: "string",  description: "Filter by sport: Run | Cycling | NordicSki | etc. (optional)" },
        date_from:  { type: "string",  description: "Start date YYYY-MM-DD (optional, defaults to 365 days ago)" },
        date_to:    { type: "string",  description: "End date YYYY-MM-DD (optional, defaults to today)" },
        limit:      { type: "number",  description: "Max results to return (default 10, max 20)" },
      },
    },
  },
  {
    name: "get_activity_detail",
    description:
      "Get full details of a specific activity including splits per km, laps, best efforts, and complete description. Use after search_activities to get the full picture of a session the athlete asks about.",
    input_schema: {
      type: "object" as const,
      properties: {
        activity_id: { type: "string", description: "Activity ID returned by search_activities" },
      },
      required: ["activity_id"],
    },
  },
] as const;

// Gemini uses "functionDeclarations" with slightly different key names
export function toGeminiTools() {
  return COACH_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  message: string;       // shown in the chat as an action card
  data?: unknown;        // passed back to the AI model as tool_result content
}

export async function executeCoachTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    switch (toolName) {

      case "create_workout": {
        const date = new Date(input.date as string);
        if (isNaN(date.getTime())) return { success: false, message: "Ogiltigt datum.", data: "error: invalid date" };
        const workout = await prisma.plannedWorkout.create({
          data: {
            userId,
            name:            input.name as string,
            sportType:       input.sportType as string,
            date,
            targetDuration:  input.targetDurationMin ? Math.round((input.targetDurationMin as number) * 60) : null,
            targetDistance:  input.targetDistanceKm  ? (input.targetDistanceKm as number) * 1000 : null,
            targetIntensity: input.targetIntensity as string | null ?? null,
            notes:           input.notes as string | null ?? null,
            status:          "planned",
          },
        });
        const dateStr = format(date, "EEE d MMM");
        return {
          success: true,
          message: `Lade till: ${workout.name} · ${dateStr}`,
          data: `Created workout ${workout.id}: "${workout.name}" on ${dateStr}`,
        };
      }

      case "get_upcoming_plan": {
        const days = Math.min(60, Math.max(1, (input.days as number) ?? 14));
        const workouts = await prisma.plannedWorkout.findMany({
          where: {
            userId,
            date:   { gte: new Date(), lte: addDays(new Date(), days) },
            status: "planned",
          },
          orderBy: { date: "asc" },
          select: { id: true, name: true, sportType: true, date: true, targetDistance: true, targetDuration: true, notes: true },
        });
        if (workouts.length === 0) {
          return { success: true, message: `Inga planerade pass de nästa ${days} dagarna.`, data: "No planned workouts." };
        }
        type W = { id: string; name: string; sportType: string; date: Date; targetDistance: number | null; targetDuration: number | null; notes: string | null };
        const list = (workouts as W[]).map(w => {
          const dateStr = format(new Date(w.date), "EEE d MMM");
          const dist = w.targetDistance ? ` ${(w.targetDistance / 1000).toFixed(0)}km` : "";
          const dur  = w.targetDuration ? ` ${Math.round(w.targetDuration / 60)}min` : "";
          return `${dateStr}: ${w.name} (${w.sportType})${dist}${dur} [id:${w.id}]`;
        }).join("\n");
        return { success: true, message: `Plan (${days}d)`, data: list };
      }

      case "delete_workout": {
        const wid = input.workoutId as string;
        const existing = await prisma.plannedWorkout.findUnique({ where: { id: wid }, select: { userId: true, name: true } });
        if (!existing || existing.userId !== userId)
          return { success: false, message: "Pass hittades inte.", data: "error: not found" };
        await prisma.plannedWorkout.delete({ where: { id: wid } });
        return { success: true, message: `Raderade: ${existing.name}`, data: `Deleted workout "${existing.name}"` };
      }

      case "update_profile": {
        const data: Record<string, unknown> = {};
        if (input.primaryGoal   !== undefined) data.primaryGoal   = input.primaryGoal;
        if (input.yearsTraining !== undefined) data.yearsTraining = input.yearsTraining;
        if (input.weightKg      !== undefined) data.weightKg      = input.weightKg;
        if (Object.keys(data).length === 0)
          return { success: false, message: "Inga värden att uppdatera.", data: "error: empty update" };
        await prisma.athleteProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
        const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", ");
        return { success: true, message: `Profil uppdaterad: ${parts}`, data: `Profile updated: ${parts}` };
      }

      case "search_activities": {
        const query    = (input.query as string | undefined)?.trim();
        const sport    = input.sport as string | undefined;
        const dateFrom = input.date_from ? new Date(input.date_from as string) : subDays(new Date(), 365);
        const dateTo   = input.date_to   ? new Date(input.date_to   as string) : new Date();
        const limit    = Math.min(20, Math.max(1, (input.limit as number) ?? 10));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = {
          userId,
          startDate: { gte: dateFrom, lte: dateTo },
        };
        if (sport) where.sportType = { contains: sport, mode: "insensitive" };
        if (query) where.OR = [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ];

        const acts = await prisma.activity.findMany({
          where,
          orderBy: { startDate: "desc" },
          take: limit,
          select: {
            id: true, name: true, sportType: true, startDate: true,
            distance: true, movingTime: true, averageHeartrate: true,
            averageSpeed: true, totalElevationGain: true, isRace: true,
          },
        });

        if (acts.length === 0)
          return { success: true, message: "Inga aktiviteter hittades.", data: "No activities found." };

        type SA = typeof acts[number];
        const lines = (acts as SA[]).map(a => {
          const date = format(a.startDate, "yyyy-MM-dd EEE");
          const dist = a.distance ? `${(a.distance / 1000).toFixed(1)}km` : "";
          const time = a.movingTime ? `${Math.round(a.movingTime / 60)}min` : "";
          const hr = a.averageHeartrate ? ` ${Math.round(a.averageHeartrate)}bpm` : "";
          const pace = a.averageSpeed && /run|trail/i.test(a.sportType)
            ? ` ${Math.floor(1000 / a.averageSpeed / 60)}:${String(Math.round((1000 / a.averageSpeed) % 60)).padStart(2,"0")}/km`
            : "";
          const race = a.isRace ? " [RACE]" : "";
          return `[id:${a.id}] ${date}: ${a.name}${race} — ${dist} ${time}${hr}${pace}`;
        }).join("\n");

        return { success: true, message: `${acts.length} aktiviteter hittades`, data: lines };
      }

      case "get_activity_detail": {
        const actId = input.activity_id as string;
        const act = await prisma.activity.findUnique({
          where: { id: actId },
          select: {
            id: true, userId: true, name: true, description: true, sportType: true,
            startDate: true, distance: true, movingTime: true, elapsedTime: true,
            totalElevationGain: true, averageSpeed: true, maxSpeed: true,
            averageHeartrate: true, maxHeartrate: true, averageCadence: true,
            sufferScore: true, isRace: true, workoutType: true,
            splitsMetric: true, laps: true, bestEfforts: true,
            weatherTemp: true, weatherWind: true,
          },
        });
        if (!act || act.userId !== userId)
          return { success: false, message: "Aktiviteten hittades inte.", data: "error: not found" };

        const lines: string[] = [
          `Activity: ${act.name} (${act.sportType})`,
          `Date: ${format(act.startDate, "EEEE d MMMM yyyy HH:mm")}`,
          `Distance: ${(act.distance / 1000).toFixed(2)} km`,
          `Moving time: ${Math.floor(act.movingTime / 60)}:${String(act.movingTime % 60).padStart(2,"0")}`,
          `Elevation gain: ${Math.round(act.totalElevationGain)} m`,
        ];
        if (act.averageHeartrate) lines.push(`Avg HR: ${Math.round(act.averageHeartrate)} bpm${act.maxHeartrate ? ` (max ${Math.round(act.maxHeartrate)})` : ""}`);
        if (act.averageSpeed && /run|trail/i.test(act.sportType)) {
          const secPerKm = 1000 / act.averageSpeed;
          lines.push(`Avg pace: ${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2,"0")}/km`);
        }
        if (act.averageCadence) lines.push(`Cadence: ${Math.round(act.averageCadence * 2)} spm`);
        if (act.sufferScore) lines.push(`Suffer score: ${act.sufferScore}`);
        if (act.weatherTemp != null) lines.push(`Weather: ${Math.round(act.weatherTemp)}°C${act.weatherWind ? `, ${Math.round(act.weatherWind)} km/h wind` : ""}`);
        if (act.description) lines.push(`\nDescription:\n${act.description}`);

        // Splits (per-km data)
        if (act.splitsMetric && Array.isArray(act.splitsMetric)) {
          type Split = { split: number; distance: number; moving_time: number; average_speed: number; average_heartrate?: number };
          const splits = (act.splitsMetric as Split[]).filter(s => s.moving_time > 0 && s.average_speed > 0);
          if (splits.length > 0) {
            lines.push("\nSplits (per km):");
            splits.forEach(s => {
              const secPerKm = 1000 / s.average_speed;
              const pace = `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2,"0")}/km`;
              const hr = s.average_heartrate ? ` · ${Math.round(s.average_heartrate)}bpm` : "";
              lines.push(`  km ${s.split}: ${pace}${hr}`);
            });
          }
        }

        // Best efforts
        if (act.bestEfforts && Array.isArray(act.bestEfforts)) {
          type BE = { name: string; elapsed_time: number; distance: number };
          const efforts = (act.bestEfforts as BE[]).slice(0, 8);
          if (efforts.length > 0) {
            lines.push("\nBest efforts:");
            efforts.forEach(e => {
              const mm = Math.floor(e.elapsed_time / 60), ss = e.elapsed_time % 60;
              lines.push(`  ${e.name}: ${mm}:${String(ss).padStart(2,"0")}`);
            });
          }
        }

        return { success: true, message: `Aktivitetsdetaljer: ${act.name}`, data: lines.join("\n") };
      }

      default:
        return { success: false, message: `Okänt verktyg: ${toolName}`, data: `error: unknown tool ${toolName}` };
    }
  } catch (e) {
    console.error(`[coach-tool] ${toolName} failed:`, e);
    return { success: false, message: "Verktyget misslyckades.", data: `error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}
