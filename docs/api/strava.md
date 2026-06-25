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
{
  "full":   "boolean (default: false)",
  "resync": "boolean (default: false)"  // manual smart resync of the last 3 days, takes priority over full/since
}
```

**Response (200):**
```json
{
  "synced": 42,
  "errors": 3,
  "lastSyncAt": "2025-10-20T06:00:00.000Z"
}
```

**Response (rate limited, still 200):**
```json
{ "error": "Strava daily limit reached — try again tomorrow.", "synced": 12 }
{ "error": "Strava rate limit reached — try again in 15 minutes.", "synced": 12 }
```

**Error responses:**
```json
{ "error": "strava_not_connected" }   // 400 — no StravaAccount for user
{ "error": "sync_failed" }            // 500 — unexpected error
```

**Side effects:**
- `resync: true` → calls `resyncRecentActivities(userId, 3)`, re-fetching the last 3 days regardless of `lastSyncAt` (catches edits/deletes Strava's webhook may have missed). Re-fetches and writes `name`/`description`/`workoutType`/`isRace`/`splitsMetric`/`laps`/`bestEfforts`/`sufferScore`/`perceivedExertion` whenever the description, race flag, or workout type changed on Strava since the last sync — until 2026-06-25, `workoutType`/`isRace` were never refreshed on an already-synced activity by this path (or by the daily incremental sync / webhook update event below), so retroactively flagging/unflagging a race on Strava never propagated locally.
- Otherwise upserts `Activity` rows from Strava (paginated, 200/page): `full: true` → fetches all history; `full: false` → fetches since `lastSyncAt`.
- Updates `StravaAccount.lastSyncAt` and `totalSynced` on success.
- Respects Strava rate limit (200 req/15 min). Backs off with 1s delay per page.
- Fires `updateVO2maxAndPaces` and `backfillWeather(userId, 50)` in the background (not awaited) after a successful sync.

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

---

## GET/POST /api/strava/backfill-splits

Backfills per-activity detail (description, splits, laps, best efforts, suffer score) for activities not yet detail-fetched (`splitDetailFetched: false`).

**Auth:** Required

**Long-running SSE streaming endpoint** — nginx disables proxy buffering for this path (see `deployment/README.md`) so progress events reach the client immediately.

**GET — progress check:**
**Response (200):** `{ "total": 500, "missing": 42, "done": false }`

**POST — run backfill:**
- Default (no `?stream=true`): processes one batch (`?batch=N`, default 30, max 50) and returns `{ "done": boolean, "updated": number, "errors": number, "remaining": number, "total": number }`.
- `?stream=true`: SSE stream of all pending activities, respecting Strava's rate limit (170 req/15min burst, 5.1s delay between requests). Events: `{"type":"start","total":N}`, `{"type":"progress","updated":N,"total":N,"errors":N}`, `{"type":"rate_limit","waitMs":N,"updated":N,"total":N}`, `{"type":"done","updated":N,"errors":N,"total":N}`, `{"type":"error","message":"..."}`.

**Side effects:** Per activity, fetches `/activities/:stravaId` from Strava and writes `description`, `splitsMetric`, `bestEfforts`, `laps`, `sufferScore`, `splitDetailFetched: true`.

---

## GET/POST /api/strava/backfill-descriptions

Backfills descriptions (and the same detail fields as backfill-splits) for activities with `description: null`.

**Auth:** Required

**Long-running SSE streaming endpoint** — same nginx no-buffering treatment as backfill-splits (see `deployment/README.md`).

**GET — progress check:**
**Response (200):** `{ "total": 500, "missing": 12, "done": false }`

**POST — run backfill:** Same shape and SSE event types as `/api/strava/backfill-splits` (default batch of 30/up to 50 without `?stream=true`; full SSE stream with rate-limit handling when `?stream=true`).

**Side effects:** Per activity, fetches `/activities/:stravaId` from Strava and writes `description`, `splitsMetric`, `bestEfforts`, `laps`, `sufferScore`, `splitDetailFetched: true`.

---

## GET/PATCH/POST /api/strava/backfill-history

Runs the historical activity backfill job (fetches full Strava history in the background, resumable across rate limits/restarts).

**Auth:** Required

**Long-running SSE streaming endpoint** — same nginx no-buffering treatment as the other backfill endpoints (see `deployment/README.md`).

**GET:** Returns current job status from `backfillRunner` (in-memory, no DB query) — `{ "status": "idle" | "running" | "paused" | "waiting" | "done", ... }`.

**PATCH:**
```json
{ "action": "pause" | "resume" | "stop" }
```
**Response (200):** Updated job status.

**POST:** Starts the backfill (or attaches to an already-running job) and returns an SSE stream of `BackfillEvent`s. If a job is already active, the new connection receives a `{"type":"status",...}` snapshot first, then live events. Stream closes on `{"type":"done"}` or `{"type":"stopped"}`.

**Side effects:** Drives `backfillRunner` (in-process singleton, keyed by `userId`), which paginates through the user's full Strava history and fetches per-activity detail, persisting progress so it can resume after a rate limit or process restart.
