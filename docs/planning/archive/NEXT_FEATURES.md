# TrainingLab — Next Features Implementation Plan

> **Status:** 2026-05-20  
> Research-backed implementation plans for three major features.

---

## 1. VDOT & Race Estimates from Training Sessions

### 1A. Problem — Estimation too conservative without frequent racing

Current: VDOT anchored to race PBs. If athlete hasn't raced in 6+ months, estimate degrades with recency decay.

The HR-pace regression already runs but pulls the estimate DOWN because whole-activity avgHR dilutes the pace signal (warm-up + cool-down included in both values).

### 1B. Better: Firstbeat-style submaximal extrapolation

**Algorithm (Firstbeat, validated on 2,690 runners, ±5% MAPE vs lab spirometry):**

```
Step 1: Filter all running activities where avgHR > maxHR × 0.70
        AND duration ≥ 10 min AND NOT interval session
Step 2: For each such run, estimate VO2 at that pace (Daniels formula):
        v = distance / time * 60  (m/min)
        VO2_at_pace = -4.60 + 0.182258v + 0.000104v²
Step 3: Fit weighted linear regression: VO2_at_pace = a + b × avgHR
        (recency-weighted, 180-day half-life)
Step 4: Extrapolate to maxHR:
        VO2max = a + b × maxHR
```

This is the Firstbeat algorithm. It works because the HR-VO2 relationship is linear in the submaximal range, and this slope is consistent across training states.

**Key improvement over current implementation:**
- Use GRADE-ADJUSTED PACE (GAP) instead of raw pace, especially for hilly runs
- This eliminates the biggest source of noise in the regression
- Expected improvement: ±3 bpm less error on LT estimation for hilly-run-heavy athletes

```typescript
// In vo2max.ts — improved HR-pace regression with GAP
function gradeAdjustedPaceSecPerKm(paceSecPerKm: number, elevGainM: number, distM: number): number {
  if (distM < 500) return paceSecPerKm;
  const grade = Math.max(-0.15, Math.min(0.15, elevGainM / distM));
  const factor = grade >= 0 ? 1 + grade * 0.033 : 1 + grade * 0.018;
  return paceSecPerKm / factor;
}
```

### 1C. Tempo run VDOT detection

If an activity has avgHR in **83–90% maxHR** range AND is NOT an interval session, it's likely a tempo/threshold effort. We can extract a VDOT estimate:

```typescript
// For a steady tempo run at avgPace with avgHR = 88% maxHR:
// The athlete is running at ~95% of their threshold pace
// So their actual threshold pace ≈ avgPace × 0.95
// Then: VDOT from threshold pace

function vdotFromTempoRun(avgPaceSecPerKm: number, avgHR: number, maxHR: number): number | null {
  const intensityFraction = avgHR / maxHR;
  if (intensityFraction < 0.82 || intensityFraction > 0.92) return null;
  // At 88% HRmax, runner is at ~88-90% of threshold pace
  // Threshold ≈ tempo_pace / 0.95 (conservative)
  const thresholdPaceSecPerKm = avgPaceSecPerKm / 0.95;
  // Threshold pace is equivalent to ~60 min all-out effort → use 3500m as proxy
  return vdotFromRace(3500, thresholdPaceSecPerKm * 3.5);
}
```

This adds a new candidate source to `estimateVO2max()` — weighted lower than race PBs (0.6×) but higher than easy runs.

### 1D. Implementation priority

1. Add GAP to the HR-pace regression input (affects quality of regression significantly)
2. Add tempo-run VDOT candidates (new candidate source, weighted 0.6×)
3. Both changes go in `lib/fitness/vo2max.ts`
4. The Activity table already has `totalElevationGain` and `distance` for GAP computation

---

## 2. Statistical HR Zone Estimation from Bucketed Training Data

*(See full research: `docs/fitness/hr-zone-statistical-estimation.md`)*

### Summary algorithm

```
1. Collect all runs: filter interval sessions, downweight hot runs (>25°C)
2. Compute grade-adjusted pace (GAP) for each run
3. Compute optimal bucket width (Freedman-Diaconis: typically 12–18 sec/km)
4. Per bucket: compute weighted median HR
5. Fit piecewise linear regression (exhaustive search over breakpoint pairs)
6. Two breakpoints = LT1 and LT2 pace → HR
7. Build non-uniform zones: Z2 narrow, Z3 = LT1-LT2 gap, Z4 narrow at LT2
```

### Integration

New function `estimateZonesFromStatisticalAnalysis()` in `lib/fitness/zones.ts`.

Called from `updateHRZones()` as additional source alongside race PB method. Priority:
1. Manual override (AthleteProfile) → wins
2. Statistical analysis if R² > 0.85 AND ≥ 8 valid buckets
3. Race PB-derived (current method)
4. Fixed percentages (fallback)

### UI component

New `ZoneCalibrationChart` in Stats → Zones tab:
- Scatter: x = GAP (sec/km), y = avgHR, each point = one run
- Bucket medians as large dots
- Piecewise regression line
- Vertical dotted lines at LT1 and LT2
- Zone labels on Y-axis
- R² as confidence indicator

---

## 3. AI Coach — Tool Use (Database Modifications)

### 3A. What the AI should be able to do

