# Implementation Plan: Multi-User Support

**Status:** Awaiting approval  
**Scope:** Auth, registration, admin approval, data isolation audit, security review  
**Date:** 2026-06-03

---

## 1. Overview

Add support for a small closed group of trusted users. No public registration — users sign up and wait for admin approval before they can access anything. All user data must be strictly isolated at every layer.

**Users in scope:** 1 admin (you) + a handful of approved friends.  
**Not in scope:** Public SaaS, billing, GDPR tooling, email infrastructure.

---

## 2. Feature Specification

### 2.1 Landing / Login page

Replace (or supplement) the current `/login` with a landing page that also offers account registration.

- **Landing page** (`/`) — currently redirects to `/dashboard` when logged in, or `/login` when not. Change to a proper landing page with an app description and two CTAs: "Sign in" and "Request access".
- **Register form** — email + password + name. On submit: creates a user with `status: "pending"`. User sees a "Your account is pending admin approval" message. They cannot access any dashboard routes.
- **Login form** — existing logic, but now checks `status === "active"` before allowing session creation. Pending/rejected users see a clear message.

### 2.2 User statuses

Add a `status` field to the `User` model:

```
enum UserStatus {
  pending   // just registered, not yet reviewed
  active    // approved by admin, full access
  rejected  // denied by admin
}
```

All dashboard routes (middleware) check `status === "active"`. Pending users land on a "waiting for approval" page.

### 2.3 Admin role

Add `isAdmin: Boolean` (default `false`) to the `User` model. Your existing account gets `isAdmin = true` via a one-time migration.

Admin capabilities (exposed in Settings → Users tab, visible only to admins):
- See all users: email, name, status, registered date, last active
- Approve pending accounts (sets `status = "active"`)
- Reject pending accounts (sets `status = "rejected"`, optionally sets a rejection note)
- Revoke access from active users (sets `status = "rejected"`)

**No self-service admin promotion** — admin flag can only be set directly in the database. There is no UI or API endpoint that grants admin status.

### 2.4 Data isolation audit

Before launch, every data access path must be verified to be scoped to `userId`. See Section 4.

---

## 3. Implementation Steps

### Step 1 — Schema changes

In `prisma/schema.prisma`:

```prisma
enum UserStatus {
  pending
  active
  rejected
}

model User {
  // existing fields ...
  status    UserStatus @default(pending)
  isAdmin   Boolean    @default(false)
}
```

