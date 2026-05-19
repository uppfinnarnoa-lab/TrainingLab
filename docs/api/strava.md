# Strava API

## GET /api/strava/callback

OAuth callback. Called by Strava after user authorises.

**Query params:** `code` (string), `error` (string, optional)

**Side effects:** Upserts `StravaAccount` with tokens. Redirects to `/settings?strava=connected` or `/settings?strava=denied`.

**Error codes:**
- `denied` — user denied OAuth or `error` param present
- `error` — token exchange failed

---

## POST /api/strava/sync

Trigger activity sync from Strava.

**Auth:** Required

**Request:**
```json
{ "full": "boolean (default: false)" }
```

**Response (200):**
```json
{
  "synced": 42,
  "errors": 3,
  "lastSyncAt": "2025-10-20T06:00:00.000Z"
}
```

**Error responses:**
```json
{ "error": "strava_not_connected" }   // 400 — no StravaAccount for user
{ "error": "sync_failed" }            // 500 — unexpected error
```

**Side effects:**
- Upserts `Activity` rows from Strava (paginated, 200/page).
- `full: true` → fetches all history; `full: false` → fetches since `lastSyncAt`.
- Updates `StravaAccount.lastSyncAt` and `totalSynced` on success.
- Respects Strava rate limit (200 req/15 min). Backs off with 1s delay per page.

**Fields synced per activity:** id, name, description, sportType, startDate, distance, movingTime, elapsedTime, elevationGain, averageSpeed, maxSpeed, averageCadence, averageWatts, averageHeartrate, maxHeartrate, sufferScore, perceivedExertion, workoutType, isRace, mapPolyline, splitsMetric, laps, bestEfforts.
