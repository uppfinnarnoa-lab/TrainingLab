# Google Calendar API

See `docs/integrations/google-calendar.md` for the OAuth setup, scope, and sync design.

## GET /api/google-calendar/callback

OAuth callback. Called by Google after the user authorizes.

**Query params:** `code` (string), `error` (string, optional), `state` (string)

**Side effects:** Upserts `GoogleCalendarAccount` with encrypted tokens, then calls `ensureDedicatedCalendar()` (see `docs/integrations/google-calendar.md`) to create the user's "TrainingLab" calendar on first connect. Redirects to `/settings?google=connected`, or an error variant.

**Error codes (as redirect query param):**
- `denied` — user denied OAuth or `error` param present
- `csrf` — state verification failed
- `no_refresh_token` — Google didn't return a refresh token (shouldn't happen given `access_type=offline&prompt=consent` on the auth URL; guarded explicitly rather than storing an account that can never refresh)
- `calendar_create_failed` — token exchange succeeded but creating the dedicated calendar failed (most likely the OAuth consent screen hasn't been updated to include the `calendar.app.created` scope yet)
- `error` — token exchange failed

---

## POST /api/google-calendar/sync

Explicit, user-initiated backfill — pushes every future `PlannedWorkout` with no `googleEventId` to the calendar as a new event. Never touches past workouts.

**Auth:** Required

**Request:** No body.

**Response (200):**
```json
{ "pushed": 4, "errors": 0 }
```

---

## POST /api/google-calendar/disconnect

Deletes the user's `GoogleCalendarAccount` row (revokes nothing on Google's side — the user can do that themselves at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) if desired). Existing calendar events are left as-is; `PlannedWorkout.googleEventId` values are not cleared, so reconnecting later resumes updating the same events.

**Auth:** Required

**Request:** No body. **Response (200):** `{ "ok": true }`.
