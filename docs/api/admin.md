# Admin API

Multi-user support: new accounts register via `/api/auth/register` in `pending` status and need admin approval before they can sign in. These endpoints are admin-only (`session.user.isAdmin`).

## POST /api/auth/register

Register a new account. Starts in `pending` status — cannot sign in until an admin approves.

**Auth:** None

**Request:**
```json
{
  "name":     "string (1-80 chars)",
  "email":    "string (valid email, lowercased)",
  "password": "string (min 8 chars)"
}
```

**Response (200):** `{ "ok": true }` — returned both on success and when the email already exists, to avoid email enumeration.

**Response (error):**
```json
{ "error": "Too many requests. Try again in <n>s." }   // 429 — max 5 registrations / hour per IP
{ "error": "<zod message>" }                            // 400 — invalid input
```

**Side effects:** Creates a `User` row with `status: "pending"`, bcrypt-hashed password (cost 12). No row created if the email already exists.

---

## GET /api/admin/users

List all users for the admin approval queue.

**Auth:** Required, admin only

**Response (200):**
```json
[
  { "id": "string", "email": "string", "name": "string | null", "status": "pending | active | rejected", "isAdmin": false, "createdAt": "..." }
]
```
Ordered by `status` ascending, then `createdAt` ascending (pending users surface first).

**Response (error):** `{ "error": "Forbidden" }` — 403, not an admin

---

## POST /api/admin/users/[id]

Approve, reject, or revoke a user.

**Auth:** Required, admin only

**Request:**
```json
{ "action": "approve | reject | revoke" }
```

**Response (200):**
```json
{ "id": "string", "email": "string", "status": "active | rejected" }
```

**Response (error):**
```json
{ "error": "Forbidden" }                                    // 403 — not an admin
{ "error": "Cannot modify your own account status." }       // 400 — id matches the admin's own user id
{ "error": "Invalid action." }                               // 400 — zod validation failed
```

**Side effects:**
- `approve` → sets `User.status = "active"`, then copies the admin's `SportCategory` and `WorkoutType` rows to the new user as starting defaults (sport categories cloned first, workout types remapped to the new sport IDs via an in-memory id map).
- `reject` or `revoke` → sets `User.status = "rejected"`. Both map to the same status; the distinction is UI-only (revoke = previously active, reject = was pending).
