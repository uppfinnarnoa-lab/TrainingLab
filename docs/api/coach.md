# AI Coach API

## POST /api/coach/chat

Stream an AI coach response. Uses Server-Sent Events (SSE).

**Auth:** Required

**Request:**
```json
{
  "conversationId": "cuid (optional — omit to start new conversation)",
  "message":        "string (max 4000 chars)"
}
```

**Response:** `text/event-stream`. The whole request (tool calls + generation) runs inside the stream's `start()`, so the connection opens and the first event arrives immediately — none of it is buffered behind the LLM round-trips. Events are newline-delimited JSON:

```
data: {"convId": "clxxx..."}               ← First event: conversation ID (new conversations only)
data: {"status": "thinking"}               ← Model is deciding what to do / generating — show a "thinking" indicator
data: {"status": "tool", "tool": "get_fitness_summary"}  ← About to run this tool — show "Using <tool>…"
data: {"toolCall": {"name": "...", "message": "...", "success": true}}  ← Tool finished — render its result card
data: {"text": "Hello, "}                  ← Streaming text chunks (also implicitly clears the thinking/tool status)
data: {"text": "how can I help?"}
data: {"done": true, "cost": 0.0032, "inputTokens": 1240, "outputTokens": 380, "cacheReadTokens": 900}
```

A pending write-tool approval (`toolCall.pending: true`) ends the turn early with `done: true, cost: 0` — no `status`/`text` events follow until the user approves/rejects.

**Error event:**
```
data: {"error": "no_api_key"}              ← No API key configured
data: {"error": "Message text here"}       ← AI provider error
```

**Side effects:**
- Saves user message to `Message` table.
- Saves assistant response with `tokensUsed`, `estimatedCostUsd`, `modelUsed`.
- Increments `AISettings.currentMonthSpendUsd`.

**Context sent to AI (per request):**
- Cached system prompt: athlete profile, VO2max, training paces, HR zones, TSB, health log, upcoming plan (see `docs/schemas/ai-context.md`)
- Dynamic (not cached): last 28 days of activities (name, date, sport, distance, time, HR, pace, weather, description)
- Conversation history: last 20 messages

**Providers:**
- `claude` → `claude-sonnet-4-6`, uses `cache_control: ephemeral` on system prompt
- `gemini` → `gemini-2.5-flash`, free tier

**Apache note:** Requires `SetEnv proxy-sendchunked 1` and `ProxyPass` for streaming to work behind reverse proxy.

---

## Plan actions

If the AI response contains a fenced code block tagged `plan-action`, the client should parse it and create planned workouts:

```
```plan-action
[{"date": "2025-11-04", "name": "Easy run", "sportType": "Running", "targetDuration": 3600}]
```
```

The client sends each item to `POST /api/planner/workouts`.

---

## POST /api/coach/calibrate?mode=algorithmic|ai|pct

Recompute HR zones / VO2max / paces and write them to `FitnessCache`.

**Auth:** Required (rate-limited: 5 requests / 10 min per user)

**Query params:** `mode` — `algorithmic` (default) | `ai` | `pct`
- `algorithmic` — pure statistical estimation (`updateHRZones`), returns the recomputed zones.
- `ai` — runs the algorithmic pass first (ground truth), then asks the user's configured AI provider to refine LT1/LT2 from race PBs + recent hard efforts; falls back to algorithmic zones if the AI response is missing/invalid/unparseable.
- `pct` — builds zones from explicit `lt1Pct`/`lt2Pct` query params (e.g. `?mode=pct&lt1Pct=83&lt2Pct=89`), clamped to `[60,95]`/`[70,98]`, no AI call.

**Request:** No body.

**Response (200, algorithmic/pct):**
```json
{
  "vo2max": 58.1, "vdot": 52.3,
  "maxHR": 185, "restHR": 45, "thresholdHR": 167,
  "zones": { "z1": [45, 130], "z2": [130, 142], "z3": [142, 162], "z4": [162, 170], "z5": [170, 185] },
  "paces": { "easy": [330, 410] },
  "computedAt": "2025-10-20T06:00:00.000Z",
  "aiInsights": null,
  "rSquared": 0.78,
  "zonesMethod": "string describing the method used",
  "lt1HR": 152, "lt2HR": 167
}
```

**Response (200, ai mode adds):**
```json
{
  "hrZones": { "z1": [45, 130], "z2": [130, 142], "z3": [142, 162], "z4": [162, 170], "z5": [170, 185] },
  "aiInsights": "string — AI's reasoning, or a fallback message if AI failed/unavailable",
  "aiApplied": true
}
```

**Response (error):**
```json
{ "error": "rate_limited", "retryAfter": 480 }            // 429
{ "error": "LT1 % must be less than LT2 %" }                // 400 — pct mode only
{ "error": "No fitness cache — run a sync first" }          // 404 — pct mode only
{ "error": "calibration_failed" }                           // 500 — algorithmic/ai mode, no cache after update
```

**Side effects:** Writes `zones`, `thresholdHR`, and (ai mode only, when AI returns valid JSON) `maxHR` to `FitnessCache`. `pct` mode never calls an AI provider. AI-derived `maxHR` is never written to `AthleteProfile` — only user-entered values go there.

---

## POST /api/coach/summarize

Summarize a conversation (used to compact long chat history).

**Auth:** Required (rate-limited: 20 requests / 60s per user)

**Request:**
```json
{ "conversationId": "cuid" }
```

**Response (200):**
```json
{ "messages": 37 }
```

**Response (error):**
```
401 Unauthorized
400 Missing conversationId
404 Not found
429 { "error": "rate_limited", "retryAfter": 12 }
```

**Side effects:** None currently — reads up to the first 40 messages of the conversation; does not yet write a summary.

---

## DELETE /api/coach/conversations/[id]

Delete a coach conversation and its messages.

**Auth:** Required

**URL params:** `id` — Conversation ID

**Request:** No body.

**Response (200):** `{ "ok": true }`

**Response (error):**
```json
{ "error": "unauthorized" }   // 401
{ "error": "not_found" }      // 404 — doesn't exist or wrong user
```

**Side effects:** Deletes the `Conversation` row (cascades to its `Message` rows).

---

## POST /api/coach/undo/[editId]

Reverts a write made by an AI coach tool call (e.g. created/updated/deleted workout, training block, race result, activity notes, profile fields).

**Auth:** Required

**URL params:** `editId` — `CoachEdit` ID

**Request:** No body.

**Response (200):** `{ "ok": true }`

**Response (error):**
```json
{ "error": "unauthorized" }      // 401
{ "error": "not_found" }         // 404 — doesn't exist or wrong user
{ "error": "already_undone" }    // 409
```

**Side effects:**
- Restores the entity to `previousStateJson` (upsert) for update/delete-type edits, or deletes the entity for create-type edits — depends on `CoachEdit.toolName` (`create_workout`, `update_workout`, `delete_workout`, `create_training_block`, `update_training_block`, `delete_training_block`, `log_race_result`, `delete_race_result`, `update_activity_notes`, `update_profile`).
- Marks `CoachEdit.undoneAt` and `status: "undone"`.
