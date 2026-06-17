import { prisma } from "@/lib/db/prisma";
import { safeDecrypt } from "@/lib/encrypt";
import { addDays, subDays, format, startOfWeek } from "date-fns";

// Tool calls run inline in the chat request — an unresponsive external API (Tavily, Open-Meteo,
// PubMed, Strava) would otherwise hang the whole conversation with no feedback to the user.
function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 12000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

// ── Tool definitions ───────────────────────────────────────────────────────────
// Descriptions say WHAT each tool returns, not WHEN to call it.
// The model decides autonomously which tools to call and in what order.

export const COACH_TOOLS = [
  // ── Activity tools ──────────────────────────────────────────────────────────
  {
    name: "search_activities",
    description: "Search the athlete's Strava activity history. Returns activities matching keyword, date range, and/or sport type with distance, moving time, pace, HR, elevation. Supports sorting by date (most recent first).",
    input_schema: {
      type: "object" as const,
      properties: {
        query:     { type: "string",  description: "Keyword to match in activity name or description (optional)" },
        sport:     { type: "string",  description: "Sport filter: Run | Cycling | NordicSki | RollerSki | WeightTraining | etc. (optional)" },
        date_from: { type: "string",  description: "Start date YYYY-MM-DD (optional, default 365 days ago)" },
        date_to:   { type: "string",  description: "End date YYYY-MM-DD (optional, default today)" },
        limit:     { type: "number",  description: "Max results (default 10, max 30)" },
        is_race:   { type: "boolean", description: "Filter to race activities only (optional)" },
      },
    },
  },
  {
    name: "get_activity_detail",
    description: "Returns full detail of one activity: km splits with pace and HR per km, lap data, best efforts (fastest 1K/5K/10K in the run), weather, description, cadence, suffer score, training load, intensity factor.",
    input_schema: {
      type: "object" as const,
      properties: {
        activity_id: { type: "string", description: "Activity ID from search_activities" },
      },
      required: ["activity_id"],
    },
  },
  {
    name: "get_activity_stream",
    description: "Returns second-by-second training data for one activity: heart rate curve, pace curve, altitude profile, cadence, power (if available). Data is aggregated into zone breakdowns, HR drift analysis, and key moments (peak HR, fastest km, worst km). Use for deep physiological analysis of a specific session.",
    input_schema: {
      type: "object" as const,
      properties: {
        activity_id: { type: "string", description: "Activity ID" },
        focus: { type: "string", description: "Analysis focus: 'hr' | 'pace' | 'power' | 'all' (default 'all')" },
      },
      required: ["activity_id"],
    },
  },
  {
    name: "get_activities_in_range",
    description: "Returns ALL activities in a date range with full detail per session (pace, HR, splits, description, elevation, weather). First call with confirmed=false returns activity count + token cost estimate. Only fetch with confirmed=true after showing the user the cost warning.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string",  description: "Start date YYYY-MM-DD" },
        date_to:   { type: "string",  description: "End date YYYY-MM-DD" },
        sport:     { type: "string",  description: "Sport filter (optional)" },
        confirmed: { type: "boolean", description: "false=return cost estimate only; true=fetch full data" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "analyze_full_history",
    description: "Returns aggregated training statistics across the athlete's full multi-year history: yearly totals (km, sessions, races), monthly volume for the last 18 months, and sport-specific breakdowns. Use for long-term trend analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        years: { type: "number", description: "Years of history (default 3, max 5)" },
        sport: { type: "string", description: "Sport filter (optional)" },
        focus: { type: "string", description: "'volume' | 'intensity' | 'performance' | 'all' (default 'all')" },
      },
    },
  },
  {
    name: "get_segment_history",
    description: "Returns the athlete's personal effort history on a specific Strava segment — all their times with date, duration, and rank. Use when the athlete asks how their performance on a recurring route or segment has changed over time.",
    input_schema: {
      type: "object" as const,
      properties: {
        segment_id: { type: "string", description: "Strava segment ID (find it from activity detail or athlete mentions)" },
        limit:      { type: "number", description: "Max efforts to return (default 10)" },
      },
      required: ["segment_id"],
    },
  },

  // ── Fitness & metrics tools ─────────────────────────────────────────────────
  {
    name: "get_fitness_summary",
    description: "Returns all computed fitness metrics from the database: VO2max with model breakdown and VDOT trend over time, CTL/ATL/TSB history, ACWR, all 5 HR zone boundaries (exact bpm), complete race time predictions for every distance, Seiler polarization index (Z1%/Z2%/Z3%), critical speed, W' anaerobic capacity, and aerobic decoupling LT1 estimate.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_volume_stats",
    description: "Returns weekly training volume for up to 52 weeks: km, time (hours), TSS, and session count broken down by sport per week. Data comes from precomputed cache — fast to retrieve.",
    input_schema: {
      type: "object" as const,
      properties: {
        weeks: { type: "number", description: "How many weeks back (default 12, max 52)" },
        sport: { type: "string", description: "Sport filter (optional)" },
      },
    },
  },
  {
    name: "get_zone_distribution",
    description: "Returns time-in-zone distribution (Z1–Z5) for a period in hours and percentage, plus Seiler 3-zone polarization index. Uses precomputed cache.",
    input_schema: {
      type: "object" as const,
      properties: {
        weeks: { type: "number", description: "Period in weeks (default 12, max 52)" },
        sport: { type: "string", description: "Sport filter (optional)" },
      },
    },
  },

  // ── Garmin / health tools ───────────────────────────────────────────────────
  {
    name: "get_readiness",
    description: "Returns 7-day granular recovery data from Garmin: nightly HRV per day, sleep stages (deep/light/REM/awake in minutes), resting HR per day, body battery, daily average stress, SpO₂, training readiness score (0–100), and step count. Also includes TSB, ATL, and ACWR.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_wellness_history",
    description: "Returns Garmin wellness data day-by-day for a date range: HRV, all sleep stages, resting HR, body battery, stress, SpO₂, steps, and training readiness per day. Use for multi-week health trends, specific nights, or cross-period comparison.",
    input_schema: {
      type: "object" as const,
      properties: {
        days:      { type: "number", description: "Days back from today (default 14, max 90)" },
        date_from: { type: "string", description: "Start date YYYY-MM-DD (overrides days)" },
        date_to:   { type: "string", description: "End date YYYY-MM-DD" },
      },
    },
  },

  // ── Planning tools ──────────────────────────────────────────────────────────
  {
    name: "get_upcoming_plan",
    description: "Returns the athlete's planned training sessions for the next N days: date, name, sport, target distance, target duration, intensity, notes, and completion status.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Days ahead (default 14, max 60)" },
      },
    },
  },
  {
    name: "get_training_blocks",
    description: "Returns all training blocks (Base/Build/Peak/Taper/Custom): name, type, date range, target km/week, intensity focus, actual km completed, TSS, and completion rate. Includes current, upcoming, past, and archived blocks.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_workout_templates",
    description: "Returns all the athlete's saved workout templates with full structure: each template's estimated distance, duration, TSS, and every section (warm-up, intervals, cool-down) with zone, pace/HR targets, repetitions, and notes.",
    input_schema: {
      type: "object" as const,
      properties: {
        sport: { type: "string", description: "Filter by sport category name (optional)" },
      },
    },
  },
  {
    name: "get_workout_types",
    description: "Returns all user-defined sport categories and workout types with colors, default zones, and whether they are shared across sports. Use before creating workouts to know which sport/type names are valid.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_training_goals",
    description: "Returns the athlete's annual training volume goals per sport (km or time targets for week/month/year) and calculates current progress toward each goal.",
    input_schema: { type: "object" as const, properties: {} },
  },

  // ── Race & profile tools ────────────────────────────────────────────────────
  {
    name: "get_race_history",
    description: "Returns all the athlete's race results grouped by distance with personal bests, dates, event names, and number of results per distance.",
    input_schema: {
      type: "object" as const,
      properties: {
        distance: { type: "string", description: "Filter by distance label e.g. '5K', '10K', 'Half Marathon' (optional)" },
      },
    },
  },
  {
    name: "get_athlete_profile",
    description: "Returns the full athlete profile: weight, height, date of birth, sex, max HR, resting HR, manually set LT1/LT2 HR thresholds, artifact cap, training experience, primary goal, annual km targets per sport, and pace unit preference.",
    input_schema: { type: "object" as const, properties: {} },
  },

  // ── External tools ──────────────────────────────────────────────────────────
  {
    name: "web_search",
    description: "Searches the web for current information. Use for: recent training science research, injury information, race event schedules, course records, nutrition science, coaching methodology, or any information not available in the training database. Returns a synthesized answer plus source excerpts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        focus: { type: "string", description: "Optional context hint: 'science' | 'race_events' | 'injury' | 'nutrition' | 'general'" },
      },
      required: ["query"],
    },
  },
  {
    name: "weather_forecast",
    description: "Returns weather forecast for the next 1–7 days for the athlete's location: temperature range, precipitation probability, wind speed, humidity, and UV index per day. Use when discussing upcoming training conditions or race day weather.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Days ahead (1–7, default 3)" },
        date: { type: "string", description: "Specific date YYYY-MM-DD (optional, overrides days)" },
      },
    },
  },
  {
    name: "search_training_research",
    description: "Searches PubMed for peer-reviewed sports science research. Returns paper titles, abstracts, and links. Use when the athlete asks about scientific evidence for a training method, physiology question, or health topic.",
    input_schema: {
      type: "object" as const,
      properties: {
        query:       { type: "string", description: "Research topic, e.g. 'polarized training VO2max', 'HRV recovery sleep'" },
        max_results: { type: "number", description: "Max papers (default 3, max 5)" },
      },
      required: ["query"],
    },
  },

  // ── Write tools (require user approval) ─────────────────────────────────────
  {
    name: "create_workout",
    description: "Adds a planned workout session to the training calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        date:              { type: "string", description: "Date YYYY-MM-DD" },
        name:              { type: "string", description: "Workout name" },
        sportType:         { type: "string", description: "Sport type name (use get_workout_types to find valid names)" },
        targetDurationMin: { type: "number", description: "Target duration in minutes (optional)" },
        targetDistanceKm:  { type: "number", description: "Target distance in km (optional)" },
        targetIntensity:   { type: "string", description: "Easy | Moderate | Hard | Race (optional)" },
        notes:             { type: "string", description: "Instructions or notes (optional)" },
      },
      required: ["date", "name", "sportType"],
    },
  },
  {
    name: "update_workout",
    description: "Updates an existing planned workout. Only provided fields are changed.",
    input_schema: {
      type: "object" as const,
      properties: {
        workoutId:         { type: "string", description: "Workout ID from get_upcoming_plan" },
        date:              { type: "string", description: "New date YYYY-MM-DD (optional)" },
        name:              { type: "string", description: "New name (optional)" },
        targetDurationMin: { type: "number", description: "New duration in minutes (optional)" },
        targetDistanceKm:  { type: "number", description: "New distance in km (optional)" },
        targetIntensity:   { type: "string", description: "Easy | Moderate | Hard | Race (optional)" },
        notes:             { type: "string", description: "New notes (optional)" },
      },
      required: ["workoutId"],
    },
  },
  {
    name: "delete_workout",
    description: "Removes a planned workout from the calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        workoutId: { type: "string", description: "Workout ID from get_upcoming_plan" },
      },
      required: ["workoutId"],
    },
  },
  {
    name: "create_training_block",
    description: "Creates a new training block (Base/Build/Peak/Taper/Custom) in the training plan.",
    input_schema: {
      type: "object" as const,
      properties: {
        name:             { type: "string", description: "Block name" },
        blockType:        { type: "string", description: "Base | Build | Peak | Taper | Custom" },
        startDate:        { type: "string", description: "YYYY-MM-DD" },
        endDate:          { type: "string", description: "YYYY-MM-DD" },
        targetKmPerWeek:  { type: "number", description: "Weekly km target (optional)" },
        targetIntensity:  { type: "string", description: "polarized | pyramidal | threshold (optional)" },
        notes:            { type: "string", description: "Block goals or notes (optional)" },
      },
      required: ["name", "blockType", "startDate", "endDate"],
    },
  },
  {
    name: "update_training_block",
    description: "Updates an existing training block's dates, targets, or notes.",
    input_schema: {
      type: "object" as const,
      properties: {
        blockId:          { type: "string", description: "Block ID from get_training_blocks" },
        name:             { type: "string", description: "New name (optional)" },
        startDate:        { type: "string", description: "New start date YYYY-MM-DD (optional)" },
        endDate:          { type: "string", description: "New end date YYYY-MM-DD (optional)" },
        targetKmPerWeek:  { type: "number", description: "New km/week target (optional)" },
        targetIntensity:  { type: "string", description: "New intensity focus (optional)" },
        notes:            { type: "string", description: "New notes (optional)" },
      },
      required: ["blockId"],
    },
  },
  {
    name: "log_race_result",
    description: "Adds a race result or personal best to the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        distance:    { type: "string",  description: "Distance label e.g. '10K', 'Half Marathon', '5K'" },
        distanceM:   { type: "number",  description: "Distance in meters" },
        timeSeconds: { type: "number",  description: "Finish time in seconds" },
        date:        { type: "string",  description: "Race date YYYY-MM-DD" },
        eventName:   { type: "string",  description: "Race/event name (optional)" },
        notes:       { type: "string",  description: "Notes (optional)" },
      },
      required: ["distance", "distanceM", "timeSeconds", "date"],
    },
  },
  {
    name: "delete_race_result",
    description: "Removes a race result from the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        raceId: { type: "string", description: "Race record ID from get_race_history" },
      },
      required: ["raceId"],
    },
  },
  {
    name: "update_activity_notes",
    description: "Updates the description/notes of a Strava activity in the local database (does not sync back to Strava).",
    input_schema: {
      type: "object" as const,
      properties: {
        activity_id: { type: "string", description: "Activity ID from search_activities" },
        description: { type: "string", description: "New description text" },
      },
      required: ["activity_id", "description"],
    },
  },
  {
    name: "update_profile",
    description: "Updates the athlete's profile data.",
    input_schema: {
      type: "object" as const,
      properties: {
        primaryGoal:    { type: "string", description: "Primary training goal" },
        yearsTraining:  { type: "number", description: "Years of structured training" },
        weightKg:       { type: "number", description: "Body weight in kg" },
        maxHeartRate:   { type: "number", description: "Max heart rate in bpm" },
        restingHeartRate: { type: "number", description: "Resting heart rate in bpm" },
      },
    },
  },
] as const;

