# Auth API

## POST /api/auth/[...nextauth]

Handled by NextAuth v5. Supports email/password credentials.

**Sign in request:**
```json
{ "email": "user@example.com", "password": "password123" }
```

**Session token** is a JWT stored in an HTTP-only cookie. All protected routes check this via `auth()` middleware.

**Side effects:** Creates a `Session` row in DB on login. Deletes it on sign-out.

---

## POST /api/settings/profile

Save athlete physical profile.

**Auth:** Required

**Request:**
```json
{
  "name":             "string | null",
  "weightKg":         "number | null",
  "heightCm":         "number | null",
  "dateOfBirth":      "YYYY-MM-DD | null",
  "sex":              "male | female | other | null",
  "maxHeartRate":     "number | null",
  "restingHeartRate": "number | null",
  "primaryGoal":      "string | null",
  "yearsTraining":    "number | null"
}
```

**Response (200):** `{ "ok": true }`

**Side effects:** Upserts `AthleteProfile`, updates `User.name` if provided.

---

## POST /api/settings/ai

Save AI provider settings.

**Auth:** Required

**Request:**
```json
{
  "provider":          "claude | gemini",
  "claudeApiKey":      "string (optional)",
  "geminiApiKey":      "string (optional)",
  "monthlyBudgetUsd":  "number"
}
```

**Response (200):** `{ "ok": true }`

**Side effects:** Upserts `AISettings`. Keys stored as-is (encrypted at rest relies on DB-level security).

---

## GET /api/settings/credentials

Check which Strava/Garmin app credentials are configured (own-app OAuth client overrides).

**Auth:** Required

**Response (200):**
```json
{
  "hasStravaClientId":     true,
  "hasStravaClientSecret": true,
  "hasGarminClientId":     false,
  "hasGarminClientSecret": false,
  "stravaClientIdHint":    "1234…"
}
```

Booleans are true if set via `AppConfig` **or** the matching env var fallback. Secrets are never returned — only presence + a 4-char hint for the client ID.

---

## POST /api/settings/credentials

Save own-app Strava/Garmin OAuth client credentials.

**Auth:** Required

**Request:**
```json
{
  "stravaClientId":     "string | null (optional)",
  "stravaClientSecret": "string | null (optional)",
  "garminClientId":     "string | null (optional)",
  "garminClientSecret": "string | null (optional)"
}
```

Only fields present in the body are updated.

**Response (200):** `{ "ok": true }`

**Response (error):** `{ "error": "invalid" }` — 400, zod validation failed

**Side effects:** Upserts `AppConfig`. Secrets encrypted before storing. Invalidates the in-memory credentials cache.

---

## DELETE /api/settings/account

Delete the current user's account.

**Auth:** Required

**Request:** No body.

**Response (200):** `{ "ok": true }`

**Side effects:** Deletes the `User` row. Cascades to all owned data (activities, Strava/Garmin accounts, plans, conversations, etc. per Prisma schema relations).

---

## POST /api/settings/password

Change the current user's password.

**Auth:** Required

**Request:**
```json
{ "currentPassword": "string", "newPassword": "string (min 8 chars)" }
```

**Response (200):** `{ "ok": true }`

**Response (error):**
```json
{ "error": "Too many attempts. Try again in <n>s." }   // 429 — max 5 attempts / 15 min per user
{ "error": "<zod message>" }                            // 400 — invalid input
{ "error": "not_found" }                                // 404 — user row missing
{ "error": "wrong_password" }                           // 422 — currentPassword doesn't match
```

**Side effects:** Updates `User.passwordHash` (bcrypt, cost 12).

---

## GET /api/settings/goals

List the current user's training goals.

**Auth:** Required

**Response (200):** Array of `TrainingGoal` rows, ordered by `createdAt` ascending.

```json
[
  { "id": "string", "userId": "string", "sport": "string", "metric": "distance | time", "period": "week | month | year", "target": 100, "createdAt": "..." }
]
```

---

## POST /api/settings/goals

Create or update a training goal (upsert keyed on sport+metric+period).

**Auth:** Required

**Request:**
```json
{
  "sport":  "string (default: \"\" = all sports combined)",
  "metric": "distance | time",
  "period": "week | month | year",
  "target": "number (positive)"
}
```

**Response (200):** The upserted `TrainingGoal` row.

**Response (error):** `{ "error": "invalid_input" }` — 400, zod validation failed

**Side effects:** Upserts `TrainingGoal` on unique key `(userId, sport, metric, period)`.

---

## DELETE /api/settings/goals (`?id=` query param)

Delete a training goal.

**Auth:** Required

**Query params:** `id` (string, required)

**Response (200):** `{ "ok": true }`

**Response (error):** `{ "error": "missing_id" }` — 400

**Side effects:** Deletes the `TrainingGoal` row scoped to `id` + `userId` (no-op if not owned/found — `deleteMany` doesn't error on zero matches).
