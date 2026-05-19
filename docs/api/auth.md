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