// Tools that write to the database — require user approval before execution
export const WRITE_TOOLS = new Set([
  "create_workout", "update_workout", "delete_workout",
  "create_training_block", "update_training_block",
  "log_race_result", "delete_race_result",
  "update_activity_notes",
  "update_profile",
]);

// ── Format converters ─────────────────────────────────────────────────────────

export function toGeminiTools() {
  return COACH_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

export function toOpenAITools() {
  return COACH_TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// ── Tool result interface ─────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  editId?: string;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeCoachTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  conversationId: string = "",
): Promise<ToolResult> {
  try {
    switch (toolName) {

      // ── search_activities ─────────────────────────────────────────────────
      case "search_activities": {
        const query    = (input.query as string | undefined)?.trim();
        const sport    = input.sport as string | undefined;
        const dateFrom = input.date_from ? new Date(input.date_from as string) : subDays(new Date(), 365);
        const dateTo   = input.date_to   ? new Date(input.date_to   as string) : new Date();
        const limit    = Math.min(30, Math.max(1, (input.limit as number) ?? 10));
        const isRace   = input.is_race as boolean | undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = { userId, startDate: { gte: dateFrom, lte: dateTo } };
        if (sport)  where.sportType = { contains: sport, mode: "insensitive" };
        if (isRace !== undefined) where.isRace = isRace;
        if (query)  where.OR = [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ];

        const acts = await prisma.activity.findMany({
          where, orderBy: { startDate: "desc" }, take: limit,
          select: { id: true, name: true, sportType: true, startDate: true, distance: true, movingTime: true, averageHeartrate: true, averageSpeed: true, totalElevationGain: true, isRace: true, weatherTemp: true, description: true },
        });

        if (acts.length === 0) return { success: true, message: "No activities found.", data: "No activities found matching the criteria." };

        type SA = typeof acts[number];
        const lines = (acts as SA[]).map(a => {
          const date  = format(a.startDate, "yyyy-MM-dd EEE");
          const dist  = a.distance ? `${(a.distance / 1000).toFixed(1)}km` : "";
          const time  = a.movingTime ? `${Math.round(a.movingTime / 60)}min` : "";
          const hr    = a.averageHeartrate ? ` · ${Math.round(a.averageHeartrate)}bpm` : "";
          const pace  = a.averageSpeed && /run|trail/i.test(a.sportType)
            ? ` · ${Math.floor(1000 / a.averageSpeed / 60)}:${String(Math.round((1000 / a.averageSpeed) % 60)).padStart(2, "0")}/km` : "";
          const race  = a.isRace ? " [RACE]" : "";
          const temp  = a.weatherTemp != null ? ` · ${Math.round(a.weatherTemp)}°C` : "";
          const desc  = a.description ? ` · "${a.description.slice(0, 60)}"` : "";
          return `[id:${a.id}] ${date}: ${a.name}${race} — ${a.sportType} ${dist} ${time}${hr}${pace}${temp}${desc}`;
        }).join("\n");

        return { success: true, message: `${acts.length} activities found`, data: lines };
      }

      // ── get_activity_detail ───────────────────────────────────────────────
      case "get_activity_detail": {
        const act = await prisma.activity.findUnique({
          where: { id: input.activity_id as string },
          select: { id: true, userId: true, name: true, description: true, sportType: true, startDate: true, distance: true, movingTime: true, elapsedTime: true, totalElevationGain: true, averageSpeed: true, maxSpeed: true, averageHeartrate: true, maxHeartrate: true, averageCadence: true, averageWatts: true, weightedAverageWatts: true, sufferScore: true, perceivedExertion: true, isRace: true, workoutType: true, trainingLoad: true, intensityFactor: true, hrrSeconds: true, splitsMetric: true, laps: true, bestEfforts: true, weatherTemp: true, weatherWind: true, weatherPrecip: true },
        });
        if (!act || act.userId !== userId)
          return { success: false, message: "Activity not found.", data: "error: not found or unauthorized" };

        const secPerKm = act.averageSpeed ? 1000 / act.averageSpeed : null;
        const lines: string[] = [
          `Activity: ${act.name} (${act.sportType})${act.isRace ? " [RACE]" : ""}`,
          `Date: ${format(act.startDate, "EEEE d MMMM yyyy HH:mm")}`,
          `Distance: ${(act.distance / 1000).toFixed(2)} km`,
          `Moving time: ${Math.floor(act.movingTime / 60)}:${String(act.movingTime % 60).padStart(2, "0")}`,
          `Elevation gain: ${Math.round(act.totalElevationGain)} m`,
        ];
        if (secPerKm && /run|trail/i.test(act.sportType))
          lines.push(`Avg pace: ${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}/km`);
        if (act.averageHeartrate) lines.push(`HR: avg ${Math.round(act.averageHeartrate)} bpm${act.maxHeartrate ? ` / max ${Math.round(act.maxHeartrate)} bpm` : ""}`);
        if (act.averageCadence)   lines.push(`Cadence: ${Math.round(act.averageCadence * 2)} spm`);
        if (act.averageWatts)     lines.push(`Power: avg ${Math.round(act.averageWatts)}W${act.weightedAverageWatts ? ` / NP ${Math.round(act.weightedAverageWatts)}W` : ""}`);
        if (act.trainingLoad)     lines.push(`Training load (TSS): ${Math.round(act.trainingLoad)}`);
        if (act.intensityFactor)  lines.push(`Intensity factor: ${act.intensityFactor.toFixed(2)}`);
        if (act.hrrSeconds)       lines.push(`HR recovery (60s): ${act.hrrSeconds} bpm drop`);
        if (act.sufferScore)      lines.push(`Suffer score: ${act.sufferScore}${act.perceivedExertion ? ` · RPE: ${act.perceivedExertion}/10` : ""}`);
        if (act.weatherTemp != null) lines.push(`Weather: ${Math.round(act.weatherTemp)}°C${act.weatherWind ? `, ${Math.round(act.weatherWind)} km/h wind` : ""}${act.weatherPrecip ? `, ${act.weatherPrecip.toFixed(1)}mm precip` : ""}`);
        if (act.description) lines.push(`\nDescription:\n${act.description}`);

        if (act.splitsMetric && Array.isArray(act.splitsMetric)) {
          type Split = { split: number; distance: number; moving_time: number; average_speed: number; average_heartrate?: number };
          const splits = (act.splitsMetric as Split[]).filter(s => s.moving_time > 0 && s.average_speed > 0);
          if (splits.length > 0) {
            lines.push("\nSplits (per km):");
            splits.forEach(s => {
              const sp = 1000 / s.average_speed;
              const hr = s.average_heartrate ? ` · ${Math.round(s.average_heartrate)}bpm` : "";
              lines.push(`  km ${s.split}: ${Math.floor(sp / 60)}:${String(Math.round(sp % 60)).padStart(2, "0")}/km${hr}`);
            });
          }
        }

        if (act.bestEfforts && Array.isArray(act.bestEfforts)) {
          type BE = { name: string; elapsed_time: number };
          const efforts = (act.bestEfforts as BE[]).slice(0, 8);
          if (efforts.length > 0) {
            lines.push("\nBest efforts:");
            efforts.forEach(e => {
              lines.push(`  ${e.name}: ${Math.floor(e.elapsed_time / 60)}:${String(e.elapsed_time % 60).padStart(2, "0")}`);
            });
          }
        }

        return { success: true, message: `Activity: ${act.name}`, data: lines.join("\n") };
      }

      // ── get_activity_stream ───────────────────────────────────────────────
      case "get_activity_stream": {
        const stream = await prisma.activityStream.findUnique({
          where: { activityId: input.activity_id as string },
          select: { heartrate: true, velocity: true, altitude: true, cadence: true, watts: true, time: true },
        });
        const act = await prisma.activity.findUnique({
          where: { id: input.activity_id as string },
          select: { userId: true, name: true, sportType: true, distance: true, movingTime: true, averageHeartrate: true },
        });
        if (!act || act.userId !== userId) return { success: false, message: "Activity not found.", data: "error: not found" };
        if (!stream) return { success: true, message: "No stream data.", data: "Second-by-second stream data not available for this activity." };

        const lines: string[] = [`Stream analysis: ${act.name} (${act.sportType})`];

        if (stream.heartrate && Array.isArray(stream.heartrate)) {
          const hrs = stream.heartrate as number[];
          const validHR = hrs.filter(h => h > 40 && h < 230);
          if (validHR.length > 0) {
            const avgHR = validHR.reduce((a, b) => a + b, 0) / validHR.length;
            const maxHR = Math.max(...validHR);
            const minHR = Math.min(...validHR);
            // Compute HR drift (first half vs second half)
            const mid = Math.floor(validHR.length / 2);
            const firstHalf = validHR.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
            const secondHalf = validHR.slice(mid).reduce((a, b) => a + b, 0) / (validHR.length - mid);
            lines.push(`\nHR analysis:`);
            lines.push(`  Avg: ${Math.round(avgHR)} bpm  |  Max: ${maxHR} bpm  |  Min: ${minHR} bpm`);
            lines.push(`  Cardiac drift: first half avg ${Math.round(firstHalf)} bpm → second half avg ${Math.round(secondHalf)} bpm (drift: ${secondHalf > firstHalf ? "+" : ""}${Math.round(secondHalf - firstHalf)} bpm)`);
          }
        }

        if (stream.velocity && Array.isArray(stream.velocity)) {
          const vels = (stream.velocity as number[]).filter(v => v > 0);
          if (vels.length > 0 && /run|trail/i.test(act.sportType)) {
            const avgPace = 1000 / (vels.reduce((a, b) => a + b, 0) / vels.length);
            const minPace = 1000 / Math.max(...vels);
            const maxPace = 1000 / Math.min(...vels);
            lines.push(`\nPace analysis:`);
            lines.push(`  Avg: ${Math.floor(avgPace / 60)}:${String(Math.round(avgPace % 60)).padStart(2, "0")}/km`);
            lines.push(`  Best: ${Math.floor(minPace / 60)}:${String(Math.round(minPace % 60)).padStart(2, "0")}/km`);
            lines.push(`  Slowest: ${Math.floor(maxPace / 60)}:${String(Math.round(maxPace % 60)).padStart(2, "0")}/km`);
          }
        }

        if (stream.watts && Array.isArray(stream.watts)) {
          const watts = (stream.watts as number[]).filter(w => w > 0);
          if (watts.length > 0) {
            const avgW = watts.reduce((a, b) => a + b, 0) / watts.length;
            lines.push(`\nPower: avg ${Math.round(avgW)}W  |  Peak ${Math.max(...watts)}W`);
          }
        }

        return { success: true, message: `Stream analysis: ${act.name}`, data: lines.join("\n") };
      }

      // ── get_activities_in_range ───────────────────────────────────────────
      case "get_activities_in_range": {
        const dateFrom  = new Date(input.date_from as string);
        const dateTo    = new Date(input.date_to as string);
        const sport     = input.sport as string | undefined;
        const confirmed = (input.confirmed as boolean) ?? false;
        if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime()))
          return { success: false, message: "Invalid date.", data: "error: invalid date" };

        const count = await prisma.activity.count({
          where: { userId, startDate: { gte: dateFrom, lte: dateTo }, ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}) },
        });
        if (!confirmed) {
          const estTokens = count * 200;
          const cost = (estTokens / 1_000_000 * 3.0).toFixed(4);
          return { success: true, message: `${count} activities — confirmation required`, data: `Period ${format(dateFrom, "d MMM yyyy")}–${format(dateTo, "d MMM yyyy")}: ${count} activities ≈ ${estTokens.toLocaleString()} tokens ≈ $${cost} (Claude). Proceed? Call again with confirmed=true.` };
        }
        if (count > 500) return { success: false, message: "Too many activities — max 500.", data: "error: too many activities, narrow the date range" };

        const acts = await prisma.activity.findMany({
          where: { userId, startDate: { gte: dateFrom, lte: dateTo }, ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}) },
          orderBy: { startDate: "asc" },
          select: { name: true, sportType: true, startDate: true, isRace: true, distance: true, movingTime: true, averageSpeed: true, maxSpeed: true, averageHeartrate: true, maxHeartrate: true, averageCadence: true, totalElevationGain: true, weatherTemp: true, weatherWind: true, sufferScore: true, perceivedExertion: true, description: true, splitsMetric: true },
        });

        const lines: string[] = [];
        for (const a of acts) {
          const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][a.startDate.getDay()];
          const pace = a.averageSpeed ? Math.round(1000 / a.averageSpeed) : null;
          const fp = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
          lines.push(`[${format(a.startDate, "yyyy-MM-dd")} ${dow}] ${a.name}${a.isRace ? " 🏆" : ""} — ${a.sportType}`);
          lines.push(`  ${(a.distance / 1000).toFixed(1)}km · ${Math.floor(a.movingTime / 60)}min${pace ? ` · ${fp(pace)}/km` : ""}${a.averageHeartrate ? ` · ${Math.round(a.averageHeartrate)}bpm` : ""}`);
          if (a.totalElevationGain > 5) lines.push(`  Elevation: ${Math.round(a.totalElevationGain)}m`);
          if (a.weatherTemp != null) lines.push(`  Weather: ${Math.round(a.weatherTemp)}°C${a.weatherWind ? ` · ${Math.round(a.weatherWind)}km/h wind` : ""}`);
          if (a.description) lines.push(`  Notes: "${a.description.slice(0, 80)}"`);
          lines.push("");
        }
        return { success: true, message: `${acts.length} activities`, data: lines.join("\n") };
      }

      // ── analyze_full_history ──────────────────────────────────────────────
      case "analyze_full_history": {
        const years = Math.min(5, Math.max(1, (input.years as number) ?? 3));
        const sport = input.sport as string | undefined;
        const since = subDays(new Date(), years * 365);

        const acts = await prisma.activity.findMany({
          where: { userId, startDate: { gte: since }, ...(sport ? { sportType: { contains: sport, mode: "insensitive" } } : {}) },
          select: { sportType: true, startDate: true, distance: true, movingTime: true, isRace: true, totalElevationGain: true },
          orderBy: { startDate: "asc" },
        });
        if (acts.length === 0) return { success: true, message: "No data", data: "No activities found in this period." };

        const byYear = new Map<number, { km: number; count: number; races: number; elevM: number }>();
        const byMonth = new Map<string, { km: number; count: number; timeSec: number }>();
        for (const a of acts) {
          const yr = a.startDate.getFullYear();
          const mo = `${yr}-${String(a.startDate.getMonth() + 1).padStart(2, "0")}`;
          if (!byYear.has(yr)) byYear.set(yr, { km: 0, count: 0, races: 0, elevM: 0 });
          if (!byMonth.has(mo)) byMonth.set(mo, { km: 0, count: 0, timeSec: 0 });
          const y = byYear.get(yr)!; y.km += a.distance / 1000; y.count++; if (a.isRace) y.races++; y.elevM += a.totalElevationGain;
          const m = byMonth.get(mo)!; m.km += a.distance / 1000; m.count++; m.timeSec += a.movingTime;
        }

        const lines = [
          `History: ${acts.length} activities over ${years} years`,
          "\n=== Yearly summary ===",
          ...[...byYear.entries()].sort(([a], [b]) => (a as number) - (b as number)).map(([yr, d]) =>
            `${yr}: ${Math.round(d.km)}km · ${d.count} sessions · ${d.races} races · ${Math.round(d.elevM / 1000)}km elev`),
          "\n=== Monthly volume (recent 18 months) ===",
          ...[...byMonth.entries()].sort().slice(-18).map(([mo, d]) =>
            `${mo}: ${Math.round(d.km)}km · ${d.count} sessions · ${Math.round(d.timeSec / 3600)}h`),
        ];
        return { success: true, message: `${years}-year history — ${acts.length} activities`, data: lines.join("\n") };
      }

      // ── get_segment_history ───────────────────────────────────────────────
      case "get_segment_history": {
        const stravaAccount = await prisma.stravaAccount.findUnique({ where: { userId } });
        if (!stravaAccount) return { success: false, message: "Strava not connected.", data: "error: no Strava account" };

        // Refresh token if needed
        let accessToken = stravaAccount.accessToken;
        if (stravaAccount.expiresAt < new Date()) {
          const refreshRes = await fetchWithTimeout("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: stravaAccount.refreshToken }),
          });
          if (!refreshRes.ok) return { success: false, message: "Strava token refresh failed.", data: "error: token refresh" };
          const tokens = await refreshRes.json() as { access_token: string; refresh_token: string; expires_at: number };
          await prisma.stravaAccount.update({ where: { userId }, data: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: new Date(tokens.expires_at * 1000) } });
          accessToken = tokens.access_token;
        }

        const limit = Math.min(20, (input.limit as number) ?? 10);
        const res = await fetchWithTimeout(`https://www.strava.com/api/v3/segments/${input.segment_id}/all_efforts?per_page=${limit}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return { success: false, message: "Segment not found or not accessible.", data: `Strava API error ${res.status}` };

        type Effort = { elapsed_time: number; start_date_local: string; kom_rank?: number | null };
        const efforts = await res.json() as Effort[];
        if (!efforts.length) return { success: true, message: "No efforts on this segment.", data: "No segment efforts found." };

        const lines = efforts.map(e => {
          const mm = Math.floor(e.elapsed_time / 60), ss = e.elapsed_time % 60;
          const rank = e.kom_rank ? ` (rank #${e.kom_rank})` : "";
          return `${format(new Date(e.start_date_local), "yyyy-MM-dd")}: ${mm}:${String(ss).padStart(2, "0")}${rank}`;
        });
        return { success: true, message: `${efforts.length} segment efforts`, data: lines.join("\n") };
      }

      // ── get_fitness_summary ───────────────────────────────────────────────
      case "get_fitness_summary": {
        const fc = await prisma.fitnessCache.findUnique({ where: { userId } });
        if (!fc) return { success: true, message: "Fitness summary", data: "No fitness data cached yet. Sync Strava to generate." };

        type Pred = { label: string; peak: number; today?: number };
        const preds = fc.predictionsJson as Pred[] | null;
        const predStr = preds ? preds.map(p => `  ${p.label}: ${Math.floor(p.peak / 60)}:${String(p.peak % 60).padStart(2, "0")}`).join("\n") : "none";

        type WeekVol = Record<string, Record<string, { km: number; timeSec: number }>>;
        const wvol = fc.weeklyVolumeJson as WeekVol | null;
        const weekLines = wvol ? Object.entries(wvol).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([wk, sports]) => {
          const totalKm = Object.values(sports).reduce((s, v) => s + (v.km ?? 0), 0);
          const sportBreakdown = Object.entries(sports).map(([sp, v]) => `${sp}:${Math.round(v.km)}km`).join(" ");
          return `  ${wk}: ${Math.round(totalKm)}km (${sportBreakdown})`;
        }) : [];

        type ZoneSec = { z1: number; z2: number; z3: number; z4: number; z5: number };
        const zs = fc.zoneSecondsJson as ZoneSec | null;
        const total = zs ? zs.z1 + zs.z2 + zs.z3 + zs.z4 + zs.z5 : 0;
        const zoneStr = zs && total > 0 ? `Z1:${Math.round(zs.z1/3600)}h(${Math.round(zs.z1/total*100)}%) Z2:${Math.round(zs.z2/3600)}h(${Math.round(zs.z2/total*100)}%) Z3:${Math.round(zs.z3/3600)}h(${Math.round(zs.z3/total*100)}%) Z4:${Math.round(zs.z4/3600)}h(${Math.round(zs.z4/total*100)}%) Z5:${Math.round(zs.z5/3600)}h(${Math.round(zs.z5/total*100)}%)` : "No zone data";

        type Polar = { z1Pct: number; z2Pct: number; z3Pct: number };
        const pol = fc.polarisationJson as Polar | null;
        const polarStr = pol ? `Seiler zones: Z1(easy):${pol.z1Pct.toFixed(0)}% Z2(moderate):${pol.z2Pct.toFixed(0)}% Z3(hard):${pol.z3Pct.toFixed(0)}%` : "";

        const lines = [
          `VO2max: ${fc.vo2max.toFixed(1)} ml/kg/min (${fc.confidence} confidence, VDOT ${fc.vdot.toFixed(1)})`,
          `CTL (fitness): ${fc.ctl?.toFixed(1) ?? "?"} TSS  |  ATL (fatigue): ${fc.atl?.toFixed(1) ?? "?"} TSS  |  TSB (form): ${fc.tsb?.toFixed(1) ?? "?"}`,
          `ACWR: ${fc.acwr?.toFixed(2) ?? "?"}  |  Max HR: ${fc.maxHR} bpm  |  Rest HR: ${fc.restHR} bpm`,
          fc.thresholdHR ? `Threshold HR (LT2): ${fc.thresholdHR} bpm` : "",
          fc.criticalSpeedMs ? `Critical speed: ${(fc.criticalSpeedMs * 3.6).toFixed(1)} km/h  |  W': ${fc.wPrimeMeters?.toFixed(0) ?? "?"}m` : "",
          fc.decouplingLt1HR ? `Aerobic decoupling LT1 estimate: ${fc.decouplingLt1HR.toFixed(0)} bpm (from ${fc.decouplingRunsUsed ?? "?"} steady runs)` : "",
          `\nHR zones:`,
          ...(fc.zones as { z1: [number,number]; z2: [number,number]; z3: [number,number]; z4: [number,number]; z5: [number,number] } | null
            ? Object.entries(fc.zones as Record<string, [number, number]>).map(([z, [lo, hi]]) => `  ${z}: ${lo}–${hi} bpm`)
            : []),
          `\nZone distribution (last 12 weeks):  ${zoneStr}`,
          pol ? `\n${polarStr}` : "",
          `\nRace time predictions:\n${predStr}`,
          weekLines.length ? `\nWeekly volume (last 8 weeks):\n${weekLines.join("\n")}` : "",
          `\nComputed: ${format(fc.computedAt, "d MMM yyyy HH:mm")}`,
        ].filter(Boolean);

        return { success: true, message: "Fitness summary", data: lines.join("\n") };
      }

      // ── get_volume_stats ──────────────────────────────────────────────────
      case "get_volume_stats": {
        const fc = await prisma.fitnessCache.findUnique({ where: { userId }, select: { weeklyVolumeJson: true } });
        const weeks = Math.min(52, Math.max(1, (input.weeks as number) ?? 12));
        const sportFilter = (input.sport as string | undefined)?.toLowerCase();

        if (!fc?.weeklyVolumeJson) {
          // Fall back to live query
          const since = subDays(new Date(), weeks * 7);
          const acts = await prisma.activity.findMany({
            where: { userId, startDate: { gte: since }, ...(sportFilter ? { sportType: { contains: sportFilter, mode: "insensitive" } } : {}) },
            select: { startDate: true, distance: true, movingTime: true, sportType: true },
            orderBy: { startDate: "asc" },
          });
          const byWeek = new Map<string, { km: number; timeSec: number; count: number }>();
          for (const a of acts) {
            const wk = format(startOfWeek(a.startDate, { weekStartsOn: 1 }), "yyyy-'W'II");
            if (!byWeek.has(wk)) byWeek.set(wk, { km: 0, timeSec: 0, count: 0 });
            const w = byWeek.get(wk)!; w.km += a.distance / 1000; w.timeSec += a.movingTime; w.count++;
          }
          const lines = [...byWeek.entries()].sort().map(([wk, d]) =>
            `${wk}: ${Math.round(d.km)}km · ${Math.round(d.timeSec / 3600)}h · ${d.count} sessions`);
          return { success: true, message: "Volume stats", data: lines.join("\n") || "No data." };
        }

        type WeekVol = Record<string, Record<string, { km: number; timeSec: number; count?: number }>>;
        const wvol = fc.weeklyVolumeJson as WeekVol;
        const lines = Object.entries(wvol).sort(([a], [b]) => a.localeCompare(b)).slice(-weeks).map(([wk, sports]) => {
          const filtered = sportFilter
            ? Object.entries(sports).filter(([sp]) => sp.toLowerCase().includes(sportFilter))
            : Object.entries(sports);
          const totalKm = filtered.reduce((s, [, v]) => s + (v.km ?? 0), 0);
          const totalH  = filtered.reduce((s, [, v]) => s + (v.timeSec ?? 0), 0) / 3600;
          const breakdown = filtered.map(([sp, v]) => `${sp}:${Math.round(v.km ?? 0)}km`).join(" ");
          return `${wk}: ${Math.round(totalKm)}km · ${totalH.toFixed(1)}h  (${breakdown})`;
        });
        return { success: true, message: `Volume stats — ${weeks} weeks`, data: lines.join("\n") || "No data." };
      }

      // ── get_zone_distribution ─────────────────────────────────────────────
      case "get_zone_distribution": {
        const fc = await prisma.fitnessCache.findUnique({ where: { userId }, select: { zoneSecondsJson: true, polarisationJson: true } });
        if (!fc?.zoneSecondsJson) return { success: true, message: "Zone distribution", data: "No zone data available. Sync Strava to compute zones." };

        type ZoneSec = { z1: number; z2: number; z3: number; z4: number; z5: number };
        const zs = fc.zoneSecondsJson as ZoneSec;
        const total = zs.z1 + zs.z2 + zs.z3 + zs.z4 + zs.z5;
        const pct = (v: number) => total > 0 ? (v / total * 100).toFixed(0) + "%" : "0%";
        const hr = (v: number) => (v / 3600).toFixed(1) + "h";

        type Polar = { z1Pct: number; z2Pct: number; z3Pct: number };
        const pol = fc.polarisationJson as Polar | null;

        const lines = [
          "Zone time distribution (last 12 weeks):",
          `  Z1 Recovery: ${hr(zs.z1)} (${pct(zs.z1)})`,
          `  Z2 Aerobic:  ${hr(zs.z2)} (${pct(zs.z2)})`,
          `  Z3 Tempo:    ${hr(zs.z3)} (${pct(zs.z3)})`,
          `  Z4 Threshold:${hr(zs.z4)} (${pct(zs.z4)})`,
          `  Z5 VO2max:   ${hr(zs.z5)} (${pct(zs.z5)})`,
          `  Total: ${hr(total)}`,
          pol ? `\nSeiler 3-zone polarization:\n  Easy (Z1): ${pol.z1Pct.toFixed(0)}%  Moderate (Z2): ${pol.z2Pct.toFixed(0)}%  Hard (Z3): ${pol.z3Pct.toFixed(0)}%` : "",
        ].filter(Boolean);
        return { success: true, message: "Zone distribution", data: lines.join("\n") };
      }

      // ── get_readiness ─────────────────────────────────────────────────────
      case "get_readiness": {
        const [garmin, fc] = await Promise.all([
          prisma.garminDailySummary.findMany({
            where: { userId, date: { gte: subDays(new Date(), 7) } },
            orderBy: { date: "asc" },
          }),
          prisma.fitnessCache.findUnique({ where: { userId }, select: { tsb: true, atl: true, acwr: true } }),
        ]);
        const lines: string[] = [];
        if (garmin.length > 0) {
          lines.push("Garmin wellness (last 7 days):");
          type GDay = typeof garmin[number];
          for (const g of garmin as GDay[]) {
            const dateStr = format(g.date, "EEE d MMM");
            const parts: string[] = [dateStr + ":"];
            if (g.hrvNightly)      parts.push(`HRV ${g.hrvNightly.toFixed(0)}ms`);
            if (g.restingHR)       parts.push(`viloHR ${g.restingHR}bpm`);
            if (g.sleepScore)      parts.push(`sleep ${g.sleepScore}/100`);
            if (g.sleepDuration)   parts.push(`${(g.sleepDuration / 3600).toFixed(1)}h`);
            if (g.bodyBattery)     parts.push(`BB ${g.bodyBattery}/100`);
            if (g.stressAvg)       parts.push(`stress ${g.stressAvg}`);
            if (g.trainingReadiness != null) parts.push(`readiness ${g.trainingReadiness}/100`);
            if (g.sleepDeep || g.sleepLight || g.sleepRem) {
              const d = g.sleepDeep ?? 0, l = g.sleepLight ?? 0, r = g.sleepRem ?? 0;
              parts.push(`(deep ${Math.round(d/60)}min light ${Math.round(l/60)}min REM ${Math.round(r/60)}min)`);
            }
            lines.push("  " + parts.join(" · "));
          }
          const hrvVals = (garmin as GDay[]).map(g => g.hrvNightly).filter((v): v is number => v !== null);
          if (hrvVals.length > 1) {
            const trend = hrvVals.at(-1)! - hrvVals[0];
            lines.push(`\nHRV trend: ${trend > 2 ? "↑ improving" : trend < -2 ? "↓ declining" : "→ stable"} (${hrvVals[0].toFixed(0)} → ${hrvVals.at(-1)!.toFixed(0)} ms)`);
          }
        } else {
          lines.push("No Garmin data available.");
        }
        if (fc) lines.push(`\nTraining load: TSB ${fc.tsb?.toFixed(1) ?? "?"}  |  ATL ${fc.atl?.toFixed(1) ?? "?"}  |  ACWR ${fc.acwr?.toFixed(2) ?? "?"}`);
        return { success: true, message: "Readiness data", data: lines.join("\n") || "No readiness data." };
      }

      // ── get_wellness_history ──────────────────────────────────────────────
      case "get_wellness_history": {
        const days     = Math.min(90, Math.max(1, (input.days as number) ?? 14));
        const dateFrom = input.date_from ? new Date(input.date_from as string) : subDays(new Date(), days);
        const dateTo   = input.date_to   ? new Date(input.date_to as string)   : new Date();

        const garmin = await prisma.garminDailySummary.findMany({
          where: { userId, date: { gte: dateFrom, lte: dateTo } },
          orderBy: { date: "asc" },
        });
        if (garmin.length === 0) return { success: true, message: "No wellness data", data: "No Garmin wellness data found for this period." };

        type GDay = typeof garmin[number];
        const lines = (garmin as GDay[]).map(g => {
          const parts: string[] = [format(g.date, "yyyy-MM-dd EEE") + ":"];
          if (g.hrvNightly != null)       parts.push(`HRV ${g.hrvNightly.toFixed(0)}ms`);
          if (g.hrvBalance)               parts.push(`(${g.hrvBalance})`);
          if (g.restingHR != null)        parts.push(`viloHR ${g.restingHR}bpm`);
          if (g.sleepScore != null)       parts.push(`sleep ${g.sleepScore}/100`);
          if (g.sleepDuration != null)    parts.push(`${(g.sleepDuration / 3600).toFixed(1)}h`);
          if (g.sleepDeep != null)        parts.push(`deep ${Math.round(g.sleepDeep / 60)}min`);
          if (g.sleepRem != null)         parts.push(`REM ${Math.round(g.sleepRem / 60)}min`);
          if (g.bodyBattery != null)      parts.push(`BB ${g.bodyBattery}`);
          if (g.stressAvg != null)        parts.push(`stress ${g.stressAvg}`);
          if (g.trainingReadiness != null)parts.push(`readiness ${g.trainingReadiness}`);
          if (g.spo2Avg != null)          parts.push(`SpO₂ ${g.spo2Avg.toFixed(0)}%`);
          if (g.steps != null)            parts.push(`${g.steps.toLocaleString()} steps`);
          return parts.join(" · ");
        });

        return { success: true, message: `Wellness history (${garmin.length} days)`, data: lines.join("\n") };
      }

      // ── get_upcoming_plan ─────────────────────────────────────────────────
      case "get_upcoming_plan": {
        const days = Math.min(60, Math.max(1, (input.days as number) ?? 14));
        const workouts = await prisma.plannedWorkout.findMany({
          where: { userId, date: { gte: new Date(), lte: addDays(new Date(), days) }, status: "planned" },
          orderBy: { date: "asc" },
          select: { id: true, name: true, sportType: true, date: true, targetDistance: true, targetDuration: true, targetIntensity: true, notes: true, status: true },
        });
        if (workouts.length === 0) return { success: true, message: "No planned sessions.", data: "No planned workouts." };
        type W = typeof workouts[number];
        const lines = (workouts as W[]).map(w => {
          const dist = w.targetDistance ? ` · ${(w.targetDistance / 1000).toFixed(0)}km` : "";
          const dur  = w.targetDuration ? ` · ${Math.round(w.targetDuration / 60)}min` : "";
          const int  = w.targetIntensity ? ` [${w.targetIntensity}]` : "";
          const notes = w.notes ? ` — ${w.notes.slice(0, 60)}` : "";
          return `${format(w.date, "EEE d MMM")}: ${w.name} (${w.sportType})${dist}${dur}${int}${notes} [id:${w.id}]`;
        }).join("\n");
        return { success: true, message: `${workouts.length} planned sessions`, data: lines };
      }

      // ── get_training_blocks ───────────────────────────────────────────────
      case "get_training_blocks": {
        const blocks = await prisma.trainingBlock.findMany({
          where: { userId }, orderBy: { startDate: "asc" },
          select: { id: true, name: true, blockType: true, startDate: true, endDate: true, targetKmPerWeek: true, targetIntensity: true, archived: true, actualKm: true, actualTimeSec: true, actualTSS: true, actualCompletionRate: true, notes: true },
        });
        if (blocks.length === 0) return { success: true, message: "No training blocks.", data: "No training blocks defined." };
        const now = new Date();
        type B = typeof blocks[number];
        const lines = (blocks as B[]).map(b => {
          const status = b.archived ? "archived" : b.startDate <= now && b.endDate >= now ? "CURRENT" : b.startDate > now ? "upcoming" : "past";
          const target = b.targetKmPerWeek ? ` target:${b.targetKmPerWeek}km/w` : "";
          const actual = b.actualKm ? ` actual:${Math.round(b.actualKm)}km` : "";
          const rate   = b.actualCompletionRate != null ? ` completion:${Math.round(b.actualCompletionRate * 100)}%` : "";
          const int    = b.targetIntensity ? ` focus:${b.targetIntensity}` : "";
          const notes  = b.notes ? ` — ${b.notes.slice(0, 60)}` : "";
          return `[${status}] ${b.name} (${b.blockType}) ${format(b.startDate, "d MMM")}–${format(b.endDate, "d MMM")}${target}${actual}${rate}${int}${notes} [id:${b.id}]`;
        });
        return { success: true, message: "Training blocks", data: lines.join("\n") };
      }

      // ── get_workout_templates ─────────────────────────────────────────────
      case "get_workout_templates": {
        const sportFilter = input.sport as string | undefined;
        const templates = await prisma.workoutTemplate.findMany({
          where: { userId, ...(sportFilter ? { sport: { name: { contains: sportFilter, mode: "insensitive" } } } : {}) },
          include: { sections: { orderBy: { order: "asc" } }, sport: true, type: true },
          orderBy: { name: "asc" },
        });
        if (templates.length === 0) return { success: true, message: "No templates.", data: "No workout templates saved." };
        const lines: string[] = [];
        for (const t of templates) {
          lines.push(`Template: ${t.name} (${t.sport.name}${t.type ? "/" + t.type.name : ""})`);
          if (t.estimatedDistance) lines.push(`  Est. distance: ${(t.estimatedDistance / 1000).toFixed(1)}km`);
          if (t.estimatedDuration) lines.push(`  Est. duration: ${Math.round(t.estimatedDuration / 60)}min`);
          if (t.estimatedTSS)      lines.push(`  Est. TSS: ${Math.round(t.estimatedTSS)}`);
          if (t.description)       lines.push(`  ${t.description}`);
          for (const s of t.sections) {
            const dur = s.duration ? `${Math.round(s.duration / 60)}min` : s.distance ? `${(s.distance / 1000).toFixed(1)}km` : "";
            const rep = s.repetitions ? `${s.repetitions}×` : "";
            const zone = s.zoneType && s.targetZone ? ` Z${s.targetZone}` : "";
            lines.push(`    ${rep}${s.name}: ${dur}${zone}${s.notes ? " — " + s.notes : ""}`);
          }
          lines.push("");
        }
        return { success: true, message: `${templates.length} templates`, data: lines.join("\n") };
      }

      // ── get_workout_types ─────────────────────────────────────────────────
      case "get_workout_types": {
        const [sports, types] = await Promise.all([
          prisma.sportCategory.findMany({ where: { userId }, orderBy: { order: "asc" }, select: { id: true, name: true, color: true, isRunningRelated: true } }),
          prisma.workoutType.findMany({ where: { userId }, orderBy: { order: "asc" }, include: { sport: { select: { name: true } } } }),
        ]);
        type SC = typeof sports[number];
        type WT = typeof types[number];
        const lines = [
          "Sport categories: " + (sports as SC[]).map((s: SC) => s.name).join(", "),
          "\nWorkout types by sport:",
          ...(sports as SC[]).map((sp: SC) => {
            const st = (types as WT[]).filter((t: WT) => t.sport.name === sp.name).map((t: WT) => t.name).join(", ");
            return `  ${sp.name}: ${st || "(none)"}`;
          }),
        ];
        return { success: true, message: "Workout types", data: lines.join("\n") };
      }

      // ── get_training_goals ────────────────────────────────────────────────
      case "get_training_goals": {
        const goals = await prisma.trainingGoal.findMany({ where: { userId }, orderBy: { sport: "asc" } });
        if (goals.length === 0) return { success: true, message: "No goals.", data: "No training goals set." };

        const now = new Date();
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });

        const actsByPeriod = await prisma.activity.findMany({
          where: { userId, startDate: { gte: yearStart } },
          select: { sportType: true, startDate: true, distance: true, movingTime: true },
        });

        type APAct = typeof actsByPeriod[number];
        const lines: string[] = [];
        for (const g of goals) {
          const acts = g.sport
            ? actsByPeriod.filter((a: APAct) => a.sportType.toLowerCase().includes(g.sport.toLowerCase()))
            : actsByPeriod;

          const periodStart = g.period === "year" ? yearStart : g.period === "month" ? monthStart : weekStart;
          const periodActs = (acts as APAct[]).filter((a: APAct) => a.startDate >= periodStart);
          const current = g.metric === "distance"
            ? periodActs.reduce((s: number, a: APAct) => s + a.distance / 1000, 0)
            : periodActs.reduce((s: number, a: APAct) => s + a.movingTime / 60, 0);
          const unit = g.metric === "distance" ? "km" : "min";
          const pct = g.target > 0 ? Math.round(current / g.target * 100) : 0;
          lines.push(`${g.sport || "All sports"} — ${g.period} ${g.metric}: ${Math.round(current)}${unit} / ${g.target}${unit} (${pct}%)`);
        }
        return { success: true, message: "Training goals", data: lines.join("\n") };
      }

      // ── get_race_history ──────────────────────────────────────────────────
      case "get_race_history": {
        const distFilter = input.distance as string | undefined;
        const recs = await prisma.raceRecord.findMany({
          where: { userId, ...(distFilter ? { distance: { contains: distFilter, mode: "insensitive" } } : {}) },
          orderBy: [{ distanceM: "asc" }, { date: "desc" }],
          select: { id: true, distance: true, distanceM: true, time: true, date: true, eventName: true, notes: true },
        });
        if (recs.length === 0) return { success: true, message: "No race records.", data: "No race records found." };

        const byDist = new Map<string, typeof recs>();
        for (const r of recs) {
          if (!byDist.has(r.distance)) byDist.set(r.distance, []);
          byDist.get(r.distance)!.push(r);
        }
        const lines: string[] = [];
        for (const [dist, rs] of byDist) {
          type RR = typeof rs[number];
          const pb = (rs as RR[]).reduce((a, b) => a.time < b.time ? a : b);
          const mm = Math.floor(pb.time / 60), ss = pb.time % 60;
          lines.push(`${dist}: PB ${mm}:${String(ss).padStart(2, "0")} (${format(pb.date, "d MMM yyyy")}${pb.eventName ? " · " + pb.eventName : ""}) — ${rs.length} results [pb-id:${pb.id}]`);
          rs.slice(0, 3).forEach((r: RR) => {
            const m2 = Math.floor(r.time / 60), s2 = r.time % 60;
            lines.push(`  ${format(r.date, "d MMM yyyy")}: ${m2}:${String(s2).padStart(2, "0")}${r.eventName ? " · " + r.eventName : ""} [id:${r.id}]`);
          });
        }
        return { success: true, message: `${recs.length} race results`, data: lines.join("\n") };
      }

      // ── get_athlete_profile ───────────────────────────────────────────────
      case "get_athlete_profile": {
        const p = await prisma.athleteProfile.findUnique({ where: { userId } });
        if (!p) return { success: true, message: "Athlete profile", data: "No athlete profile set." };
        const lines = [
          p.weightKg     != null ? `Weight: ${p.weightKg}kg` : "",
          p.heightCm     != null ? `Height: ${p.heightCm}cm` : "",
          p.dateOfBirth  != null ? `Age: ${new Date().getFullYear() - p.dateOfBirth.getFullYear()} years` : "",
          p.sex                  ? `Sex: ${p.sex}` : "",
          p.maxHeartRate != null ? `Max HR: ${p.maxHeartRate} bpm` : "",
          p.restingHeartRate != null ? `Resting HR: ${p.restingHeartRate} bpm` : "",
          p.manualLT1HR  != null ? `LT1 HR (manual): ${p.manualLT1HR} bpm` : "",
          p.manualLT2HR  != null ? `LT2 HR (manual): ${p.manualLT2HR} bpm` : "",
          p.primaryGoal          ? `Primary goal: ${p.primaryGoal}` : "",
          p.yearsTraining != null ? `Training experience: ${p.yearsTraining} years` : "",
          p.annualGoals          ? `Annual goals: ${JSON.stringify(p.annualGoals)}` : "",
          `Pace unit: ${p.paceUnit}`,
        ].filter(Boolean);
        return { success: true, message: "Athlete profile", data: lines.join("\n") };
      }

      // ── web_search ────────────────────────────────────────────────────────
      case "web_search": {
        const settings = await prisma.aISettings.findUnique({ where: { userId }, select: { tavilyApiKey: true } });
        const TAVILY_KEY = safeDecrypt(settings?.tavilyApiKey) ?? process.env.TAVILY_API_KEY;
        if (!TAVILY_KEY) return { success: false, message: "Web search not configured", data: "No Tavily API key set. Add one in Settings → AI Coach." };
        const query = input.query as string;
        const res = await fetchWithTimeout("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: "basic", max_results: 5, include_answer: true }),
        });
        if (!res.ok) return { success: false, message: "Web search failed.", data: `Tavily error ${res.status}` };
        type TResult = { answer?: string; results: { title: string; url: string; content: string }[] };
        const data = await res.json() as TResult;
        const parts = [
          data.answer ? `Summary: ${data.answer}` : "",
          ...data.results.map(r => `[${r.title}](${r.url})\n${r.content.slice(0, 400)}`),
        ].filter(Boolean);
        return { success: true, message: `Web search: ${query}`, data: parts.join("\n\n") };
      }

      // ── weather_forecast ──────────────────────────────────────────────────
      case "weather_forecast": {
        // Get location from most recent activity
        const lastAct = await prisma.activity.findFirst({
          where: { userId, startLat: { not: null }, startLng: { not: null } },
          orderBy: { startDate: "desc" },
          select: { startLat: true, startLng: true },
        });
        const lat = lastAct?.startLat ?? 59.33; // default: Stockholm
        const lng = lastAct?.startLng ?? 18.07;

        const days = Math.min(7, Math.max(1, (input.days as number) ?? 3));
        const targetDate = input.date ? new Date(input.date as string) : null;
        const endDate = targetDate ?? addDays(new Date(), days);
        const startDate = targetDate ? targetDate : new Date();

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=auto&start_date=${format(startDate, "yyyy-MM-dd")}&end_date=${format(endDate, "yyyy-MM-dd")}`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) return { success: false, message: "Weather fetch failed.", data: `Open-Meteo error ${res.status}` };

        type WData = { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; windspeed_10m_max: number[]; weathercode: number[] } };
        const wdata = await res.json() as WData;
        const d = wdata.daily;

        // WMO weather codes simplified
        const wmoDesc = (code: number) => {
          if (code === 0) return "Clear sky";
          if (code <= 3) return "Partly cloudy";
          if (code <= 48) return "Fog";
          if (code <= 67) return "Rain";
          if (code <= 77) return "Snow";
          if (code <= 82) return "Rain showers";
          return "Thunderstorm";
        };

        const lines = d.time.map((date, i) => `${date}: ${wmoDesc(d.weathercode[i])} · ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}°C · wind ${Math.round(d.windspeed_10m_max[i])}km/h · precip ${d.precipitation_probability_max[i]}%`);
        return { success: true, message: "Weather forecast", data: lines.join("\n") };
      }

      // ── search_training_research ──────────────────────────────────────────
      case "search_training_research": {
        const query   = encodeURIComponent(input.query as string);
        const maxRes  = Math.min(5, Math.max(1, (input.max_results as number) ?? 3));

        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=${maxRes}&retmode=json&sort=relevance`;
        const searchRes = await fetchWithTimeout(searchUrl);
        if (!searchRes.ok) return { success: false, message: "Research search failed.", data: `PubMed error ${searchRes.status}` };
        type ESearch = { esearchresult: { idlist: string[] } };
        const searchData = await searchRes.json() as ESearch;
        const ids = searchData.esearchresult.idlist;
        if (!ids.length) return { success: true, message: "No research found.", data: "No PubMed papers found for this query." };

        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
        const fetchRes = await fetchWithTimeout(fetchUrl);
        if (!fetchRes.ok) return { success: false, message: "Research fetch failed.", data: `PubMed fetch error ${fetchRes.status}` };
        const text = await fetchRes.text();

        return {
          success: true,
          message: `${ids.length} research papers: ${input.query}`,
          data: `PubMed results for "${input.query}":\n\n${text.slice(0, 4000)}`,
        };
      }

      // ── WRITE TOOLS ───────────────────────────────────────────────────────

      case "create_workout": {
        const date = new Date(input.date as string);
        if (isNaN(date.getTime())) return { success: false, message: "Invalid date.", data: "error: invalid date" };
        const workout = await prisma.plannedWorkout.create({
          data: {
            userId,
            name:            input.name as string,
            sportType:       input.sportType as string,
            date,
            targetDuration:  input.targetDurationMin ? Math.round((input.targetDurationMin as number) * 60) : null,
            targetDistance:  input.targetDistanceKm  ? (input.targetDistanceKm as number) * 1000 : null,
            targetIntensity: (input.targetIntensity as string | null) ?? null,
            notes:           (input.notes as string | null) ?? null,
            status:          "planned",
          },
        });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "create_workout", description: `Added "${workout.name}" on ${format(date, "EEE d MMM")}`, previousStateJson: null, newStateJson: workout as unknown as Record<string, unknown>, entityId: workout.id, entityType: "PlannedWorkout" } });
        return { success: true, message: `Added: ${workout.name} · ${format(date, "EEE d MMM")}`, data: `Created workout ${workout.id}`, editId: edit.id };
      }

      case "update_workout": {
        const wid = input.workoutId as string;
        const existing = await prisma.plannedWorkout.findUnique({ where: { id: wid } });
        if (!existing || existing.userId !== userId) return { success: false, message: "Workout not found.", data: "error: not found" };
        const data: Record<string, unknown> = {};
        if (input.date              !== undefined) data.date = new Date(input.date as string);
        if (input.name              !== undefined) data.name = input.name;
        if (input.targetDurationMin !== undefined) data.targetDuration = Math.round((input.targetDurationMin as number) * 60);
        if (input.targetDistanceKm  !== undefined) data.targetDistance = (input.targetDistanceKm as number) * 1000;
        if (input.targetIntensity   !== undefined) data.targetIntensity = input.targetIntensity;
        if (input.notes             !== undefined) data.notes = input.notes;
        const updated = await prisma.plannedWorkout.update({ where: { id: wid }, data });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "update_workout", description: `Updated "${existing.name}"`, previousStateJson: existing as unknown as Record<string, unknown>, newStateJson: updated as unknown as Record<string, unknown>, entityId: wid, entityType: "PlannedWorkout" } });
        return { success: true, message: `Updated: ${updated.name}`, data: `Workout updated`, editId: edit.id };
      }

      case "delete_workout": {
        const wid = input.workoutId as string;
        const existing = await prisma.plannedWorkout.findUnique({ where: { id: wid } });
        if (!existing || existing.userId !== userId) return { success: false, message: "Workout not found.", data: "error: not found" };
        await prisma.plannedWorkout.delete({ where: { id: wid } });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "delete_workout", description: `Deleted "${existing.name}"`, previousStateJson: existing as unknown as Record<string, unknown>, newStateJson: null, entityId: wid, entityType: "PlannedWorkout" } });
        return { success: true, message: `Deleted: ${existing.name}`, data: `Workout deleted`, editId: edit.id };
      }

      case "create_training_block": {
        const block = await prisma.trainingBlock.create({
          data: {
            userId,
            name:            input.name as string,
            blockType:       input.blockType as string,
            startDate:       new Date(input.startDate as string),
            endDate:         new Date(input.endDate as string),
            color:           "#6366f1",
            targetKmPerWeek: (input.targetKmPerWeek as number | undefined) ?? null,
            targetIntensity: (input.targetIntensity as string | undefined) ?? null,
            notes:           (input.notes as string | undefined) ?? null,
          },
        });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "create_training_block", description: `Created ${block.blockType} block "${block.name}"`, previousStateJson: null, newStateJson: block as unknown as Record<string, unknown>, entityId: block.id, entityType: "TrainingBlock" } });
        return { success: true, message: `Created block: ${block.name}`, data: `Block created`, editId: edit.id };
      }

      case "update_training_block": {
        const bid = input.blockId as string;
        const existing = await prisma.trainingBlock.findUnique({ where: { id: bid } });
        if (!existing || existing.userId !== userId) return { success: false, message: "Block not found.", data: "error: not found" };
        const data: Record<string, unknown> = {};
        if (input.name             !== undefined) data.name = input.name;
        if (input.startDate        !== undefined) data.startDate = new Date(input.startDate as string);
        if (input.endDate          !== undefined) data.endDate = new Date(input.endDate as string);
        if (input.targetKmPerWeek  !== undefined) data.targetKmPerWeek = input.targetKmPerWeek;
        if (input.targetIntensity  !== undefined) data.targetIntensity = input.targetIntensity;
        if (input.notes            !== undefined) data.notes = input.notes;
        const updated = await prisma.trainingBlock.update({ where: { id: bid }, data });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "update_training_block", description: `Updated block "${existing.name}"`, previousStateJson: existing as unknown as Record<string, unknown>, newStateJson: updated as unknown as Record<string, unknown>, entityId: bid, entityType: "TrainingBlock" } });
        return { success: true, message: `Updated block: ${updated.name}`, data: `Block updated`, editId: edit.id };
      }

      case "log_race_result": {
        const race = await prisma.raceRecord.create({
          data: {
            userId,
            distance:    input.distance as string,
            distanceM:   input.distanceM as number,
            time:        input.timeSeconds as number,
            date:        new Date(input.date as string),
            eventName:   (input.eventName as string | undefined) ?? null,
            notes:       (input.notes as string | undefined) ?? null,
            isManual:    true,
          },
        });
        const mm = Math.floor(race.time / 60), ss = race.time % 60;
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "log_race_result", description: `Logged ${race.distance} ${mm}:${String(ss).padStart(2,"0")} on ${format(race.date, "d MMM yyyy")}`, previousStateJson: null, newStateJson: race as unknown as Record<string, unknown>, entityId: race.id, entityType: "RaceRecord" } });
        return { success: true, message: `Logged: ${race.distance} ${mm}:${String(ss).padStart(2, "0")}`, data: `Race result logged`, editId: edit.id };
      }

      case "delete_race_result": {
        const rid = input.raceId as string;
        const existing = await prisma.raceRecord.findUnique({ where: { id: rid } });
        if (!existing || existing.userId !== userId) return { success: false, message: "Race result not found.", data: "error: not found" };
        await prisma.raceRecord.delete({ where: { id: rid } });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "delete_race_result", description: `Deleted ${existing.distance} result from ${format(existing.date, "d MMM yyyy")}`, previousStateJson: existing as unknown as Record<string, unknown>, newStateJson: null, entityId: rid, entityType: "RaceRecord" } });
        return { success: true, message: `Deleted race result`, data: `Race result deleted`, editId: edit.id };
      }

      case "update_activity_notes": {
        const actId = input.activity_id as string;
        const existing = await prisma.activity.findUnique({ where: { id: actId }, select: { id: true, userId: true, name: true, description: true } });
        if (!existing || existing.userId !== userId) return { success: false, message: "Activity not found.", data: "error: not found" };
        await prisma.activity.update({ where: { id: actId }, data: { description: input.description as string } });
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "update_activity_notes", description: `Updated notes for "${existing.name}"`, previousStateJson: { description: existing.description } as Record<string, unknown>, newStateJson: { description: input.description } as Record<string, unknown>, entityId: actId, entityType: "Activity" } });
        return { success: true, message: `Updated notes: ${existing.name}`, data: `Activity notes updated`, editId: edit.id };
      }

      case "update_profile": {
        const data: Record<string, unknown> = {};
        if (input.primaryGoal      !== undefined) data.primaryGoal      = input.primaryGoal;
        if (input.yearsTraining    !== undefined) data.yearsTraining    = input.yearsTraining;
        if (input.weightKg         !== undefined) data.weightKg         = input.weightKg;
        if (input.maxHeartRate     !== undefined) data.maxHeartRate     = input.maxHeartRate;
        if (input.restingHeartRate !== undefined) data.restingHeartRate = input.restingHeartRate;
        if (Object.keys(data).length === 0) return { success: false, message: "No fields to update.", data: "error: empty update" };
        const existing = await prisma.athleteProfile.findUnique({ where: { userId } });
        await prisma.athleteProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
        const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", ");
        const edit = await prisma.coachEdit.create({ data: { userId, conversationId, toolName: "update_profile", description: `Updated profile: ${parts}`, previousStateJson: (existing ?? {}) as Record<string, unknown>, newStateJson: data, entityId: userId, entityType: "AthleteProfile" } });
        return { success: true, message: `Profile updated: ${parts}`, data: `Profile updated`, editId: edit.id };
      }

      default:
        return { success: false, message: `Unknown tool: ${toolName}`, data: `error: unknown tool ${toolName}` };
    }
  } catch (e) {
    console.error(`[coach-tool] ${toolName} failed:`, e);
    return { success: false, message: "Tool failed.", data: `error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

