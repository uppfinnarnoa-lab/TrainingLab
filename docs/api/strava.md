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

**Fields synced per activity:** id, name, description, sportType, startDate, distance, movingTime, elapsedTime, elevationGain, averageSpeed, maxSpeed, averageCadence, averageWatts, averageHeartrate, maxHeartrate, sufferScore, perceivedExertion, workoutType, isRace, mapPolyline, splitsMetric, laps, bestEfforts, startLat, startLng.

---

## GET /api/strava/webhook

Strava webhook verification endpoint. Called by Strava when registering a subscription.

**Query params:**
- `hub.mode` — must equal `"subscribe"`
- `hub.verify_token` — must match `STRAVA_WEBHOOK_VERIFY_TOKEN` env var
- `hub.challenge` — arbitrary string Strava sends; echoed back in response

**Response (200):**
```json
{ "hub.challenge": "<value from query>" }
```

**Response (403):** Returned if `hub.mode` ≠ `subscribe` or `hub.verify_token` doesn't match.

---

## POST /api/strava/webhook

Receives real-time activity events from Strava after a webhook subscription is active.

**Auth:** None (validated by Strava; no session cookie). Events only fire after subscription is registered.

**Request body (Strava event):**
```json
{
  "aspect_type": "create" | "update" | "delete",
  "object_type": "activity" | "athlete",
  "object_id": 12345678,
  "owner_id": 987654,
  "subscription_id": 123
}
```

**Response (200):** Empty body. Always returned immediately; processing is fire-and-forget.

**Side effects:**
- `create` or `update` event on `activity` → calls `syncSingleActivity(userId, stravaActivityId)`, which fetches the full activity from Strava, upserts to DB, and fires weather fetch if coords present.
- `delete` event on `activity` → calls `deleteStravaActivity(userId, stravaActivityId)`.
- `athlete` events are ignored.
- If no `StravaAccount` matches `owner_id`, request is silently dropped.

**Activation (one-time, after deploy to public domain):**
```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://yourdomain.com/api/strava/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

**Required env var:** `STRAVA_WEBHOOK_VERIFY_TOKEN` — any secret string, set in `.env.local`.

---

## POST /api/strava/backfill-weather

Backfills Open-Meteo historical weather for activities that have GPS coordinates but no weather data yet.

**Auth:** Required

**Request:** No body required.

**Response (200):**
```json
{ "processed": 200, "updated": 187, "skipped": 0 }
```

**Side effects:**
- Fetches up to 200 activities with `weatherTemp: null` and non-null `startLat`/`startLng`.
- Calls Open-Meteo archive API per activity with 300ms delay between requests.
- Writes `weatherTemp`, `weatherWind`, `weatherPrecip`, `weatherCode` to each updated activity.
- Activities without coordinates are not processed (indoor/treadmill runs).
