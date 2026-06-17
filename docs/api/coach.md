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
