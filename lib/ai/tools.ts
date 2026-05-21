/**
 * AI Coach tool definitions and executor.
 * Tools let the AI create/read planned workouts and update the athlete profile.
 *
 * Both Claude (tools array) and Gemini (functionDeclarations) use these.
 * The executor runs server-side; results are returned to the AI as tool_result.
 */

import { prisma } from "@/lib/db/prisma";
import { addDays, subDays, format, differenceInDays } from "date-fns";

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
    name: "get_activities_in_range",
    description:
      `Fetch ALL individual activities in a date range with full detail (pace, HR, splits, description).
IMPORTANT: Before calling with confirmed=true, you MUST warn the user about token cost:
  1. First call with confirmed=false → returns activity count and estimated cost
  2. Show the warning to user and wait for explicit confirmation
  3. Only then call again with confirmed=true
Never skip the cost warning. Do NOT use for short questions — use search_activities instead.`,
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Start date YYYY-MM-DD (required)" },
        date_to:   { type: "string", description: "End date YYYY-MM-DD (required)" },
        sport:     { type: "string", description: "Filter by sport (optional)" },
        confirmed: { type: "boolean", description: "false = return cost estimate only; true = fetch full data (requires prior user confirmation)" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "analyze_full_history",
    description:
      "Fetch aggregated training statistics across the athlete's full multi-year history for deep analysis. Use ONLY when the athlete explicitly asks to analyze their full training history, career trends, or multi-year patterns (e.g. 'analyze my training over the last 3 years', 'what are my long-term trends'). This fetches large amounts of data — do not use for routine questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        years:  { type: "number",  description: "How many years of history to fetch (default 3, max 5)" },
        sport:  { type: "string",  description: "Filter by sport (optional, e.g. 'Run')" },
        focus:  { type: "string",  description: "What to focus on: 'volume' | 'intensity' | 'performance' | 'all' (default 'all')" },
      },
    },
  },
  {
    name: "get_fitness_summary",
    description:
      "Get the athlete's current fitness metrics: VO2max, VDOT, CTL (fitness), ATL (fatigue), TSB (form), ACWR, HR zones, and race time predictions. Use this at the start of a coaching conversation or when the athlete asks about their fitness level.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_race_history",
    description:
      "Get all the athlete's personal bests (PBs) grouped by distance with dates. Use this when the athlete asks about their race times, PBs, or when you need to know their racing history for predictions.",
    input_schema: {
      type: "object" as const,
      properties: {
        distance: { type: "string", description: "Filter by distance label e.g. '5K', '10K', 'Half Marathon' (optional)" },
      },
    },
  },
  {
    name: "get_readiness",
    description:
      "Get today's readiness data: HRV trend (last 7 nights), sleep quality, resting HR, Body Battery, and TSB. Use when athlete asks how they're recovering or whether to train hard today.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_training_blocks",
    description:
      "Get current and upcoming training blocks (Base/Build/Peak/Taper) with targets and progress. Use when discussing periodization, race prep, or training structure.",
    input_schema: { type: "object" as const, properties: {} },
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

// Tools that modify the database — require user approval before execution
export const WRITE_TOOLS = new Set(["create_workout", "delete_workout", "update_profile"]);

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

      case "get_fitness_summary": {
        const fc = await prisma.fitnessCache.findUnique({
          where: { userId },
          select: { vo2max: true, vdot: true, confidence: true, ctl: true, atl: true, tsb: true, acwr: true, maxHR: true, restHR: true, zones: true, predictionsJson: true, computedAt: true },
        });
        if (!fc) return { success: true, message: "Fitness summary", data: "No fitness data cached yet. Sync Strava to generate." };
        type Pred = { label: string; peak: number };
        const preds = fc.predictionsJson as Pred[] | null;
        const predStr = preds ? preds.slice(0, 5).map(p => `  ${p.label}: ${Math.floor(p.peak/60)}:${String(p.peak%60).padStart(2,"0")}`).join("\n") : "none";
        const data = [
          `VO2max: ${fc.vo2max.toFixed(1)} ml/kg/min (${fc.confidence} confidence, VDOT ${fc.vdot.toFixed(1)})`,
          `CTL (fitness): ${fc.ctl?.toFixed(1) ?? "?"}  ATL (fatigue): ${fc.atl?.toFixed(1) ?? "?"}  TSB (form): ${fc.tsb?.toFixed(1) ?? "?"}`,
          `ACWR: ${fc.acwr?.toFixed(2) ?? "?"}  Max HR: ${fc.maxHR} bpm  Rest HR: ${fc.restHR} bpm`,
          `Race predictions:\n${predStr}`,
          `Computed: ${fc.computedAt ? format(fc.computedAt, "d MMM yyyy HH:mm") : "unknown"}`,
        ].join("\n");
        return { success: true, message: "Fitness summary hämtad", data };
      }

      case "get_race_history": {
        const distFilter = input.distance as string | undefined;
        const recs = await prisma.raceRecord.findMany({
          where: {
            userId,
            ...(distFilter ? { distance: { contains: distFilter, mode: "insensitive" } } : {}),
          },
          orderBy: [{ distanceM: "asc" }, { date: "desc" }],
          select: { distance: true, distanceM: true, time: true, date: true, eventName: true },
        });
        if (recs.length === 0) return { success: true, message: "Inga PBs", data: "No race records found." };
        // Group by distance
        const byDist = new Map<string, typeof recs>();
        for (const r of recs) {
          if (!byDist.has(r.distance)) byDist.set(r.distance, []);
          byDist.get(r.distance)!.push(r);
        }
        const lines: string[] = [];
        for (const [dist, rs] of byDist) {
          type RR = { distance: string; distanceM: number; time: number; date: Date; eventName: string | null };
          const pb = (rs as RR[]).reduce((a, b) => a.time < b.time ? a : b);
          const mm = Math.floor(pb.time / 60), ss = pb.time % 60;
          lines.push(`${dist}: PB ${mm}:${String(ss).padStart(2,"0")} (${format(pb.date, "d MMM yyyy")}${pb.eventName ? " · " + pb.eventName : ""}) — ${rs.length} results`);
        }
        return { success: true, message: `${recs.length} tävlingsresultat`, data: lines.join("\n") };
      }

      case "get_readiness": {
        const [garmin, fc] = await Promise.all([
          prisma.garminDailySummary.findMany({
            where: { userId, date: { gte: subDays(new Date(), 7) } },
            orderBy: { date: "asc" },
            select: { date: true, restingHR: true, hrvNightly: true, hrvBalance: true, sleepScore: true, sleepDuration: true, bodyBattery: true },
          }),
          prisma.fitnessCache.findUnique({ where: { userId }, select: { tsb: true, atl: true, acwr: true } }),
        ]);
        const lines: string[] = [];
        if (garmin.length > 0) {
          type GDay = { date: Date; restingHR: number | null; hrvNightly: number | null; hrvBalance: string | null; sleepScore: number | null; sleepDuration: number | null; bodyBattery: number | null };
          const hrv = (garmin as GDay[]).map(g => g.hrvNightly).filter(Boolean);
          if (hrv.length > 0) lines.push(`HRV (${hrv.length}d): ${hrv.map(v => Math.round(v!)).join(" → ")} ms`);
          const latest = (garmin as GDay[]).at(-1);
          if (latest) {
            if (latest.restingHR) lines.push(`Resting HR today: ${latest.restingHR} bpm`);
            if (latest.sleepScore) lines.push(`Sleep score last night: ${latest.sleepScore}/100${latest.sleepDuration ? ` · ${(latest.sleepDuration / 3600).toFixed(1)}h` : ""}`);
            if (latest.bodyBattery) lines.push(`Body Battery: ${latest.bodyBattery}/100`);
            if (latest.hrvBalance) lines.push(`HRV status: ${latest.hrvBalance}`);
          }
        } else {
          lines.push("No Garmin data available.");
        }
        if (fc) {
          lines.push(`TSB (form): ${fc.tsb?.toFixed(1) ?? "?"}  ATL: ${fc.atl?.toFixed(1) ?? "?"}  ACWR: ${fc.acwr?.toFixed(2) ?? "?"}`);
        }
        return { success: true, message: "Readiness data", data: lines.join("\n") || "No readiness data." };
      }

      case "get_training_blocks": {
        const blocks = await prisma.trainingBlock.findMany({
          where: { userId },
          orderBy: { startDate: "asc" },
          select: { id: true, name: true, blockType: true, startDate: true, endDate: true, targetKmPerWeek: true, targetIntensity: true, archived: true, actualKm: true },
        });
        if (blocks.length === 0) return { success: true, message: "Inga träningsblock", data: "No training blocks defined." };
        const now = new Date();
        type Block = { id: string; name: string; blockType: string; startDate: Date; endDate: Date; targetKmPerWeek: number | null; targetIntensity: string | null; archived: boolean; actualKm: number | null };
        const lines = (blocks as Block[]).map(b => {
          const status = b.archived ? "archived" : b.startDate <= now && b.endDate >= now ? "CURRENT" : b.startDate > now ? "upcoming" : "past";
          const kmTarget = b.targetKmPerWeek ? ` target ${b.targetKmPerWeek}km/w` : "";
          const actual = b.actualKm ? ` actual ${Math.round(b.actualKm)}km` : "";
          return `[${status}] ${b.name} (${b.blockType}) ${format(b.startDate, "d MMM")}–${format(b.endDate, "d MMM")}${kmTarget}${actual}`;
        });
        return { success: true, message: "Träningsblock", data: lines.join("\n") };
      }

      case "get_activities_in_range": {
        const dateFrom = new Date(input.date_from as string);
        const dateTo   = new Date(input.date_to as string);
        const sport    = input.sport as string | undefined;
        const confirmed = (input.confirmed as boolean) ?? false;

        if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime()))
          return { success: false, message: "Ogiltigt datum.", data: "error: invalid date" };

        // Count activities for cost estimate
        const count = await prisma.activity.count({
          where: {
            userId,
            startDate: { gte: dateFrom, lte: dateTo },
            ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}),
          },
        });

        if (!confirmed) {
          const estTokens = count * 200; // ~200 tokens per activity with full detail
          const claudeCost = (estTokens / 1_000_000 * 3.0).toFixed(4);
          const msg = `⚠️ Kostnadsvarning: Perioden ${format(dateFrom,"d MMM yyyy")}–${format(dateTo,"d MMM yyyy")} innehåller **${count} aktiviteter** ≈ ${estTokens.toLocaleString()} tokens ≈ $${claudeCost} (Claude) / gratis (Gemini). Vill du fortsätta? Svara "ja" för att bekräfta.`;
          return { success: true, message: `${count} aktiviteter hittades — bekräftelse krävs`, data: msg };
        }

        if (count > 500)
          return { success: false, message: `${count} aktiviteter — för stort. Begränsa till max 500 (≈3 månader).`, data: "error: too many activities" };

        const acts = await prisma.activity.findMany({
          where: {
            userId,
            startDate: { gte: dateFrom, lte: dateTo },
            ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}),
          },
          orderBy: { startDate: "asc" },
          select: {
            name: true, sportType: true, startDate: true, isRace: true,
            distance: true, movingTime: true, averageSpeed: true, maxSpeed: true,
            averageHeartrate: true, maxHeartrate: true, averageCadence: true,
            totalElevationGain: true, weatherTemp: true, weatherWind: true,
            sufferScore: true, perceivedExertion: true, description: true,
            splitsMetric: true,
          },
        });

        if (acts.length === 0)
          return { success: true, message: "Inga aktiviteter", data: "No activities in this period." };

        type Act = typeof acts[number];
        const lines: string[] = [];
        for (const a of acts as Act[]) {
          const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][a.startDate.getDay()];
          const dateStr = `${format(a.startDate, "yyyy-MM-dd")} ${dow}`;
          const pace = a.averageSpeed && a.movingTime > 0 ? Math.round(1000 / a.averageSpeed) : null;
          const maxPace = a.maxSpeed && a.maxSpeed > 0 ? Math.round(1000 / a.maxSpeed) : null;
          const formatPace = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
          const distKm = (a.distance / 1000).toFixed(1);
          const timeStr = `${Math.floor(a.movingTime/60)}:${String(a.movingTime%60).padStart(2,"0")}`;
          const elev = a.totalElevationGain > 5 ? ` · ${Math.round(a.totalElevationGain)}m elev` : "";
          const gap = a.totalElevationGain > 5 && a.distance > 0 && pace
            ? Math.round(pace / (1 + Math.min(0.15, a.totalElevationGain / a.distance) * 0.033))
            : null;

          lines.push(`[${dateStr}] ${a.name}${a.isRace ? " 🏆" : ""} — ${a.sportType}`);
          lines.push(`  Distans: ${distKm} km · Tid: ${timeStr}${pace ? ` · Tempo: ${formatPace(pace)}/km` : ""}${maxPace ? ` · Max: ${formatPace(maxPace)}/km` : ""}${gap && gap !== pace ? ` · GAP: ${formatPace(gap)}/km` : ""}`);
          if (a.averageHeartrate) {
            const hrRes = a.maxHeartrate ? ` / max ${Math.round(a.maxHeartrate)} bpm` : "";
            lines.push(`  HR: avg ${Math.round(a.averageHeartrate)} bpm${hrRes}`);
          }
          if (a.averageCadence) lines.push(`  Kadens: ${Math.round(a.averageCadence * 2)} spm`);
          if (elev) lines.push(`  Höjd: ${Math.round(a.totalElevationGain)} m${a.weatherTemp != null ? ` · Väder: ${Math.round(a.weatherTemp)}°C${a.weatherWind ? ` ${Math.round(a.weatherWind)}km/h` : ""}` : ""}`);
          if (a.sufferScore) lines.push(`  Suffer: ${a.sufferScore}${a.perceivedExertion ? ` · RPE: ${a.perceivedExertion}/10` : ""}`);

          // Splits per km
          if (a.splitsMetric && Array.isArray(a.splitsMetric)) {
            type Split = { split: number; average_speed: number; average_heartrate?: number };
            const splits = (a.splitsMetric as Split[]).filter(s => s.average_speed > 0).slice(0, 20);
            if (splits.length > 1) {
              const splitStr = splits.map(s => {
                const sp = Math.round(1000 / s.average_speed);
                const hr = s.average_heartrate ? `/${Math.round(s.average_heartrate)}` : "";
                return `km${s.split} ${formatPace(sp)}${hr}`;
              }).join(" · ");
              lines.push(`  Splits: ${splitStr}`);
            }
          }

          if (a.description) lines.push(`  Beskrivning: "${a.description}"`);
          lines.push("");
        }

        return { success: true, message: `${acts.length} aktiviteter hämtade`, data: lines.join("\n") };
      }

      case "analyze_full_history": {
        const years   = Math.min(5, Math.max(1, (input.years as number) ?? 3));
        const sport   = input.sport as string | undefined;
        const focus   = (input.focus as string) ?? "all";
        const since   = subDays(new Date(), years * 365);

        const acts = await prisma.activity.findMany({
          where: {
            userId, startDate: { gte: since },
            ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}),
          },
          select: {
            sportType: true, startDate: true, distance: true, movingTime: true,
            averageHeartrate: true, maxHeartrate: true, isRace: true, name: true,
            totalElevationGain: true,
          },
          orderBy: { startDate: "asc" },
        });

        if (acts.length === 0) return { success: true, message: "Ingen data", data: "No activities found in this period." };

        // Monthly aggregates
        const byMonth = new Map<string, { km: number; timeSec: number; count: number; maxHR: number }>();
        for (const a of acts) {
          const key = `${a.startDate.getFullYear()}-${String(a.startDate.getMonth()+1).padStart(2,"0")}`;
          if (!byMonth.has(key)) byMonth.set(key, { km: 0, timeSec: 0, count: 0, maxHR: 0 });
          const m = byMonth.get(key)!;
          m.km += (a.distance as number) / 1000;
          m.timeSec += (a.movingTime as number);
          m.count++;
          if (a.maxHeartrate && (a.maxHeartrate as number) > m.maxHR) m.maxHR = a.maxHeartrate as number;
        }

        // Yearly summary
        const byYear = new Map<number, { km: number; count: number; races: number }>();
        for (const a of acts) {
          const yr = a.startDate.getFullYear();
          if (!byYear.has(yr)) byYear.set(yr, { km: 0, count: 0, races: 0 });
          const y = byYear.get(yr)!;
          y.km += a.distance / 1000; y.count++;
          if (a.isRace) y.races++;
        }

        const lines: string[] = [
          `Full history analysis: ${acts.length} activities over ${years} years`,
          "",
          "=== Yearly summary ===",
          ...[...byYear.entries()].sort(([a],[b])=>(a as number)-(b as number)).map(([yr, d]) =>
            `${yr}: ${Math.round(d.km)}km · ${d.count} sessions · ${d.races} races`),
          "",
          "=== Monthly volume (recent 18 months) ===",
          ...[...byMonth.entries()].sort(([a],[b])=>(a as string).localeCompare(b as string)).slice(-18).map(([mo, d]) =>
            `${mo}: ${Math.round(d.km)}km · ${d.count} sessions · ${Math.round(d.timeSec/3600)}h`),
          "",
          `Total: ${Math.round(acts.reduce((s: number, act: { distance: number }) => s + act.distance/1000, 0))}km · ${acts.length} sessions`,
        ];

        return { success: true, message: `${years}år historikanalys — ${acts.length} aktiviteter`, data: lines.join("\n") };
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
