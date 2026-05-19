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
  "templateId":       "cuid | null"
}
```

**Response (201):** Full `PlannedWorkout` object with nested template.

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
  "kind":  "sport",
  "name":  "string",
  "color": "#rrggbb",
  "icon":  "string",
  "order": "number (optional)"
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
