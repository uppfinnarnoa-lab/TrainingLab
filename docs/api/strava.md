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

## GET /api/strava/webhook/[secret]

Strava webhook verification endpoint. Called by Strava when registering a subscription.

Strava doesn't sign POST event payloads, so the shared secret lives in the URL **path**
(`[secret]`), not a query param — Strava appends its own `hub.*` params to whatever
`callback_url` was registered, and a query-string secret risks colliding with that append
if Strava doesn't insert the `&` correctly (confirmed live: it doesn't — a literal extra
`?` makes `hub.mode` unparseable and the GET handshake fail). A path segment can't collide
with query params at all.

**Path param:**
- `secret` — must match the live `AppConfig.stravaWebhookToken` (or `STRAVA_WEBHOOK_VERIFY_TOKEN` env var fallback)

**Query params:**
- `hub.mode` — must equal `"subscribe"`
- `hub.verify_token` — must also match the same token
- `hub.challenge` — arbitrary string Strava sends; echoed back in response

**Response (200):**
```json
{ "hub.challenge": "<value from query>" }
```

**Response (403):** Returned if `hub.mode` ≠ `subscribe`, the path secret doesn't match, or `hub.verify_token` doesn't match.

---

## POST /api/strava/webhook/[secret]

Receives real-time activity events from Strava after a webhook subscription is active.

**Auth:** Path `secret` must match the live `stravaWebhookToken` (no session cookie — Strava can't authenticate any other way).

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

**Activation:** done through the Settings UI ("Register with Strava" button → `POST /api/strava/webhook-subscription`), which generates the secret, saves it to `AppConfig.stravaWebhookToken`, and registers `callback_url=https://yourdomain.com/api/strava/webhook/<secret>` with Strava automatically. No manual `curl` needed.

**Required env var:** `STRAVA_WEBHOOK_VERIFY_TOKEN` — fallback only, used if no `AppConfig` row has a token set.

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
