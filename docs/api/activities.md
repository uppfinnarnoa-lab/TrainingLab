# Activities API

## POST /api/activities/[id]/analyze

Streams an AI analysis of a structured workout (Strava `workoutType === 3`). Uses the user's configured AI provider (Claude or Gemini).

**Auth:** Required

**URL params:** `id` — Activity DB ID (string, not Strava ID)

**Request:** No body required.

**Response (200):** `text/plain; charset=utf-8` — streamed plain text (AI analysis prose). Client reads via `ReadableStream` / `getReader()`.

**Response (400):** `{ "error": "not_a_workout" }` — activity `workoutType` ≠ 3.

**Response (401):** `Unauthorized`

**Response (404):** `{ "error": "not_found" }` — no activity with that ID for the authenticated user.

**Prompt content (compact, not raw bulk data):**
- Activity name, date, distance, moving time
- Splits/laps: per-lap distance, pace, HR (if available)
- FitnessCache: VDOT, TSB, thresholdHR
- Weather: temp + wind (if available)

**Model selection:**
- If `aiSettings.provider === "claude"` → `claude-haiku-4-5-20251001` (fast, low cost)
- Otherwise → `gemini-2.0-flash-lite` (free tier)

**Side effects:** None — no DB writes, no cost tracking (analysis is on-demand and not stored).

**Notes:**
- Only available for `workoutType === 3` activities (Strava's "workout" designation — intervals, tempo sessions). The UI gate is also enforced in the client component, but the API validates independently.
- Response is unbuffered streaming — client should handle incremental text append.