Migration:
- `UPDATE "User" SET status = 'active'` for existing users (so you don't lock yourself out).
- `UPDATE "User" SET "isAdmin" = true WHERE email = '<your-email>'` for your account.

### Step 2 — Auth middleware update

`middleware.ts` (or the NextAuth middleware):
- Fetch user from DB on every protected request.
- If `status !== "active"` → redirect to `/pending` (a simple "awaiting approval" page).
- Admin routes (`/settings` admin tab, `/api/admin/**`) additionally check `isAdmin === true`.

Session token should include `status` and `isAdmin` so the middleware doesn't need an extra DB query on every request — include them in the JWT callback in `auth.ts`.

### Step 3 — Registration flow

**New files:**
- `app/(auth)/register/page.tsx` — registration form (email, name, password × 2)
- `app/api/auth/register/route.ts` — POST endpoint: validates input, checks email not taken, hashes password, creates user with `status: "pending"`, returns success

**Landing page:**
- `app/page.tsx` — if logged in → redirect to dashboard. If not → show landing with "Sign in" + "Request access" buttons.

**Pending page:**
- `app/(auth)/pending/page.tsx` — "Your account is awaiting admin approval. You'll be able to sign in once approved."

### Step 4 — Admin UI

In `app/(dashboard)/settings/page.tsx` (or a new tab):
- Render a "Users" tab **only** when `session.user.isAdmin === true`
- Table: user email, name, status badge, registered date
- Per-row action buttons: Approve / Reject / Revoke

**New API endpoints:**
- `GET  /api/admin/users` — list all users (admin only)
- `POST /api/admin/users/[id]/approve` — set `status = "active"`
- `POST /api/admin/users/[id]/reject`  — set `status = "rejected"`

All admin endpoints verify `isAdmin === true` from the session before touching anything.

### Step 5 — Login gating

In `auth.ts` (NextAuth credentials provider):
- After password check: also verify `user.status === "active"`.
- If `status === "pending"` → throw `"pending"` error → login page shows "Awaiting approval".
- If `status === "rejected"` → throw `"rejected"` error → login page shows "Access denied".

### Step 6 — Data isolation verification (see Section 4)

### Step 7 — Security audit (see Section 5)

### Step 8 — Smoke test

- Register as a new user → cannot access dashboard
- Admin approves → user can log in
- Admin rejects → user sees "access denied"
- Admin's data is not visible to the other user and vice versa
- All API endpoints return 401/403 when called without valid session

---

## 4. Data Isolation Audit

Every DB query must be scoped to the authenticated user's `userId`. Run through each file below and verify the pattern `where: { userId: session.user.id }` (or equivalent join) is present on every query that touches user data.

### Files to audit

| File | Tables accessed | Risk |
|------|----------------|------|
| `app/(dashboard)/stats/page.tsx` | Activity, FitnessCache, GarminDailySummary, RaceRecord, AthleteProfile | High — many queries |
| `app/(dashboard)/activities/page.tsx` | Activity | Medium |
| `app/(dashboard)/activities/[id]/page.tsx` | Activity | Medium — verify ID ownership |
| `app/(dashboard)/history/page.tsx` | Activity | Medium |
| `app/(dashboard)/races/page.tsx` | RaceRecord | Medium |
| `app/(dashboard)/planner/page.tsx` | WorkoutPlan, WorkoutTemplate | Medium |
| `app/(dashboard)/dashboard/page.tsx` | Activity, FitnessCache | Medium |
| `app/api/strava/sync/route.ts` | Activity, FitnessCache | High |
| `app/api/strava/webhook/route.ts` | Activity | **Critical** — webhook events must be matched to userId via stravaAthleteId, not trusted blindly |
| `app/api/coach/chat/route.ts` | Activity, FitnessCache, AthleteProfile | High |
| `app/api/coach/calibrate/route.ts` | FitnessCache, AthleteProfile | High |
| `app/api/planner/workouts/route.ts` | WorkoutPlan | Medium |
| `app/api/planner/templates/route.ts` | WorkoutTemplate | Medium — check if templates are per-user or global |
| `app/api/races/*/route.ts` | RaceRecord | Medium |
| `app/api/activities/[id]/analyze/route.ts` | Activity | **Critical** — must verify activity belongs to session user |
| `lib/fitness/cache.ts` | FitnessCache | High — called from cron, must pass correct userId |
| `lib/cron.ts` | All users | High — verify it iterates all users, not just one hardcoded |
| `app/api/weather/backfill/route.ts` | Activity | Medium |
| `app/api/strava/backfill-history/route.ts` | Activity | Medium |

### Specific checks

**Activity ownership on `[id]` routes:**
Any route that fetches a single activity by ID must verify it belongs to the current user:
```typescript
// Correct:
const activity = await prisma.activity.findUnique({ where: { id, userId: session.user.id } });
if (!activity) return 404;

// WRONG — fetches any user's activity if ID is known:
const activity = await prisma.activity.findUnique({ where: { id } });
```

**Strava webhook:**
The webhook receives events from Strava and must map `owner_id` (Strava athlete ID) to the correct internal `userId`. Verify no processing happens on unmatched owner IDs.

**Cron jobs:**
`lib/cron.ts` must iterate all users from the DB (`prisma.user.findMany({ where: { status: "active" } })`), not reference a single hardcoded user.

**Planner templates:**
Decide: are templates per-user (each user has their own) or shared? Currently likely per-user — verify all template queries include `userId`.

**FitnessCache:**
`updateVO2maxAndPaces(userId)` and `updateHRZones(userId)` are parameterised — verify all callers pass the correct userId and never a hardcoded value.

---

## 5. Security Audit Checklist

Run through this checklist before allowing any second user to sign in.

### Authentication & Authorization

- [ ] All `/api/**` routes that modify data call `auth()` and check `session.user.id` before any DB access
- [ ] All `/api/admin/**` routes additionally check `session.user.isAdmin === true`
- [ ] `middleware.ts` blocks all `/dashboard/**`, `/stats/**`, `/planner/**`, `/coach/**`, `/races/**`, `/activities/**`, `/history/**` for non-active users
- [ ] Session JWT includes `status` and `isAdmin` — middleware does not need extra DB queries
- [ ] Password hashing uses bcrypt with cost factor ≥ 12 (already true)
- [ ] No endpoint accepts `userId` as a query param or body field — always read from session

### Input validation

- [ ] All API routes validate request body with zod or equivalent before DB access
- [ ] Activity IDs in URL params are validated to belong to the session user (IDOR check)
- [ ] Race record IDs similarly checked
- [ ] Planner workout/template IDs similarly checked

### Rate limiting

- [ ] `/api/auth/register` — rate limit registrations per IP (e.g., 3 per hour) to prevent spam
- [ ] `/api/coach/chat` — rate limit AI calls per user (existing?)
- [ ] `/api/coach/calibrate` — rate limit (existing?)
- [ ] Strava sync endpoints — rate limit per user

### Strava OAuth isolation

- [ ] Each user's Strava tokens stored separately (in `Account` table keyed by `userId`)
- [ ] Strava webhook processes only events for known users (matched by `owner_id` → `stravaAthleteId`)
- [ ] Backfill endpoints only operate on the requesting user's data
- [ ] Strava client ID/secret are app-level (shared) — this is correct; tokens are per-user

### AI context isolation

- [ ] Coach chat context builder only pulls data for `session.user.id`
- [ ] No cross-user data is ever sent to the AI (e.g., "other users' average pace" should not appear in prompts)
- [ ] AI settings (model choice, API key) stored per-user in `AthleteProfile` — verify

### Infrastructure

- [ ] Environment variables (DB connection string, API keys) not exposed to client
- [ ] No sensitive data logged to console in production paths (passwords, tokens, emails)
- [ ] Strava webhook secret verified on every incoming webhook call

### Data leakage between users

- [ ] `GET /api/activities` never returns another user's activities
- [ ] Stats page never reads another user's `FitnessCache`
- [ ] Planner never shows another user's workouts or templates
- [ ] Coach never reads another user's profile or history

---

## 6. Audit Approach (Recommended Order)

1. **Schema migration first** — add `status` + `isAdmin`, migrate existing data.
2. **Auth gating** — update middleware and credentials provider. This prevents any new user from accessing data even if isolation bugs exist.
3. **Data isolation audit** — go file by file through Section 4. Fix any missing `userId` scopes.
4. **Security checklist** — work through Section 5 line by line.
5. **Register + admin approval UI** — build the user-facing flows last, after the backend is verified safe.
6. **Full smoke test** — two browser sessions simultaneously, verify no data leakage.

---

## 7. What This Does NOT Cover

- Email notifications (approval email to user) — requires email infrastructure (SMTP/Resend)
- Password reset flow — not in scope; admin can reset manually via DB script
- GDPR / right to erasure — not in scope for a friends-only deployment
- Garmin integration per-user — Garmin data is stored per `userId` in `GarminDailySummary`; verify the Garmin sync (if any) is user-scoped

---

*Plan written: 2026-06-03 — awaiting approval before any code changes*
