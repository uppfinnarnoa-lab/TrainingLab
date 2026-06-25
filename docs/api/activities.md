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
- If `aiSettings.provider === "nvidia"` / `"groq"` → configured model for that provider (falls back to provider default)
- Otherwise (Gemini, default) → `gemini-2.5-flash`

**Side effects:** None — no DB writes, no cost tracking (analysis is on-demand and not stored).

**Notes:**
- Only available for `workoutType === 3` activities (Strava's "workout" designation — intervals, tempo sessions). The UI gate is also enforced in the client component, but the API validates independently.
- Response is unbuffered streaming — client should handle incremental text append.

---

## PATCH /api/activities/[id]

Set a custom display name for an activity's type (overrides the Strava-derived label in the UI).

**Auth:** Required

**URL params:** `id` — Activity DB ID

**Request:**
```json
{ "customTypeName": "string | null" }
```

**Response (200):** `OK` (plain text body)

**Response (error):**
```text
401 Unauthorized
400 Invalid          // body fails schema validation
404 Not found        // no activity with that ID for the authenticated user
```

**Side effects:** Updates `Activity.customTypeName`.

---

## GET /api/activities/[id]/streams

Fetch per-second Strava stream data (time, distance, altitude, heartrate, velocity, cadence) for an activity, with caching.

**Auth:** Required

**URL params:** `id` — Activity DB ID

**Request:** No body required.

**Response (200):** Strava-shaped stream object, keyed by stream type:
```json
{
  "time": [0, 1, 2],
  "distance": [0.0, 3.1, 6.2],
  "heartrate": [120, 122, 124],
  "velocity_smooth": [3.1, 3.1, 3.2],
  "altitude": [42.0, 42.1, 42.3],
  "cadence": [82, 83, 82]
}
```

**Response (error):**
```json
{ "error": "not_found" }          // 404 — no activity with that ID for the authenticated user
{ "error": "streams_unavailable" } // 503 — Strava fetch failed
```

**Side effects:**
- If `ActivityStream` is already cached for this activity, returns it directly (`Cache-Control: private, max-age=604800`) — no Strava call.
- Otherwise fetches `/activities/:stravaId/streams` from Strava, computes Heart Rate Recovery (`hrrSeconds` — HR drop over 60s following the peak HR sample, requires >70 HR samples), caches the stream rows to `ActivityStream`, and writes `hrrSeconds` to `Activity` (fire-and-forget, doesn't block the response).

**Also populated proactively (2026-06-26):** `ensureActivityStreams()` ([lib/strava/stream-backfill.ts](../../lib/strava/stream-backfill.ts)) fetches and caches the `heartrate`/`time` streams (only — not the other stream types this endpoint returns) for every activity in the rolling 12-week HR-zone window, so `computeZoneTime()` ([lib/fitness/zones.ts](../../lib/fitness/zones.ts)) can classify actual per-second HR into zones instead of lap averages. Only called from `updateVO2maxAndPaces()`, which runs in the background after every sync (never awaited — see `docs/api/strava.md`), so this never blocks a request despite making one Strava call per activity still missing a stream. Idempotent: only fetches the gap each time. This is the one exception to "streams are on-demand only" — scoped specifically to the 12-week zone window, not full history.