| Tool | Action | Parameters |
|---|---|---|
| `create_workout` | Add planned workout to calendar | date, sportType, name, duration, notes, templateId? |
| `update_profile` | Update athlete profile | weightKg?, primaryGoal?, yearsTraining?, notes? |
| `add_note` | Add a text note to today/a date | date, content (stored as PlannedWorkout with no targetDistance) |
| `get_workouts` | Read upcoming plan | days (default 14) |
| `delete_workout` | Remove a planned workout | workoutId |

### 3B. API patterns

**Claude (Anthropic SDK) — `stop_reason: "tool_use"` pattern:**

```typescript
// In chat/route.ts — Claude path
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: COACH_TOOLS,  // array of tool definitions
  system: systemPrompt,
  messages: conversationMessages,
});

if (response.stop_reason === "tool_use") {
  // Execute tool, add result to messages, call API again
  const toolResult = await executeCoachTool(response.content);
  // Then stream the final text response
}
```

**Gemini (Google AI SDK) — `functionDeclarations` pattern:**

```typescript
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
  systemInstruction: systemPrompt,
});

const result = await chat.sendMessage(userText);
const call = result.response.candidates[0].content.parts.find(p => p.functionCall);
if (call) {
  const toolResult = await executeCoachTool(call.functionCall);
  // Send back functionResponse, get final text
}
```

**Key constraint:** Tool calls and text streaming **cannot coexist in one response turn**.
When a tool is called, the stream stops, the tool executes server-side, and a new text response is streamed.

### 3C. Tool definitions

```typescript
const COACH_TOOLS = [
  {
    name: "create_workout",
    description: "Add a planned workout session to the training calendar",
    input_schema: {
      type: "object",
      properties: {
        date:       { type: "string", description: "YYYY-MM-DD" },
        name:       { type: "string", description: "Workout name, e.g. 'Easy 10km'" },
        sportType:  { type: "string", description: "Run|Cycling|NordicSki|etc." },
        targetDurationMin: { type: "number", description: "Target duration in minutes" },
        targetDistanceKm:  { type: "number", description: "Target distance in km" },
        notes:      { type: "string", description: "Additional notes or workout description" },
      },
      required: ["date", "name", "sportType"],
    },
  },
  {
    name: "get_upcoming_plan",
    description: "Fetch the athlete's upcoming planned workouts",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead to fetch (default: 14)" },
      },
    },
  },
  {
    name: "update_athlete_profile",
    description: "Update athlete profile data",
    input_schema: {
      type: "object",
      properties: {
        primaryGoal:   { type: "string" },
        yearsTraining: { type: "number" },
        weightKg:      { type: "number" },
      },
    },
  },
];
```

### 3D. Server-side tool executor

```typescript
// lib/ai/tools.ts
export async function executeCoachTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<string> {
  switch (toolName) {
    case "create_workout": {
      const workout = await prisma.plannedWorkout.create({
        data: {
          userId,
          name: input.name as string,
          sportType: input.sportType as string,
          date: new Date(input.date as string),
          targetDuration: input.targetDurationMin ? (input.targetDurationMin as number) * 60 : null,
          targetDistance: input.targetDistanceKm ? (input.targetDistanceKm as number) * 1000 : null,
          notes: input.notes as string | null,
          status: "planned",
        },
      });
      return `Workout "${workout.name}" created for ${workout.date.toISOString().slice(0, 10)}.`;
    }
    case "get_upcoming_plan": {
      const days = (input.days as number) ?? 14;
      const workouts = await prisma.plannedWorkout.findMany({
        where: { userId, date: { gte: new Date(), lte: addDays(new Date(), days) }, status: "planned" },
        orderBy: { date: "asc" },
      });
      if (workouts.length === 0) return "No planned workouts in the next " + days + " days.";
      return workouts.map(w => `${w.date.toISOString().slice(0,10)}: ${w.name} (${w.sportType})`).join("\n");
    }
    case "update_athlete_profile": {
      await prisma.athleteProfile.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
      });
      return "Athlete profile updated.";
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
```

### 3E. SSE stream changes

The chat route needs a two-phase approach when tools are used:

```
Phase 1: Send prompt to AI
  → If AI returns tool_use: execute, return result, go to Phase 2
  → If AI returns text: stream it normally

Phase 2: Re-send with tool result, stream final text response
```

Tool execution is indicated to the client via:
```
data: {"toolCall": "create_workout", "input": {...}, "result": "Workout created"}
```

The ChatInterface shows a "Coach action: Created workout" card when it receives this event.

### 3F. UI changes (ChatInterface.tsx)

When a `toolCall` event is received:
- Show a compact "action card" in the message stream (not a bubble)
- Card shows: tool name, parameters, result
- Example: "📅 Lade till löppass 10km · Fredag 23 maj"

---

## 4. Priority Order

| # | Feature | Effort | Impact |
|---|---|---|---|
| 1 | **GAP in HR-pace regression** | Low | High — more accurate VDOT |
| 2 | **Tempo-run VDOT candidates** | Low | Medium — helps between races |
| 3 | **Statistical zone estimation** (full algorithm) | High | High — personalized zones |
| 4 | **Zone calibration chart** (scatter + piecewise) | Medium | High — visual insight |
| 5 | **AI tool use** (create_workout, get_plan) | Medium | High — unique feature |
| 6 | **AI update_profile tool** | Low | Medium |

---

*Last updated: 2026-05-20*
