# Garmin API

See `docs/integrations/strava.md` → "Garmin Connect" for the auth flow rationale (ticket-based SSO, why two strategies exist). This doc covers only the HTTP contract.

## POST /api/garmin/connect

Server-side login with Garmin email/password (fallback path — mobile JSON API / HTML form).

**Auth:** Required

**Request:**
```json
{ "email": "user@example.com", "password": "string" }
```

**Response (200):**
```json
{ "ok": true, "displayName": "string" }
```

**Response (error):**
```json
{ "error": "invalid_input" }        // 400 — zod validation failed
{ "error": "too_many_attempts" }    // 429 — rate limited, 5 attempts / 10 min per user
{ "error": "mfa_required" }         // 422 — Garmin account has MFA enabled, unsupported
{ "error": "invalid_credentials" }  // 401 — wrong email/password
{ "error": "server_blocked" }       // 502 — Garmin returned 403 (bot detection); check /api/garmin/diagnose
{ "error": "auth_failed" }          // 502 — any other login failure
```

**Side effects:** Upserts `GarminAccount` with AES-256-GCM encrypted `oauth1Token`, `oauth1Secret`, `accessToken`, `refreshToken`. Email/password never persisted. Rate-limited per user to avoid Garmin IP bans.

---

## GET /api/garmin/callback

Redirect target after Garmin's `/sso/embed` browser SSO completes (primary auth path, when reachable). Exchanges the `ticket` query param through OAuth1 → OAuth2.

**Auth:** Required (redirects to `/login` if no session)

**Query params:** `ticket` (string, the `ST-...` service ticket)

**Response:** Redirect, no JSON body.
- `/settings?garmin=connected` — success
- `/settings?garmin=no_ticket` — no `ticket` param present
- `/settings?garmin=error` — token exchange failed

**Side effects:** Upserts `GarminAccount` (`displayName`, encrypted `accessToken`/`refreshToken`, `expiresAt`). Does not store `oauth1Token`/`oauth1Secret` (unlike `/exchange-ticket`).

---

## POST /api/garmin/exchange-ticket

Manual-paste path: user copies the `ST-...` ticket shown by Garmin's SSO page and submits it here directly (the live flow, since `/sso/embed` can't redirect back to our domain — see `docs/integrations/strava.md`).

**Auth:** Required

**Request:**
```json
{ "ticket": "ST-..." }
```

**Response (200):**
```json
{ "ok": true, "displayName": "string" }
```

**Response (error):**
```json
{ "error": "invalid_ticket" }                          // 400 — missing or doesn't start with "ST-"
{ "error": "exchange_failed", "detail": "string" }     // 502 — OAuth1/OAuth2 exchange failed
```

**Side effects:** Upserts `GarminAccount` with encrypted `oauth1Token`, `oauth1Secret`, `accessToken`, `refreshToken`, `expiresAt`, `displayName`.

---

## GET /api/garmin/ticket-receiver

Returns a static HTML page that `postMessage`s a service ticket (or error) back to the opener/parent window. Intended as the redirect target for Garmin's `/sso/embed`, but currently unreachable — Garmin's service-URL whitelist rejects this domain, so Garmin never redirects here in practice. Kept in case that changes; the live flow uses `/exchange-ticket` with manual paste instead.

**Auth:** None

**Query params:** `ticket` (string, optional), `error` (string, optional)

**Response (200):** `text/html` — script that does `window.opener.postMessage({ garminTicket } | { garminError }, "*")` then closes itself if opened as a popup.

**Side effects:** None (no DB writes).

---

## POST /api/garmin/sync

Sync Garmin daily wellness data for the current day.

**Auth:** Required

**Request:** No body.

**Response (200):**
```json
{ "ok": true, "gotData": true }
```

`gotData` (boolean) — whether Garmin actually returned wellness data for today (Garmin may not have synced the watch yet).

**Response (error):**
```json
{ "error": "unauthorized" }   // 401
{ "error": "sync_failed" }    // 500 — unexpected error calling Garmin
```

**Side effects:** Upserts a `GarminDailySummary` row (resting HR, body battery, respiration, stress, steps, sleep, HRV, training readiness, SpO2 — see `docs/integrations/strava.md` for the full field list).

---

## POST /api/garmin/backfill

Streams a multi-day backfill of Garmin daily wellness data via SSE, so the client can render a progress bar. Runs sequentially with a 300ms pacing delay between days (Garmin's unofficial API is bot-detection-sensitive).

**Auth:** Required

**Request:**
```json
{ "days": "number (default/max 730, min 1)" }
```

**Response (200):** `text/event-stream`. Each event is `data: <json>\n\n`:
```json
{ "type": "start", "total": 730 }
{ "type": "progress", "done": 1, "total": 730, "synced": 1, "empty": 0, "failed": 0 }
{ "type": "done", "done": 730, "total": 730, "synced": 700, "empty": 25, "failed": 5 }
```

**Response (error):**
```json
{ "error": "unauthorized" }                                  // 401
{ "error": "rate_limited", "retryAfter": 1234 }               // 429 — max 3 backfills / hour per user
```

**Side effects:** Calls `syncGarminDaily` once per day for up to 2 years back, upserting `GarminDailySummary` rows. `synced`/`empty`/`failed` counts reflect per-day outcomes (`failed` does not abort the run).

---

## GET /api/garmin/diagnose

Debug endpoint — fetches Garmin's raw `/sso/embed` page server-side to inspect why login/SSO might be failing (e.g. WAF block, page structure change).

**Auth:** Required

**Request:** No body.

**Response (200):** Shape of `diagnoseSsoPage()` result — diagnostic info about the fetched SSO page (status, headers, body snippet). Not a stable contract; for manual debugging only.

**Side effects:** None (no DB writes). Makes one outbound request to Garmin.

---

## POST /api/garmin/disconnect

Remove the user's Garmin connection.

**Auth:** Required

**Request:** No body.

**Response (200):** `{ "ok": true }`

**Side effects:** Deletes the `GarminAccount` row for the user. Does not delete previously synced `GarminDailySummary` rows.
