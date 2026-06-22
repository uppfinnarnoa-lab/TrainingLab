# Planner API

## GET /api/planner/workouts

Fetch planned workouts in a date range.

**Auth:** Required

**Query params:** `from` (YYYY-MM-DD), `to` (YYYY-MM-DD) — both optional.

**Response (200):** Array of `PlannedWorkout` objects (see schemas/planned-workout.md).

---

## POST /api/planner/workouts

Create a planned workout.

**Auth:** Required

**Request:**
```json
{
  "date":             "YYYY-MM-DD",
  "name":             "string",
  "sportType":        "string",
  "notes":            "string | null",
  "targetDistance":   "number (meters) | null",
  "targetDuration":   "number (seconds) | null",
  "targetIntensity":  "easy | moderate | quality | null",
  "color":            "#rrggbb | null",
  "templateId":       "cuid | null",
  "typeId":           "cuid | null"  // WorkoutType — must belong to the authenticated user
}
```

**Response (201):** Full `PlannedWorkout` object with nested template and type.

---

## PATCH /api/planner/workouts/[id]

Update a planned workout (reschedule or log outcome).

**Auth:** Required

**Request (all fields optional):**
```json
{
  "date":         "YYYY-MM-DD",
  "name":         "string",
  "sportType":    "string",
  "notes":        "string | null",
  "color":        "#rrggbb | null",
  "status":       "planned | completed | missed | partial",
  "missedReason": "injury | illness | fatigue | travel | work | weather | planned_rest | other | null",
  "missedNote":   "string | null"
}
```

**Response (200):** Updated `PlannedWorkout`.

**Error responses:**
```json
{ "error": "cannot_mark_future" }  // 422 — status set on future workout
{ "error": "not_found" }           // 404 — doesn't exist or wrong user
```

**Business rule:** `status` can only be set to non-"planned" values on or after the workout date (date string comparison, UTC-safe).

---

## DELETE /api/planner/workouts/[id]

Delete a planned workout.

**Auth:** Required. **Response (200):** `{ "ok": true }`.

---

## GET /api/planner/templates

Fetch all workout templates for the user, ordered by sport then name.

**Auth:** Required

**Response (200):** Array of `WorkoutTemplate` with `sections`, `sport`, and `type` nested.

---

## POST /api/planner/templates

Create a workout template.

**Auth:** Required

**Request:**
```json
{
  "name":        "string",
  "description": "string | null",
  "sportId":     "cuid",
  "typeId":      "cuid | null",
  "color":       "#rrggbb | null",
  "sections": [
    {
      "order":          "number",
      "name":           "string",
      "durationType":   "time | distance | open",
      "duration":       "number (seconds) | null",
      "distance":       "number (meters) | null",
      "repetitions":    "number | null",
      "zoneType":       "hr_zone | pace_zone | power_zone | rpe | null",
      "targetZone":     "1-5 | null",
      "targetPaceLow":  "number (sec/km) | null",
      "targetPaceHigh": "number (sec/km) | null",
      "targetHRLow":    "number (bpm) | null",
      "targetHRHigh":   "number (bpm) | null",
      "targetRPE":      "1-10 | null",
      "notes":          "string | null"
    }
  ]
}
```

**Response (201):** Full `WorkoutTemplate` with sections. `estimatedDuration`, `estimatedDistance`, and `estimatedZoneDistribution` are auto-computed from sections.

---

## DELETE /api/planner/templates/[id]

Delete a template (cascades to WorkoutSection rows).

**Auth:** Required. **Response (200):** `{ "ok": true }`.

---

## GET /api/sports

Fetch all sport categories and their workout types.

**Auth:** Required

**Response (200):** Array of `SportCategory` with nested `workoutTypes[]`.

---

## POST /api/sports

Create a sport category or workout type.

**Auth:** Required

**Request (sport):**
```json
{
  "kind":             "sport",
  "name":             "string",
  "color":            "#rrggbb",
  "icon":             "string",
  "order":            "number (optional)",
  "isRunningRelated":  "boolean (optional)"
}
```

**Request (workout type):**
```json
{
  "kind":    "type",
  "name":    "string",
  "sportId": "cuid",
  "color":   "#rrggbb | null",
  "order":   "number (optional)"
}
```

**Response (201):** Created `SportCategory` or `WorkoutType`.

---

## GET /api/planner/blocks

Fetch all training blocks (base/build/peak/taper periodization periods) for the user.

**Auth:** Required

**Response (200):** Array of `TrainingBlock`, ordered by `startDate` asc. `startDate`/`endDate` serialized as `YYYY-MM-DD`.

---

## POST /api/planner/blocks

Create a training block.

**Auth:** Required

**Request:**
```json
{
  "name":             "string",
  "blockType":        "base | build | peak | taper | custom | race",
  "color":            "#rrggbb",
  "startDate":        "YYYY-MM-DD",
  "endDate":          "YYYY-MM-DD",
  "notes":            "string | null",
  "targetKmPerWeek":  "number | null",
  "targetIntensity":  "string | null",
  "targetRaceId":     "cuid | null"
}
```

**Response (201):** Created `TrainingBlock`.

---

## PATCH /api/planner/blocks/[id]

Update a training block (all fields optional, plus `archived`).

**Auth:** Required

**Request:** Same shape as POST, all fields optional, plus:
```json
{ "archived": "boolean (optional)" }
```

**Response (200):** Updated `TrainingBlock`.

**Response (error):** `{ "error": "not_found" }` — 404, doesn't exist or wrong user. `{ "error": "invalid" }` — 400.

---

## DELETE /api/planner/blocks/[id]

Delete a training block.

**Auth:** Required. **Response (200):** `{ "ok": true }`. **Response (404):** `{ "error": "not_found" }` if not owned.
