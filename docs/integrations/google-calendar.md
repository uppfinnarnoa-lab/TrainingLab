# Google Calendar Integration

One-way sync: planned workouts (`PlannedWorkout`) → the user's Google Calendar, as all-day events. Not two-way — edits made directly in Google Calendar are never read back into TrainingLab.

## Data flow

```
PlannedWorkout created/edited/deleted (Planner UI)
  → app/api/planner/workouts/route.ts (POST) / [id]/route.ts (PATCH, DELETE)
    → lib/google-calendar/sync.ts: createEvent / updateEvent / deleteEvent
      → lib/google-calendar/client.ts: googleCalendarFetch (token refresh + REST call)
        → Google Calendar API v3
```

All calendar calls are fire-and-forget from the planner routes (same pattern as the existing weather-fetch side effect in `lib/strava/sync.ts`) — a Google API failure never blocks or fails a planner CRUD operation.

## Scope and event shape

- OAuth scope: `https://www.googleapis.com/auth/calendar.events` — events-only, not the full `calendar` scope. The app can create/update/delete events it created; it can never read other events, modify calendar settings, or see other calendars.
- Events are **all-day** (`start: { date: "YYYY-MM-DD" }`, not `dateTime`) — `PlannedWorkout.date` has no time-of-day, and Google's Calendar API doesn't expose a way to set a custom default reminder time for all-day events anyway, so a timed event wouldn't have bought anything without also adding a "preferred workout time" setting (a decision deliberately deferred — see `docs/planning/archive/GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md` §4 if that's revisited later).
- **Google all-day event quirk:** `end.date` is *exclusive* — a one-day event on 2026-06-24 needs `start.date: "2026-06-24"` and `end.date: "2026-06-25"` (the day after). Handled in `lib/google-calendar/sync.ts`'s `toAllDayRange()`.
- Title = `PlannedWorkout.name` (prefixed `✓ ` / `✗ ` once a workout is marked completed/missed). Description = sport type + notes + a short per-section summary if the workout has a linked `WorkoutTemplate`.

## Setting up a Google Cloud OAuth client (one-time, per-deployment)

This is a manual step in a browser — done once by whoever administers the TrainingLab instance, not per-user.

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and create a project (or reuse an existing one).
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless using Google Workspace).
   - Add the `calendar.events` scope under "Scopes".
   - Add yourself as a **Test user** while the app is in "Testing" mode.
   - ⚠️ **Important:** apps in "Testing" mode have refresh tokens that expire after ~7 days, which would silently break the sync weekly. Once you've confirmed it works, go to **Publishing status** and move the app to **"In production"**. For a `calendar.events`-only scope (a "sensitive", not "restricted", scope) this does **not** require Google's verification review — it's a one-click change.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `https://training.helgars.se/api/google-calendar/callback` (add `http://localhost:3000/api/google-calendar/callback` too if testing locally).
5. Copy the **Client ID** and **Client Secret** — paste them into TrainingLab under **Settings → Integrations → Google Calendar** (visible to admins).
6. Each user (including the admin) then clicks **"Connect with Google"** on that same card to authorize their own calendar — the Client ID/Secret above is shared infrastructure (one Cloud project for the whole self-hosted instance), but each user's resulting access/refresh tokens are their own, stored per-user exactly like Strava/Garmin.

## Token storage and refresh

Same pattern as `StravaAccount`/`GarminAccount`: `GoogleCalendarAccount.accessToken`/`refreshToken` are AES-256-GCM encrypted (`lib/encrypt.ts`), refreshed on demand by `lib/google-calendar/client.ts`'s `refreshGoogleToken()` (in-flight requests for the same user are de-duplicated, same as Strava's `refreshStravaToken()`).

Google's refresh response does **not** include a new `refresh_token` (unlike Strava, which rotates it every time) — only `accessToken`/`expiresAt` are updated on refresh; the original `refreshToken` is kept.

If a refresh fails with `invalid_grant` (the user revoked access in their Google account, or — in Testing mode — the 7-day expiry above), `GoogleCalendarAccount.needsReconnect` is set to `true`. The Settings card surfaces this as "Connection broken — reconnect" instead of silently failing on every subsequent planner edit.

## Per-event error handling

A Google Calendar event can disappear without TrainingLab knowing (user deletes it directly in the Google Calendar app, or deletes the whole calendar). The next `updateEvent`/`deleteEvent` call against that `googleEventId` gets a `404` from the Calendar API — `lib/google-calendar/client.ts` throws a distinct `GoogleCalendarNotFoundError` for this, and `updateEvent()` in `lib/google-calendar/sync.ts` handles it specifically: clears the stale `googleEventId` and recreates the event, rather than letting an unrelated error propagate. `deleteEvent()` treats a 404 as success (already gone).

`5xx`/network errors get a short retry-with-backoff (2 retries, linear) inside `googleCalendarFetch()` before giving up.

## Manual backfill

Planner routes only sync **future** activity going forward. A user connecting Google Calendar for the first time (or after a long gap) can click **"Push upcoming workouts to calendar"** on the Settings card — `POST /api/google-calendar/sync` — which finds every `PlannedWorkout` from today onward with no `googleEventId` and creates an event for each. Past workouts are never pushed (no reason to backfill history into a calendar).
