# Cron API

## In-process scheduler (primary mechanism)

`lib/cron.ts` registers `node-cron` jobs via `startCronJobs()`, started once from `instrumentation.ts` on Next.js server boot (`NEXT_RUNTIME === "nodejs"`). This runs inside the same process as the app — no external caller needed. Jobs, for every user with the relevant account connected:

- **06:00** — Strava incremental sync (`syncActivities`, since `lastSyncAt`)
- **08:00** — Garmin sync for yesterday (so overnight sleep/HRV is ready)
- **20:00** — Garmin sync for today + a yesterday catch-up re-sync (late-arriving fields)
- **00:30** — Historical Strava backfill (via `backfillRunner.startIfIdle()`) for activities missing split detail or stream data; cannot run concurrently with a user-triggered backfill for the same account. A daily-limit hit ends the run immediately; resumes automatically the next night.
- **07:00** — Weather backfill, 50 activities/user per run

---

## POST /api/cron/sync

Secondary/manual trigger path — same sync work as the in-process scheduler above, but callable externally (e.g. from a system crontab) instead of relying on the app process's own scheduler.

**Auth:** Bearer token — `Authorization: Bearer <CRON_SECRET>` must match the `CRON_SECRET` env var. No session cookie.

**Request:** No body.

**Response (200):**
```json
{
  "ok": true,
  "results": [
    { "userId": "abc123", "synced": 4 },
    { "userId": "def456", "error": "error message string" }
  ]
}
```

**Response (error):**
```json
{ "error": "unauthorized" }
```

**Side effects:**
- Only processes users with `AppConfig.stravaAutoSyncMode === "cron"` (opt-in — the in-process scheduler above runs for ALL connected accounts regardless of this flag).
- Per user: `syncActivities(userId, { since: lastSyncAt })`, then fires `updateVO2maxAndPaces` and `backfillWeather(userId, 50)` in the background (not awaited).
- A per-user sync failure is caught and recorded in `results`; it does not abort processing of other users.
