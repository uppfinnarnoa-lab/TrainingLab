# AI Coach Agentic Reliability & Tool-Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI coach's multi-step tool-calling actually work for every provider (especially NVIDIA/Kimi K2.6, the user's daily driver), stop the literal Kimi special-token leakage into chat replies, fix the Strava activity-stream pipeline so pace/HR/elevation graphs reliably appear, and replace raw markdown text in the chat UI with rendered tables/charts.

**Architecture:** Claude already has a working 6-iteration agentic tool loop (`app/api/coach/chat/route.ts`). The other three providers (NVIDIA/Kimi, Groq, Gemini) only get a single tool-call check before streaming a final answer with **no `tools` schema attached at all** — that gap is the root cause of almost every symptom in the bug report. This plan adds two new shared loop helpers (one OpenAI-compatible for NVIDIA+Groq, one for Gemini) that mirror Claude's proven iteration pattern, fixes a separate Strava-backfill/cron concurrency bug that starves on-demand stream fetches, and adds a markdown+chart renderer to the chat UI. No Prisma schema changes are required anywhere in this plan.

**Tech Stack:** Next.js 15 App Router, TypeScript, `openai` SDK (NVIDIA NIM + Groq), `@google/generative-ai`, `@anthropic-ai/sdk`, Prisma/PostgreSQL, `recharts` (already used in `activity-charts.tsx`), `react-markdown` + `remark-gfm` (new dependency, Task 6).

## Global Constraints

- AI context is always summarized — never send raw bulk activity data to the model (CLAUDE.md Hard Rule). Nothing in this plan changes that; it fixes *tool-based* retrieval, not context size.
- Sport types and workout types are user-defined — never hardcode them in logic or UI.
- No comments unless the WHY is non-obvious to a future reader.
- No error handling for scenarios that cannot happen.
- This project has no migration files — schema changes use `prisma db push` only. (Not needed here — no schema changes in this plan.)
- This project has no automated test runner (no jest/vitest configured) — verification is `npx tsc --noEmit`, `pnpm build --no-lint`, and manual browser/log verification, per existing session conventions in `docs/planning/IMPLEMENTATION_PLAN.md`. Testing steps in this plan follow that convention instead of inventing a test framework.
- Doc-before-code: `docs/api/coach.md`, `docs/integrations/strava.md`, and `docs/api/cron.md` must be updated as part of the tasks that touch those contracts (listed per-task below).

---

## Part A — Bug Audit (verified findings)

Per CLAUDE.md's Bug Audit Practice, each item below was traced to an exact code path before being accepted as real. Two of the user's six reported items turned out **not** to be the bug they look like — documented as such rather than "fixed" into something that was already correct.

### A0. Audit of all 25 tools in `lib/ai/tools.ts` — no individual per-tool bugs found beyond the systemic ones below

The user asked for "en bug audit av samtliga verktyg" (a bug audit of every tool). [lib/ai/tools.ts](lib/ai/tools.ts)'s full `executeCoachTool()` switch (all 25 cases, read end to end — `search_activities` through `update_profile`) was read in full, not sampled. No individual tool has a logic bug specific to it; every read tool correctly scopes queries to `userId` (no cross-user leakage), every write tool correctly creates a `CoachEdit` row for undo, and `update_activity_notes`/`update_profile` correctly check ownership before mutating. The only bugs that affect "all the tools" are systemic, at the calling layer, not inside the tools themselves: A1/A2 below (only one tool call per turn ever executes for 3 of 4 providers) and the missing `JSON.parse` fallback for malformed tool-call arguments (fixed as part of Task 2's `parseToolArgs`). Both are integration-layer fixes in Part D, not per-tool fixes — there was nothing to fix inside `tools.ts` itself except Task 8's optional `search_activities` polish.

### A1. Garbled tool-call tokens leaking into chat replies — **CONFIRMED, root cause found**

**Symptom (from the user's pasted conversation):** the assistant's visible reply contained literal text:
```
Testar flera i parallellt: <|tool_calls_section_begin|> <|tool_call_begin|> functions.get_activity_detail:0
<|tool_call_argument_begin|> {"activity_id": "night_run_2026_06_28"} <|tool_call_end|> ...
```

**Root cause:** `<|tool_calls_section_begin|>` / `<|tool_call_begin|>` / `<|tool_call_argument_begin|>` / `<|tool_call_end|>` / `<|tool_calls_section_end|>` are Kimi K2's **native** tool-call delimiter tokens (confirmed against Moonshot's own `tool_call_guidance.md`). An OpenAI-compatible host (NVIDIA NIM, in this case) has to intercept Kimi's raw token stream and reconstruct it into the standard `tool_calls` JSON field — for parallel/multiple tool calls in one turn this reconstruction is known to be fragile, and on failure the raw tokens land in `message.content` instead of `message.tool_calls`.

That alone would just mean the tool-check call's `finish_reason !== "tool_calls"`, so [tools.ts → route.ts](app/api/coach/chat/route.ts) would silently skip tool execution for that call. The reason the garbage became *visible* is a second, compounding bug:

- [lib/ai/nvidia.ts:39-62](lib/ai/nvidia.ts#L39-L62) (`NvidiaClient.stream()`) — the call that actually produces the **visible streamed answer** — never passes a `tools` array at all.
- [lib/ai/groq.ts:37-62](lib/ai/groq.ts#L37-L62) has the identical gap.
- But [lib/ai/prompts.ts:78-85](lib/ai/prompts.ts#L78-L85) (the system prompt, sent to **every** provider including this final streaming call) explicitly tells the model: *"You have tools... you can call multiple tools per turn in parallel."*

So on the final answer-generating call, the model is told tools exist and to use them, but the API request gives it no structured channel to do so — Kimi falls back to emitting its native tool-call syntax as plain text, which streams straight to the user verbatim and gets saved to the `Message` table as-is.

**Verified reachable:** yes — this is the exact call path used for every NVIDIA-provider coach message once a tool-like question is asked. Confirmed against [lib/ai/nvidia.ts](lib/ai/nvidia.ts) and [app/api/coach/chat/route.ts:285-351](app/api/coach/chat/route.ts#L285-L351).

### A2. "Let it keep sending several messages" / multi-step tool use doesn't work for Kimi/NVIDIA, Groq, Gemini — **CONFIRMED, same root cause as A1**

[app/api/coach/chat/route.ts:153-283](app/api/coach/chat/route.ts#L153-L283) shows Claude gets a real agentic loop: up to 6 iterations, parallel tool execution (`Promise.all`), tool results appended as proper `tool_result` blocks, write-tool pause-for-approval, then a dedicated final streaming call.

[app/api/coach/chat/route.ts:285-351](app/api/coach/chat/route.ts#L285-L351) ("Non-Claude providers") gives every other provider exactly **one** non-streamed tool-check call, reads only `choice.message.tool_calls?.[0]` (silently drops any additional parallel calls the model wanted to make), executes that single tool, and then moves straight to a final stream with no further tool access and no way to re-evaluate if that one tool call didn't answer the question. There is no loop at all — "let it continue" is architecturally impossible on this path today.

This is why the transcript shows the model giving up and asking the user to manually supply split times instead of retrying `search_activities` with different parameters, and why "Testar flera i parallellt" (testing several in parallel) never actually executed more than the conceptual first one.

### A3. `search_activities` "only searches by date, not name/properties" — **NOT A BUG — tool already supports keyword search**

[lib/ai/tools.ts:18-30](lib/ai/tools.ts#L18-L30) (tool schema) and [lib/ai/tools.ts:415-454](lib/ai/tools.ts#L415-L454) (executor) show `search_activities` already takes `query` (matched against `name` OR `description`, case-insensitive, via Prisma `contains`), `sport`, `is_race`, plus the date range. The date range defaults to the last 365 days, not "only" a date filter.

What actually happened in the transcript: the user asked about a session described only by its *workout structure* ("7x4min/90s"), which matches neither the Strava activity's actual title ("Night Run") nor its description. The tool correctly returned no match — that's correct behavior for a literal keyword search, not a missing capability. The real gap is A2: with a working multi-step loop, the model could try `search_activities` with no query (or a narrower date range) as a second call when the first one returns empty, instead of being stuck after one attempt. **No code change needed here** beyond the A2/A4 loop fix; flagged as a documentation/expectation correction, not an engineering task. A small optional polish is included as Task 8.

### A4. Strava activity streams "no longer fetch at all" (no pace/HR graph) — **CONFIRMED, but a different bug than the data-completeness theory the user expected**

The on-demand fetch path itself is sound: [app/api/activities/[id]/streams/route.ts](app/api/activities/[id]/streams/route.ts) serves a cached `ActivityStream` row if one exists, otherwise live-fetches from Strava and caches it; [activity-charts.tsx](app/(dashboard)/activities/[id]/activity-charts.tsx) renders it with `recharts`. Nothing there is broken.

The real bug is a **rate-limit-budget collision** introduced by the 2026-06-26 change that added stream fetching to the historical backfill:

- [lib/cron.ts:67-82](lib/cron.ts#L67-L82) — the nightly cron job calls `runHistoricalBackfill(account.userId)` **directly**, bypassing `backfillRunner` (the in-memory job tracker in [lib/strava/backfill-runner.ts](lib/strava/backfill-runner.ts) that exists specifically to stop a second backfill from starting while one is already running). The manual "start backfill" button in the UI *does* go through `backfillRunner` ([app/api/strava/backfill-history/route.ts](app/api/strava/backfill-history/route.ts)). These two entry points have **no shared concurrency guard** — a user-triggered backfill during the day and the 00:30 UTC cron backfill can run concurrently for the same account, each consuming Strava's per-user rate-limit budget independently.
- [lib/strava/backfill.ts:190-206](lib/strava/backfill.ts#L190-L206) — when `STRAVA_DAILY_LIMIT` is hit, `runHistoricalBackfill` computes `waitMs = msUntilMidnightUTC()` (up to ~24h) and **blocks inside the same async call** via `interruptibleWait`. The cron path passes no `getSignal`, so this wait is unconditional. Since 2026-06-26 the backfill does roughly **2x the API calls per activity** (detail fetch + stream fetch, [lib/strava/backfill.ts:130-182](lib/strava/backfill.ts#L130-L182)), it now hits the daily limit far more easily on an account with a multi-year history. Once it does, the 00:30 cron invocation sits blocked for up to 24 hours — and node-cron fires the *same* job again the next night regardless of whether the previous invocation's promise has resolved, so overlapping invocations for the same user can stack.
- Net effect: the account's Strava rate-limit budget (200 req/15min, 2000/day, shared across **every** endpoint including the on-demand streams fetch) is being silently consumed around the clock by an unbounded, unguarded backfill. When the user views their latest activity during the day, the on-demand fetch in [app/api/activities/[id]/streams/route.ts:42-53](app/api/activities/[id]/streams/route.ts#L42-L53) throws `STRAVA_RATE_LIMIT`, which today is swallowed into one generic `{ error: "streams_unavailable" }` (503), rendered by the frontend as the same message shown for "this activity genuinely has no GPS data" — making a transient rate-limit failure look like a permanent regression.

**Verified reachable:** yes, directly from reading the cron registration and the backfill's own request-volume comment ("now also fetches and caches each activity's full stream (2026-06-26)"). Timeline matches the user's "no longer" framing (3 days between the change and the report). Task 4 fixes the concurrency gap and bounds the cron invocation's runtime; Task 5 makes the failure mode visible instead of indistinguishable from "no GPS data."

### A5. AI chat renders raw markdown instead of tables/charts — **CONFIRMED, more severe than reported: no markdown rendering exists at all**

[components/coach/ChatInterface.tsx:449-463](components/coach/ChatInterface.tsx#L449-L463) renders `msg.content` as a plain `<div className="whitespace-pre-wrap">{msg.content}</div>` — no markdown parser of any kind. Every `**bold**`, `| table | cell |`, and `## heading` the model writes (and the system prompt doesn't discourage markdown) shows up as literal pipe/asterisk/hash characters. Task 7 adds proper rendering, plus a lightweight custom block convention for simple charts so numeric time-series data doesn't have to be jammed into a markdown table at all.

Side note: [docs/api/coach.md:55-65](docs/api/coach.md#L55-L65) documents a `plan-action` fenced-code-block convention for creating workouts from chat — grep of `components/coach/ChatInterface.tsx` confirms this was never implemented; it was superseded by the `create_workout` tool + approval-card flow that *is* implemented. Task 6 removes this stale doc section per the "docs disagree with code → fix immediately" rule.

### A6. "AI should have the whole database as context" — addressed as a design clarification, not a context-size change

See Part B below — full-context stuffing is the wrong fix for what's actually broken (A1/A2), and would directly violate the project's existing Hard Rule against sending bulk data to the model. Part B explains why and what "the AI can reach the whole database" should actually mean here.

---

## Part B — Why not just send the whole database as context? (research summary)

The user's framing — "it should have the whole database for that user as context" — is a real, legitimate need (the coach should be able to answer questions about *any* activity, not just the last 28 days), but literally concatenating the full history into every request is the wrong implementation, for reasons confirmed by both this project's own existing Hard Rule and current external practice:

- **Token cost and context-window limits.** A multi-year training history easily reaches tens of thousands of activities; even summarized, that doesn't fit in any model's context window repeatedly per turn, and re-sending it every message is needlessly expensive even where it would fit. Current literature on agent context design (2026) puts full-context-per-turn around **~26,000 tokens per conversation** vs. **~7,000 tokens** for an equivalent on-demand/tool-retrieval approach in comparable benchmarks — a >3x cost difference for the same answer quality.
- **"Agentic RAG" — letting the agent pull data on demand — is the current best practice**, explicitly replacing "stuff everything into context up front" patterns from 2023-2024. The model decides what it needs and calls a tool for exactly that, which is precisely the architecture this codebase already chose (`lib/ai/tools.ts`'s 20+ read tools + the cached system-prompt snapshot). The bug isn't the architecture — it's that three of four providers can only use that architecture for a single tool call per turn (Part A2).
- Conclusion used for this plan: **"the AI should be able to reach the whole database" = give it a working, multi-step, all-provider tool-calling loop** (Part A1/A2 fix), not a literal context dump. After Task 1-4 ship, the model can chain `search_activities` → `get_activity_detail` → `get_activity_stream` → `analyze_full_history` etc. across as many calls as it needs within one turn, for any provider — which is functionally "access to the whole database," implemented the way the rest of the industry currently recommends doing it.

Sources consulted: Moonshot AI's `Kimi-K2` tool-calling guidance (GitHub), Anthropic's "Writing effective tools for AI agents" engineering post, and 2026 context-architecture/agentic-RAG comparison writeups (Atlan, VentureBeat/NOVALOGIQ "context architecture is replacing RAG," mem0.ai's 2026 agent-memory benchmark report). Kimi K2.6 itself benchmarks at a **96.6% tool-invocation success rate** and is documented as reliable across 4,000+ chained tool calls without degradation — confirming the user's own assessment ("kimi 2.6 vilket är en bra modell") and confirming the bugs in Part A are integration-layer bugs in this codebase, not model competence issues.

---

## Part C — File structure for this plan

```
lib/ai/
  agent-loop.ts          NEW — shared OpenAI-compatible (NVIDIA+Groq) agentic loop
  kimi-fallback.ts       NEW — regex fallback parser/sanitizer for leaked Kimi tokens
  gemini-loop.ts         NEW — Gemini multi-function-call agentic loop
  nvidia.ts              unchanged (still used for the final streaming call by agent-loop.ts)
  groq.ts                unchanged (same)
  gemini.ts              unchanged (same)
  prompts.ts             MODIFIED — add chart/table block convention instructions
  tools.ts               MODIFIED (Task 8 only, optional) — search_activities fallback hint

app/api/coach/chat/route.ts   MODIFIED — nvidia/groq branch and gemini branch call the new loops; Claude branch untouched

lib/cron.ts                   MODIFIED — nightly backfill goes through backfillRunner
lib/strava/backfill.ts        MODIFIED — bounded daily-limit handling, new stoppedAt variant
lib/strava/backfill-runner.ts MODIFIED — daily_limit settles to idle, plus startIfIdle()
app/api/strava/backfill-history/route.ts     MODIFIED — close SSE stream on daily_limit too
app/(dashboard)/settings/strava-connect.tsx  MODIFIED — daily_limit is no longer a long-lived "active" state

app/api/activities/[id]/streams/route.ts   MODIFIED — distinct error reasons
components/activity/                        no change — this plan does not touch the in-progress, already-uncommitted TypePicker.tsx color work
app/(dashboard)/activities/[id]/activity-charts.tsx   MODIFIED — render distinct error reasons

components/coach/ChatInterface.tsx   MODIFIED — react-markdown + remark-gfm + custom chart/table block renderer
components/coach/ChatChart.tsx       NEW — tiny recharts wrapper for the chat's custom chart blocks
package.json                          MODIFIED — add react-markdown, remark-gfm, @tailwindcss/typography

docs/api/coach.md              MODIFIED — document new providers' loop behavior, remove stale plan-action section, document chart/table block convention
docs/integrations/strava.md    MODIFIED — document the cron/backfill concurrency fix
docs/api/cron.md               MODIFIED — same
```

---

## Part D — Implementation tasks

### Task 1: Kimi leaked-token fallback parser/sanitizer

**Files:**
- Create: `lib/ai/kimi-fallback.ts`

**Interfaces:**
- Produces: `parseLeakedKimiToolCalls(text: string): { name: string; args: Record<string, unknown> }[]` and `stripLeakedKimiTokens(text: string): string` — both used by Task 2.

- [ ] **Step 1: Write the module**

```typescript
// lib/ai/kimi-fallback.ts
// Kimi K2's native tool-call format (Moonshot tool_call_guidance.md):
// <|tool_calls_section_begin|><|tool_call_begin|>functions.NAME:IDX
// <|tool_call_argument_begin|>{...json...}<|tool_call_end|>...<|tool_calls_section_end|>
// NVIDIA NIM is supposed to convert this into structured `tool_calls`, but parsing
// parallel/multiple calls is known to be fragile and can leak the raw tokens into
// `content` instead. This is a last-resort app-level parser for that failure mode —
// the real fix is Task 2 passing `tools` on every call so NIM has a clean channel,
// this is the safety net for when NIM's own parser still fails anyway.

const SECTION_RE = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/;
const CALL_RE = /<\|tool_call_begin\|>\s*functions\.([a-zA-Z_][a-zA-Z0-9_]*):\d+\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;

export function parseLeakedKimiToolCalls(text: string): { name: string; args: Record<string, unknown> }[] {
  const section = SECTION_RE.exec(text);
  if (!section) return [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let m: RegExpExecArray | null;
  const body = section[1];
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(body)) !== null) {
    const [, name, argsRaw] = m;
    try {
      calls.push({ name, args: JSON.parse(argsRaw) as Record<string, unknown> });
    } catch {
      // malformed JSON in a leaked call — skip it, don't crash the whole parse
    }
  }
  return calls;
}

export function stripLeakedKimiTokens(text: string): string {
  return text
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "")
    .replace(/<\|tool_call[a-z_]*\|>/g, "")
    .trim();
}

export function hasLeakedKimiTokens(text: string): boolean {
  return text.includes("<|tool_call");
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/ai/kimi-fallback.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/kimi-fallback.ts
git commit -m "feat: add fallback parser for leaked Kimi K2 tool-call tokens"
```

---

### Task 2: Shared OpenAI-compatible agentic loop (NVIDIA + Groq)

**Files:**
- Create: `lib/ai/agent-loop.ts`
- Modify: `app/api/coach/chat/route.ts:285-319` (the nvidia/groq half of the "Non-Claude providers" block)

**Interfaces:**
- Consumes: `COACH_TOOLS`, `WRITE_TOOLS`, `executeCoachTool`, `toOpenAITools` from `lib/ai/tools.ts` (unchanged signatures); `parseLeakedKimiToolCalls`, `stripLeakedKimiTokens`, `hasLeakedKimiTokens` from Task 1.
- Produces: `runOpenAICompatibleAgentLoop(opts): Promise<AgentLoopResult>` — used by route.ts in Task 2's own step. `AgentLoopResult` is intentionally provider-agnostic (plain strings, no SDK-specific message types) so Task 3 (Gemini) returns the exact same shape and route.ts's post-loop handling is identical for both branches.

```typescript
export interface AgentLoopResult {
  done: boolean;             // true if a final answer was produced this turn
  hasPending: boolean;       // true if a write tool needs user approval
  pendingEvent?: { name: string; message: string; success: true; pending: true; pendingInput: Record<string, unknown>; pendingTool: string };
  finalText: string;         // the model's final answer text — only meaningful when done === true
  toolContext: string;       // accumulated "[Tool: x]\n<data>" text across all iterations — "" if no tools were called.
                              // Used by the caller to extend the existing AIMessage[] history when MAX_ITERATIONS
                              // is hit without a final answer (done === false, hasPending === false), so the
                              // fallback streaming call still has the gathered tool data — mirrors exactly what
                              // the pre-existing single-tool-call code already did before this loop replaced it.
  toolsUsed: boolean;
}
```

- [ ] **Step 1: Write the failing-state check first — confirm today's behavior with a manual repro**

Before writing the fix, reproduce A1/A2 once against the live dev server to have a concrete "before" baseline (no automated test exists for this — manual repro is this project's actual verification method):
1. `pnpm dev` (per CLAUDE.md, only when testing a UI/behavior change).
2. In Settings → AI Coach, select NVIDIA provider, Kimi K2.6 model.
3. In the coach chat, ask: "Sök efter alla löppass de senaste 7 dagarna och jämför deras snittpace." (a query that requires 2+ tool calls: `search_activities` then a comparison).
4. Confirm today's behavior: only one tool call ever executes (check server log `[coach/chat]` lines / Network tab SSE events for `toolCall` — there should be at most one), and note whether any `<|tool_call` text appears in the rendered answer.
5. Kill the dev server (`Get-Process -Name "node" | Stop-Process -Force` per CLAUDE.md) once confirmed — this is the baseline to compare Step 6 against.

- [ ] **Step 2: Write `lib/ai/agent-loop.ts`**

```typescript
// lib/ai/agent-loop.ts
import OpenAI from "openai";
import { COACH_TOOLS, WRITE_TOOLS, executeCoachTool, toOpenAITools } from "./tools";
import { parseLeakedKimiToolCalls, stripLeakedKimiTokens, hasLeakedKimiTokens } from "./kimi-fallback";

const MAX_ITERATIONS = 6;
const RETRY_DELAYS_MS = [1000, 3000, 8000]; // matches Moonshot/NIM guidance: backoff on transient 429s

export interface AgentLoopResult {
  done: boolean;
  hasPending: boolean;
  pendingEvent?: { name: string; message: string; success: true; pending: true; pendingInput: Record<string, unknown>; pendingTool: string };
  finalText: string;
  toolContext: string;
  toolsUsed: boolean;
}

interface RunOpts {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[]; // history + latest user message, no system row
  userId: string;
  convId: string;
  describeAction: (toolName: string, input: Record<string, unknown>) => string;
  send: (obj: Record<string, unknown>) => void;
  // NVIDIA NIM rejects role:"tool" messages — tool results must be folded into a user
  // message instead. Groq is standard OpenAI-shaped and accepts role:"tool" normally.
  useToolRole: boolean;
}

async function createWithRetry(client: OpenAI, params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429 || attempt === RETRY_DELAYS_MS.length) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // malformed JSON from the model — caller skips this call instead of crashing
  }
}

export async function runOpenAICompatibleAgentLoop(opts: RunOpts): Promise<AgentLoopResult> {
  const { client, model, systemPrompt, userId, convId, describeAction, send, useToolRole } = opts;
  // Internal working history uses the full OpenAI SDK message shape (tool_calls metadata,
  // tool-role entries) — this never escapes the function. The returned AgentLoopResult only
  // exposes plain strings so it has the exact same shape Task 3's Gemini loop returns.
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.messages,
  ];
  let toolsUsed = false;
  let toolContext = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await createWithRetry(client, {
      model, max_tokens: 1024, tools: toOpenAITools(), tool_choice: "auto", messages,
    });
    const choice = response.choices[0];
    const msg = choice.message;

    let calls = (msg.tool_calls ?? []).map(c => ({
      id: c.id, name: c.function.name, argsRaw: c.function.arguments,
    }));

    // Fallback: structured tool_calls came back empty but the model leaked Kimi's
    // native delimiter tokens into plain content — recover the intended calls.
    if (calls.length === 0 && msg.content && hasLeakedKimiTokens(msg.content)) {
      const leaked = parseLeakedKimiToolCalls(msg.content);
      calls = leaked.map((c, i) => ({ id: `leaked_${iter}_${i}`, name: c.name, argsRaw: JSON.stringify(c.args) }));
    }

    if (calls.length === 0) {
      // Genuine final answer. Strip any stray leaked tokens defensively even though
      // none were detected as full tool calls above (e.g. a truncated/partial leak).
      const finalText = msg.content ? stripLeakedKimiTokens(msg.content) : "";
      return { done: true, hasPending: false, finalText, toolContext, toolsUsed };
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    const parsed = calls.map(c => ({ ...c, args: parseToolArgs(c.argsRaw) }));
    const writeCall = parsed.find(c => WRITE_TOOLS.has(c.name) && c.args);
    if (writeCall && writeCall.args) {
      return {
        done: false, hasPending: true, finalText: "", toolContext, toolsUsed,
        pendingEvent: {
          name: writeCall.name, message: describeAction(writeCall.name, writeCall.args),
          success: true, pending: true, pendingInput: writeCall.args, pendingTool: writeCall.name,
        },
      };
    }

    for (const c of parsed) send({ status: "tool", tool: c.name });
    const results = await Promise.all(parsed.map(c =>
      c.args
        ? executeCoachTool(c.name, c.args, userId, convId)
        : Promise.resolve({ success: false, message: "Invalid tool arguments.", data: "error: malformed JSON arguments" })
    ));
    for (let i = 0; i < parsed.length; i++) {
      send({ toolCall: { name: parsed[i].name, message: results[i].message, success: results[i].success } });
    }
    toolsUsed = true;
    toolContext += parsed.map((c, i) => `[Tool: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n") + "\n\n";
    send({ status: "thinking" });

    if (useToolRole) {
      for (let i = 0; i < parsed.length; i++) {
        messages.push({ role: "tool", tool_call_id: parsed[i].id, content: String(results[i].data ?? results[i].message) });
      }
    } else {
      const combined = parsed.map((c, i) => `[Tool result: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n");
      messages.push({ role: "user", content: combined });
    }
  }

  // Hit MAX_ITERATIONS without a final answer — return whatever tool context we gathered;
  // the caller appends toolContext to its own AIMessage[] history before the fallback
  // streaming call, exactly like the pre-existing single-tool-call code already did.
  return { done: false, hasPending: false, finalText: "", toolContext, toolsUsed };
}
```

- [ ] **Step 3: Wire it into `app/api/coach/chat/route.ts`**

Replace [app/api/coach/chat/route.ts:291-319](app/api/coach/chat/route.ts#L291-L319) (the `if (provider === "nvidia" || provider === "groq")` block) with:

```typescript
        if (provider === "nvidia" || provider === "groq") {
          const OpenAI  = (await import("openai")).default;
          const baseURL = provider === "nvidia" ? "https://integrate.api.nvidia.com/v1" : "https://api.groq.com/openai/v1";
          const model   = provider === "nvidia" ? resolveNvidiaModel(aiSettings?.nvidiaModel) : resolveGroqModel(aiSettings?.groqModel);
          const oai     = new OpenAI({ apiKey, baseURL });
          try {
            const loop = await runOpenAICompatibleAgentLoop({
              client: oai, model, systemPrompt, userId, convId: convId!,
              messages: messages.map(m => ({ role: m.role, content: m.content })),
              describeAction, send, useToolRole: provider === "groq",
            });
            if (loop.hasPending && loop.pendingEvent) {
              send({ toolCall: loop.pendingEvent });
              hasPending = true;
            } else if (loop.done) {
              // Loop already produced the final text directly (no streaming token-by-token
              // for this reply) — emit it as one chunk so the UI's existing text handler works unchanged.
              send({ text: loop.finalText });
              fullResponse = loop.finalText;
              await saveAssistantMessage(convId!, fullResponse, userId, provider, model, 0, 0, 0);
              send({ done: true, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
              controller.close();
              return;
            } else {
              // Hit MAX_ITERATIONS without a final answer — fall through to the streaming
              // final-answer call below, but first extend `messages` with whatever tool
              // context the loop gathered, exactly like the pre-existing single-tool-call
              // code used to (see the removed `messages.push(...)` pair this replaces).
              toolsUsed = loop.toolsUsed;
              if (loop.toolContext) {
                messages.push({ role: "assistant", content: loop.toolContext });
                messages.push({ role: "user", content: "Answer my question using the tool data above." });
              }
            }
          } catch (err) {
            console.error("[coach/chat] nvidia/groq agent loop failed:", err instanceof Error ? err.message : err);
          }
        }
```

Note: this keeps the existing Gemini branch (lines 320-350) and the existing fallback-stream call below untouched for this task — Task 3 replaces the Gemini branch separately.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors. The `tool_calls` field on `ChatCompletionMessageParam` for role `"assistant"` requires the `openai` SDK's types — confirm `openai` is already `^6.39.0` in `package.json` (it is) which supports this shape natively.

- [ ] **Step 5: Manual re-test against the Step 1 repro**

Repeat the exact Step 1 script. Expected differences from baseline:
- Network tab shows 2+ `toolCall` SSE events for the comparison query (e.g. `search_activities` then a second call), not just one.
- No `<|tool_call` substring anywhere in the rendered or saved message (grep the `Message.content` row in Prisma Studio for that conversation if in doubt).
- If a write-tool is requested mid-conversation, the approval card still appears exactly as before (this path is shared with the pre-existing write-tool UI in `ChatInterface.tsx`, untouched).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/agent-loop.ts app/api/coach/chat/route.ts
git commit -m "fix: give NVIDIA/Kimi and Groq a real multi-step tool-calling loop"
```

---

### Task 3: Gemini multi-function-call agentic loop

**Files:**
- Create: `lib/ai/gemini-loop.ts`
- Modify: `app/api/coach/chat/route.ts:320-350` (the Gemini branch)

**Interfaces:**
- Consumes: same `lib/ai/tools.ts` exports as Task 2, plus `toGeminiTools`.
- Produces: `runGeminiAgentLoop(opts): Promise<AgentLoopResult>` — same `AgentLoopResult` shape as Task 2 so route.ts handles both identically (Step 2 below reuses Task 2 Step 3's post-loop branch shape).

- [ ] **Step 1: Write `lib/ai/gemini-loop.ts`**

```typescript
// lib/ai/gemini-loop.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { WRITE_TOOLS, executeCoachTool, toGeminiTools } from "./tools";
import type { AgentLoopResult } from "./agent-loop";

const MAX_ITERATIONS = 6;

interface GeminiHistoryItem { role: "user" | "model"; parts: { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: { result: string } } }[] }

interface RunOpts {
  apiKey: string;
  systemPrompt: string;
  history: GeminiHistoryItem[]; // prior turns, model-role for assistant
  latestUserText: string;
  userId: string;
  convId: string;
  describeAction: (toolName: string, input: Record<string, unknown>) => string;
  send: (obj: Record<string, unknown>) => void;
}

export async function runGeminiAgentLoop(opts: RunOpts): Promise<AgentLoopResult> {
  const { apiKey, systemPrompt, userId, convId, describeAction, send } = opts;
  const genAI = new GoogleGenerativeAI(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ functionDeclarations: toGeminiTools() }] as any,
    systemInstruction: systemPrompt,
  });

  const history = [...opts.history];
  let toolsUsed = false;
  let toolContext = "";
  let pendingText = opts.latestUserText;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const chat = model.startChat({ history });
    const res = await chat.sendMessage(pendingText);
    const parts = res.response.candidates?.[0]?.content.parts ?? [];
    const calls = parts.filter(p => "functionCall" in p && p.functionCall).map(p => p.functionCall!);

    if (calls.length === 0) {
      return { done: true, hasPending: false, finalText: res.response.text(), toolContext, toolsUsed };
    }

    history.push({ role: "user", parts: [{ text: pendingText }] });
    history.push({ role: "model", parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args as Record<string, unknown> } })) });

    const writeCall = calls.find(c => WRITE_TOOLS.has(c.name));
    if (writeCall) {
      return {
        done: false, hasPending: true, finalText: "", toolContext, toolsUsed,
        pendingEvent: {
          name: writeCall.name, message: describeAction(writeCall.name, writeCall.args as Record<string, unknown>),
          success: true, pending: true, pendingInput: writeCall.args as Record<string, unknown>, pendingTool: writeCall.name,
        },
      };
    }

    for (const c of calls) send({ status: "tool", tool: c.name });
    const results = await Promise.all(calls.map(c => executeCoachTool(c.name, c.args as Record<string, unknown>, userId, convId)));
    for (let i = 0; i < calls.length; i++) send({ toolCall: { name: calls[i].name, message: results[i].message, success: results[i].success } });
    toolsUsed = true;
    toolContext += calls.map((c, i) => `[Tool: ${c.name}]\n${String(results[i].data ?? results[i].message)}`).join("\n\n") + "\n\n";
    send({ status: "thinking" });

    history.push({
      role: "user",
      parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: { result: String(results[i].data ?? results[i].message) } } })),
    });
    pendingText = ""; // next turn is driven entirely by the functionResponse parts just pushed
  }

  // Hit MAX_ITERATIONS without a final answer — same contract as agent-loop.ts: the
  // caller appends toolContext to its own AIMessage[] history before the fallback call.
  return { done: false, hasPending: false, finalText: "", toolContext, toolsUsed };
}
```

- [ ] **Step 2: Wire it into route.ts**

Replace [app/api/coach/chat/route.ts:320-350](app/api/coach/chat/route.ts#L320-L350) (the Gemini `else` branch) with:

```typescript
        } else {
          try {
            const geminiHistory = messages.slice(0, -1).map(m => ({
              role: (m.role === "assistant" ? "model" : "user") as "model" | "user",
              parts: [{ text: m.content }],
            }));
            const loop = await runGeminiAgentLoop({
              apiKey, systemPrompt, userId, convId: convId!, describeAction, send,
              history: geminiHistory, latestUserText: messages.at(-1)!.content,
            });
            if (loop.hasPending && loop.pendingEvent) {
              send({ toolCall: loop.pendingEvent });
              hasPending = true;
            } else if (loop.done) {
              send({ text: loop.finalText });
              fullResponse = loop.finalText;
              await saveAssistantMessage(convId!, fullResponse, userId, provider, "gemini-2.5-flash", 0, 0, 0);
              send({ done: true, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
              controller.close();
              return;
            } else {
              toolsUsed = loop.toolsUsed;
              if (loop.toolContext) {
                messages.push({ role: "assistant", content: loop.toolContext });
                messages.push({ role: "user", content: "Answer my question using the tool data above." });
              }
            }
          } catch (err) { console.error("[coach/chat] gemini agent loop failed:", err instanceof Error ? err.message : err); }
        }
```

This is structurally identical to Task 2 Step 3's nvidia/groq branch by design — both loops return the exact same `AgentLoopResult` shape from Task 2's interface definition, so the `hasPending`/`done`/fallthrough handling is copy-identical, only the loop-construction call and history-shape conversion differ.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual test**

Same Step 1 repro script as Task 2, with provider switched to Gemini in Settings. Expected: multiple `toolCall` events for a multi-part question, final answer uses gathered tool data.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/gemini-loop.ts app/api/coach/chat/route.ts
git commit -m "fix: give Gemini a real multi-step tool-calling loop"
```

---

### Task 4: Cron/backfill concurrency fix (Strava stream pipeline)

**Files:**
- Modify: `lib/strava/backfill-runner.ts`
- Modify: `lib/strava/backfill.ts:190-206`
- Modify: `lib/cron.ts:65-82`
- Modify: `app/api/strava/backfill-history/route.ts` (SSE close condition)
- Modify: `app/(dashboard)/settings/strava-connect.tsx` (daily_limit is no longer an "active/waiting" state)

**Interfaces:**
- `backfillRunner` gains `startIfIdle(userId): boolean` (returns whether it actually started) so the cron path can check without needing the SSE-event machinery the UI route uses.
- `runHistoricalBackfill`'s `BackfillResult.stoppedAt` gains a `"daily_limit"` variant (was `"complete" | "stopped"`).

- [ ] **Step 1: Add a bounded daily-limit exit to `lib/strava/backfill.ts`**

In [lib/strava/backfill.ts](lib/strava/backfill.ts), change the `BackfillResult` type and the `STRAVA_DAILY_LIMIT` branch:

```typescript
export interface BackfillResult {
  done: number;
  total: number;
  errors: number;
  stoppedAt: "complete" | "stopped" | "daily_limit";
}
```

Replace the `STRAVA_DAILY_LIMIT` handling at [lib/strava/backfill.ts:191-206](lib/strava/backfill.ts#L191-L206):

```typescript
        if (e instanceof Error && e.message === "STRAVA_DAILY_LIMIT") {
          // Exit instead of blocking this invocation for up to 24h — a cron-triggered run
          // has no business holding a Node timer open that long (and node-cron will fire
          // the next scheduled run regardless, which used to stack a second concurrent
          // backfill on top of this blocked one). The next cron tick (or a manual restart)
          // picks up exactly where this left off, since the query is `splitDetailFetched:
          // false OR stream: null` — nothing here is lost, just deferred.
          onProgress?.({ type: "daily_limit", done, total, errors, waitMs: 0 });
          return { done, total, errors, stoppedAt: "daily_limit" };
        }
```

- [ ] **Step 2: Fix `daily_limit` handling in `lib/strava/backfill-runner.ts` and add `startIfIdle`**

Step 1 changed `runHistoricalBackfill` so a daily-limit hit now **returns immediately** instead of blocking-and-auto-resuming inside the same call. `BackfillRunner.start()`'s event handler was written for the old blocking behavior — it sets `job.status = "daily_limit"` and leaves it there expecting the *same* call to eventually emit `"resumed"` or `"done"` itself. After Step 1, that never happens anymore: the call has already returned. Left as-is, `job.status` would get stuck at `"daily_limit"` forever, and the new `startIfIdle` guard below would then refuse to ever start another run for that user — a worse bug than the one this task fixes. Fix the handler first, then add the guard:

In [lib/strava/backfill-runner.ts](lib/strava/backfill-runner.ts), change the `daily_limit` branch inside `start()`'s `onProgress` callback from:
```typescript
        } else if (event.type === "daily_limit") {
          job.done = event.done; job.total = event.total; job.errors = event.errors;
          job.status = "daily_limit"; job.waitMs = event.waitMs;
```
to:
```typescript
        } else if (event.type === "daily_limit") {
          // Step 1 made runHistoricalBackfill return immediately on the daily cap instead of
          // blocking 24h and auto-resuming — so this is now a terminal outcome for THIS run,
          // not a "currently waiting" state. Settle back to "idle" so startIfIdle() (added
          // below) can start a fresh run once the cap resets, instead of staying stuck.
          job.done = event.done; job.total = event.total; job.errors = event.errors;
          job.status = "idle"; delete job.waitMs;
```

(`"rate_limit"` — the 15-minute window cap, unchanged by Step 1 — still legitimately auto-resumes inside the same call, so its handler branch is untouched and `"rate_limit"` still correctly means "busy, will resume itself shortly.")

Then add this method to the `BackfillRunner` class, right after `start()`:

```typescript
  // For the cron entry point, which has no SSE listener and shouldn't fight the
  // UI-triggered backfill for the same user — returns false (no-op) if a backfill
  // is already running/paused/or mid-window-rate-limit-wait for this user via either
  // entry point. "daily_limit" is deliberately excluded — per the handler fix above,
  // a job never actually rests in that status anymore (it settles to "idle" first).
  startIfIdle(userId: string): boolean {
    const job = this.ensure(userId);
    if (job.status === "running" || job.status === "paused" || job.status === "rate_limit") return false;
    this.start(userId);
    return true;
  }
```

- [ ] **Step 3: Fix the SSE route and Settings UI for the new `daily_limit` semantics**

`app/(dashboard)/settings/strava-connect.tsx` is an existing caller that depends on the *old* meaning of `"daily_limit"` (a long-lived "currently waiting, will resume on this same connection" state) — confirmed via `grep -n "daily_limit" app/\(dashboard\)/settings/strava-connect.tsx`, which shows `isActive` treating it as ongoing (line ~313) and a status message reading "Daily limit — waiting Xh until midnight UTC, then continuing…" (line ~186-187). After Step 1-2, the backend run has already ended and settled to `"idle"` by the time that message would be displayed — left unfixed, the UI would show that message forever (the SSE connection never receives another event for this job, since "daily_limit" isn't in the stream's auto-close list either). Fix both:

In [app/api/strava/backfill-history/route.ts](app/api/strava/backfill-history/route.ts), change the `onEvent` close condition:
```typescript
        if (event.type === "done" || event.type === "stopped") {
```
to:
```typescript
        if (event.type === "done" || event.type === "stopped" || event.type === "daily_limit") {
```
(`"daily_limit"` is now always a terminal event for the run that emitted it, same as `"done"`/`"stopped"` — close the stream so the frontend doesn't wait on a connection nothing will ever write to again.)

In [app/(dashboard)/settings/strava-connect.tsx](app/(dashboard)/settings/strava-connect.tsx), update the `daily_limit` branch (around line 185-187) from:
```typescript
            } else if (d.type === "daily_limit") {
              setJobState(s => ({ ...s, status: "daily_limit", done: d.done, total: d.total, errors: d.errors, waitMs: d.waitMs,
                message: `Daily limit — waiting ${formatWait(d.waitMs)} until midnight UTC, then continuing…` }));
```
to:
```typescript
            } else if (d.type === "daily_limit") {
              // Backend now ends the run immediately on the daily cap (see backfill.ts) — this
              // is an informational one-off, not an ongoing wait. Land on "idle" so the Start
              // button reappears; tonight's cron tick (or another manual click) finishes the rest.
              setJobState(s => ({ ...s, status: "idle", done: d.done, total: d.total, errors: d.errors, waitMs: undefined,
                message: "Strava-dagsgränsen nådd — återstoden hämtas automatiskt vid nästa körning." }));
```
Also update the `isActive` calculation (around line 313):
```typescript
  const isActive = jobState.status === "running" || jobState.status === "rate_limit" || jobState.status === "daily_limit";
```
to:
```typescript
  const isActive = jobState.status === "running" || jobState.status === "rate_limit";
```
And confirm the "Start / Run again" button's render condition (around line 444, `jobState.status === "idle" || jobState.status === "done"`) already covers the new post-daily-limit `"idle"` state without further change — it does, since the fix above lands `jobState.status` on `"idle"` directly.

- [ ] **Step 4: Route the nightly cron through `backfillRunner`**

Replace [lib/cron.ts:65-82](lib/cron.ts#L65-L82) entirely:

```typescript
  // Historical activity backfill at 00:30 UTC (just after Strava's daily limit resets at
  // midnight). Goes through backfillRunner.startIfIdle() — the SAME singleton the manual
  // "start backfill" UI button uses — so a daytime user-triggered run and this nightly one
  // can never run concurrently for the same account and double up on rate-limit usage.
  cron.schedule("30 0 * * *", async () => {
    const accounts = await prisma.stravaAccount.findMany({ select: { userId: true } });
    for (const account of accounts) {
      const remaining = await prisma.activity.count({
        where: { userId: account.userId, OR: [{ splitDetailFetched: false }, { stream: null }] },
      });
      if (remaining === 0) continue;
      const started = backfillRunner.startIfIdle(account.userId);
      console.log(`[cron] Historical backfill ${account.userId}: ${remaining} remaining, started=${started}`);
    }
  });
```

Add the import at the top of `lib/cron.ts`:
```typescript
import { backfillRunner } from "@/lib/strava/backfill-runner";
```
And remove the now-unused `import { runHistoricalBackfill } from "@/lib/strava/backfill";` line if nothing else in the file uses it (confirm via grep before removing — `lib/strava/backfill-runner.ts` itself still imports it directly, `lib/cron.ts` no longer needs to).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. This also checks the now-unused-import removal in `lib/cron.ts` didn't break anything else referencing `runHistoricalBackfill` from that file.

- [ ] **Step 6: Manual verification (can't run a real 24h cycle — verify the logic path instead)**

1. Confirm via `grep -n "runHistoricalBackfill" lib/cron.ts` that the direct call is gone and only `backfillRunner.startIfIdle` remains.
2. Confirm via `grep -n "daily_limit\|startIfIdle" lib/strava/backfill-runner.ts` that the `daily_limit` event branch now sets `job.status = "idle"` (not `"daily_limit"`), and that `startIfIdle`'s guard checks `"running" | "paused" | "rate_limit"` (three statuses, not four — `daily_limit` is deliberately not one of them per Step 2's fix).
3. Confirm via `grep -n "daily_limit" app/api/strava/backfill-history/route.ts` that it's now included in the SSE auto-close condition alongside `done`/`stopped`.
4. In the running dev server, manually click "Start backfill" in Settings (goes through `backfillRunner.start`), then while it's running, check that a hypothetical concurrent `backfillRunner.startIfIdle(userId)` call would correctly return `false` — verify by temporarily logging `job.status` inside `startIfIdle` and confirming it reads `"running"` while the UI-triggered job is active. Revert the temporary logging before committing.
5. If a real account ever hits the daily limit naturally during testing, confirm in Settings: the status line shows the new Swedish message once, the "Start backfill"/"Run again" button reappears immediately afterward (not stuck on a spinner), and the SSE connection in the Network tab shows as closed, not hanging open.

- [ ] **Step 7: Update docs**

In [docs/integrations/strava.md](docs/integrations/strava.md), update the "Historical backfill" bullet under Strava sync to mention: cron and the manual UI trigger now share one concurrency guard (`backfillRunner`), and a daily-limit hit ends that run immediately (UI and cron alike) instead of blocking for up to 24h — the next cron tick or manual restart picks up where it left off.

In [docs/api/cron.md](docs/api/cron.md), update the "00:30 — Historical Strava backfill" line to note it now goes through `backfillRunner.startIfIdle()`.

- [ ] **Step 8: Commit**

```bash
git add lib/strava/backfill.ts lib/strava/backfill-runner.ts lib/cron.ts app/api/strava/backfill-history/route.ts app/\(dashboard\)/settings/strava-connect.tsx docs/integrations/strava.md docs/api/cron.md
git commit -m "fix: stop nightly Strava backfill from running concurrently with manual backfill and blocking on daily-limit waits"
```

---

### Task 5: Distinguish stream-fetch failure reasons (rate limit vs. no GPS vs. Strava error)

**Files:**
- Modify: `app/api/activities/[id]/streams/route.ts:39-53`
- Modify: `app/(dashboard)/activities/[id]/activity-charts.tsx:67-111`

**Interfaces:**
- The streams route's error response gains a `reason` field: `"rate_limited" | "daily_limit" | "strava_error"` (a missing/disconnected Strava account also surfaces as `"strava_error"` — see the note after Step 1, not a distinct reason).
- `ActivityCharts` reads `raw.reason`, plus its own frontend-only `"no_data"` reason (no distance stream returned at all), to show a specific message instead of one generic line.

- [ ] **Step 1: Modify the streams route**

Replace [app/api/activities/[id]/streams/route.ts:39-53](app/api/activities/[id]/streams/route.ts#L39-L53):

```typescript
  // Fetch live from Strava
  let streams: Record<string, { data: unknown[] }>;
  try {
    streams = await stravaFetch(
      session.user.id,
      `/activities/${activity.stravaId}/streams`,
      { keys: "time,distance,heartrate,velocity_smooth,altitude,cadence", key_by_type: "true" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[streams] fetch failed for activity ${id} (user ${session.user.id}):`, msg);
    if (msg === "STRAVA_RATE_LIMIT") return NextResponse.json({ error: "streams_unavailable", reason: "rate_limited" }, { status: 503 });
    if (msg === "STRAVA_DAILY_LIMIT") return NextResponse.json({ error: "streams_unavailable", reason: "daily_limit" }, { status: 503 });
    return NextResponse.json({ error: "streams_unavailable", reason: "strava_error" }, { status: 503 });
  }
```

(`stravaFetch` already throws `Error("No Strava account")`-shaped errors upstream via `refreshStravaToken`; that case surfaces here as `"strava_error"` too, which is acceptable — the activity wouldn't exist with a `stravaId` for a disconnected account in practice.)

- [ ] **Step 2: Modify `ActivityCharts` to show the specific reason**

In [app/(dashboard)/activities/[id]/activity-charts.tsx](app/(dashboard)/activities/[id]/activity-charts.tsx), change the `error` state from `boolean` to hold the reason, and update the fetch handler and render branch:

```typescript
  const [error, setError] = useState<"rate_limited" | "daily_limit" | "strava_error" | "no_data" | null>(null);
```

In the `.then(raw => ...)` handler (around line 70-77), replace:
```typescript
        if (raw.error) { setError(true); return; }
```
with:
```typescript
        if (raw.error) { setError(raw.reason ?? "strava_error"); return; }
```
and the `dist.length === 0` branch:
```typescript
        if (dist.length === 0) { setError("no_data"); return; }
```
and the `.catch()`:
```typescript
      .catch(() => setError("strava_error"))
```

Replace the error render block (around [activity-charts.tsx:129-133](app/(dashboard)/activities/[id]/activity-charts.tsx#L129-L133)):

```typescript
  if (error || data.length === 0) {
    const msg = error === "rate_limited" || error === "daily_limit"
      ? "Strava-hastighetsgränsen är tillfälligt nådd — försök igen om en stund."
      : error === "no_data"
      ? "Stream-data saknas för detta pass — kräver GPS-data från Strava."
      : "Kunde inte hämta stream-data från Strava just nu.";
    return <p className="text-sm text-muted py-4">{msg}</p>;
  }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

1. View an activity known to have GPS+HR data — confirm the chart still renders normally (no regression).
2. If reachable, view an activity with no GPS (e.g. a manually-logged strength session) — confirm the message now says "kräver GPS-data" specifically, not a generic error.
3. Check server logs after Task 4 ships — the new `console.error` line at Step 1 includes `userId`/`activityId`/`msg`, which is what to grep for if streams stop loading again in the future (this is the missing diagnostic the original bug report had no way to produce).

- [ ] **Step 5: Commit**

```bash
git add app/api/activities/\[id\]/streams/route.ts app/\(dashboard\)/activities/\[id\]/activity-charts.tsx
git commit -m "fix: surface specific reasons when activity stream charts fail to load"
```

---

### Task 6: Markdown + lightweight chart/table rendering in the coach chat

**Files:**
- Modify: `package.json` (add `react-markdown`, `remark-gfm`)
- Create: `components/coach/ChatChart.tsx`
- Modify: `components/coach/ChatInterface.tsx:449-463`
- Modify: `lib/ai/prompts.ts:87-92`
- Modify: `docs/api/coach.md` (remove stale `plan-action` section, document the new chart/table convention)

**Interfaces:**
- `ChatChart` consumes a fenced ` ```chat-chart` block's JSON body: `{ type: "line" | "bar"; xLabel: string; series: { name: string; data: { x: string | number; y: number }[] }[] }`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add react-markdown remark-gfm
```

- [ ] **Step 2: Write `components/coach/ChatChart.tsx`**

```typescript
"use client";

import { ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface ChatChartSpec {
  type: "line" | "bar";
  xLabel?: string;
  series: { name: string; data: { x: string | number; y: number }[] }[];
}

const COLORS = ["#6EE7B7", "#F87171", "#818CF8", "#FBBF24"];

export function ChatChart({ spec }: { spec: ChatChartSpec }) {
  const xValues = spec.series[0]?.data.map(d => d.x) ?? [];
  const merged = xValues.map((x, i) => {
    const row: Record<string, string | number> = { x };
    spec.series.forEach(s => { row[s.name] = s.data[i]?.y; });
    return row;
  });
  const Chart = spec.type === "bar" ? BarChart : LineChart;
  return (
    <div className="rounded-xl bg-surface-2 border border-border p-3" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} />
          <Tooltip />
          {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {spec.series.map((s, i) => spec.type === "bar"
            ? <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            : <Line key={s.name} dataKey={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function tryParseChatChart(jsonText: string): ChatChartSpec | null {
  try {
    const parsed = JSON.parse(jsonText) as ChatChartSpec;
    if (parsed.type && Array.isArray(parsed.series)) return parsed;
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Render markdown + chart blocks in `ChatInterface.tsx`**

Add imports at the top of [components/coach/ChatInterface.tsx](components/coach/ChatInterface.tsx):
```typescript
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatChart, tryParseChatChart } from "./ChatChart";
```

Replace the content render block at [components/coach/ChatInterface.tsx:449-463](components/coach/ChatInterface.tsx#L449-L463):

```typescript
                <div className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-accent/10 text-primary rounded-tr-none whitespace-pre-wrap"
                    : "bg-surface border border-border rounded-tl-none prose prose-sm prose-invert:dark max-w-none [&_table]:text-xs [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5"
                )}>
                  {msg.role === "user" ? msg.content : msg.content
                    ? <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ className, children }) {
                            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
                            if (lang === "chat-chart") {
                              const spec = tryParseChatChart(String(children));
                              if (spec) return <ChatChart spec={spec} />;
                            }
                            return <code className={className}>{children}</code>;
                          },
                        }}
                      >{msg.content}</ReactMarkdown>
                    : (streaming && msg.role === "assistant"
                      ? (
                        <span className="flex items-center gap-2 text-muted not-prose">
                          <Loader2 size={14} className="animate-spin shrink-0" />
                          {msg.statusLabel && <span className="text-xs">{msg.statusLabel}</span>}
                        </span>
                      )
                      : "")}
                </div>
```

Note: this project doesn't have `@tailwindcss/typography` installed — the `prose` class above requires it. Add it in Step 1 alongside the markdown deps:
```bash
pnpm add -D @tailwindcss/typography
```
And register it in the Tailwind config (`tailwind.config.ts` or the CSS `@plugin` directive, depending on which v4 convention this project's `app/globals.css` already uses — check there first before adding a duplicate registration).

- [ ] **Step 4: Update the system prompt**

In [lib/ai/prompts.ts:87-92](lib/ai/prompts.ts#L87-L92), add a new bullet to "Coach instructions":

```typescript
- Format numeric comparisons and lists as markdown tables — they now render properly in the UI
- For time-series data (pace/HR over multiple sessions, weekly volume trends), prefer a \`\`\`chat-chart\`\`\` fenced block over a markdown table: \`{"type":"line"|"bar","series":[{"name":"...","data":[{"x":"...","y":0}]}]}\` — keep it to 1-3 series and under ~20 points per series
```

- [ ] **Step 5: Remove the stale `plan-action` doc section**

Delete [docs/api/coach.md:53-65](docs/api/coach.md#L53-L65) (the "## Plan actions" section) — confirmed unimplemented in `ChatInterface.tsx`, superseded by the `create_workout` tool + approval-card flow that's actually live. Add a new section in its place documenting the `chat-chart` block convention from Step 4.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `pnpm build --no-lint`
Expected: both pass clean.

- [ ] **Step 7: Manual verification**

1. `pnpm dev`, open `/coach`, ask a question that elicits a markdown table (e.g. "Jämför mina senaste 4 veckor mot förra månaden i en tabell"). Confirm it renders as an actual HTML table, not pipe characters.
2. Ask a question likely to trigger a chart per the new system-prompt instruction (e.g. "Visa min veckovolym de senaste 8 veckorna som ett diagram"). Confirm either a rendered chart appears or — if the model didn't use the new block — that the markdown table fallback at minimum still renders correctly.
3. Confirm user messages (right-aligned bubbles) are unaffected — they still render as plain text, not markdown (a user typing literal `*` or `#` shouldn't get reformatted).
4. Kill the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml components/coach/ChatChart.tsx components/coach/ChatInterface.tsx lib/ai/prompts.ts docs/api/coach.md
git commit -m "feat: render markdown tables and simple charts in coach chat instead of raw text"
```

---

### Task 7: `docs/api/coach.md` provider-loop documentation

**Files:**
- Modify: `docs/api/coach.md`

**Interfaces:** none (docs only). `docs/schemas/ai-context.md` is deliberately **not** touched by this task — Part E4 explains why: nothing in this plan changes *what* data is sent to the model, only how reliably tool calls execute, so that doc's contract stays accurate as-is.

- [ ] **Step 1: Update the Providers section**

In [docs/api/coach.md](docs/api/coach.md), replace the "**Providers:**" bullet list (currently only mentions claude/gemini) to list all four providers and note: "All four providers now run the same multi-step tool-calling pattern: tools are attached on every model call (not just the first), up to 6 iterations, parallel tool execution, write-tools pause for user approval." Reference `lib/ai/agent-loop.ts` (NVIDIA/Groq) and `lib/ai/gemini-loop.ts` (Gemini) as the shared implementations, alongside the existing Claude loop inline in `route.ts`.

- [ ] **Step 2: Commit**

```bash
git add docs/api/coach.md
git commit -m "docs: document the multi-provider agentic tool-calling loop"
```

---

### Task 8 (optional polish, not a confirmed bug): `search_activities` empty-result hint

**Files:**
- Modify: `lib/ai/tools.ts:437` (the `acts.length === 0` branch inside `search_activities`)

This is explicitly **not** required to fix any of the audited bugs (A3 concluded the tool already works correctly) — it's a small, low-risk usability nicety that becomes easy to use correctly now that Tasks 2-3 give every provider a working loop to act on the hint.

- [ ] **Step 1: Modify the empty-result branch**

Replace [lib/ai/tools.ts:437](lib/ai/tools.ts#L437):
```typescript
        if (acts.length === 0) return { success: true, message: "No activities found.", data: "No activities found matching the criteria." };
```
with:
```typescript
        if (acts.length === 0) {
          if (query) {
            const recent = await prisma.activity.findMany({
              where: { userId, startDate: { gte: dateFrom, lte: dateTo } },
              orderBy: { startDate: "desc" }, take: 5,
              select: { id: true, name: true, startDate: true, sportType: true },
            });
            const hint = recent.length > 0
              ? `No match for "${query}". Most recent activities in range: ${recent.map(a => `[id:${a.id}] ${format(a.startDate, "yyyy-MM-dd")} "${a.name}" (${a.sportType})`).join("; ")}`
              : "No activities found matching the criteria.";
            return { success: true, message: "No exact match — recent activities listed instead.", data: hint };
          }
          return { success: true, message: "No activities found.", data: "No activities found matching the criteria." };
        }
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/tools.ts
git commit -m "feat: search_activities suggests recent activities when a keyword search finds nothing"
```

---

## Part E — Full audit & testing suite

This is the mandatory end-to-end verification pass, run **after all tasks above are implemented**, before this plan is archived. This project has no automated test runner, so "testing" here means: static verification (type-check/build), targeted manual reproduction of every bug in Part A against the running app, and an explicit regression check of everything this plan did *not* intend to touch.

### E1. Static verification

- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `pnpm build --no-lint` — builds clean (per CLAUDE.md Session End rule, this must pass before anything is pushed).
- [ ] `grep -rn "tool_calls_section\|<|tool_call" lib/ai app/api/coach` — should only match `lib/ai/kimi-fallback.ts` (the intentional parser/sanitizer); if it matches anywhere else, a leak path was missed.
- [ ] `grep -n "runHistoricalBackfill" lib/cron.ts` — should return nothing (Task 4 removed the direct call).

### E2. Bug-for-bug re-verification against Part A

For each, re-run with the dev server (`pnpm dev`, kill afterward per CLAUDE.md):

- [ ] **A1 (leaked tokens):** Re-run the exact conversation from `prompt2.md` against NVIDIA/Kimi K2.6 — ask about "7x4min/90s", let it fail to find an exact match, then ask "Kan du inte hämta data om passen alls? Undersök för debug reasons vilka verktyg du kan använda, testa alla skills" (the literal line that triggered the original leak). Confirm the rendered reply contains zero `<|tool_call` substrings and that real tool-result data (or a clean natural-language admission of failure) appears instead.
- [ ] **A2 (multi-step loop):** For each of NVIDIA, Groq, and Gemini (Claude already worked — confirm it *still* works, see E3), ask a question that needs 2+ sequential tool calls (e.g. "Jämför min snittpace för löpning de senaste 4 veckorna mot samma period förra året" — requires two `get_volume_stats`/`analyze_full_history`-style calls or `search_activities` + `get_activity_detail` in sequence). Confirm via the Network tab's SSE stream that 2+ `toolCall` events fire in one turn for each provider.
- [ ] **A3 (search by name):** Confirm `search_activities` with a `query` that matches an activity's actual title returns it correctly (already worked — this is a no-regression check, not a fix-verification).
- [ ] **A4 (streams):** View at least 3 different activities (most recent, one mid-history, one with no GPS if any exist) and confirm pace/HR/elevation charts load with the *specific* error reason (Task 5) on the ones that fail, not a generic message. If a real Strava account with backfill history is available, additionally check server logs across a day for repeated/overlapping `[backfill]` log lines for the same `userId` — there should be exactly one active run at a time.
- [ ] **A5 (markdown rendering):** Confirm tables/bold/lists render as real HTML in assistant bubbles, confirm user bubbles are unaffected, confirm a `chat-chart` block (if the model emits one) renders as an actual chart.
- [ ] **A6 (full-DB-as-context framing):** Ask a question about an activity from 6+ months ago (outside the 28-day per-message summary and outside the 90-day system-prompt window) — confirm the model successfully reaches it via `search_activities`/`analyze_full_history` tool calls rather than claiming it has no access, for at least NVIDIA/Kimi (the user's actual provider).

### E3. Regression check — confirm nothing untouched broke

- [ ] **Claude path unchanged:** Run one multi-tool-call conversation against Claude (if a key is available) and confirm behavior is identical to before this plan (still 6-iteration loop, still parallel execution, still pauses for write-tool approval). Task 2/3 never touch `app/api/coach/chat/route.ts:153-283`.
- [ ] **Write-tool approval + undo flow:** Trigger a `create_workout` tool call via chat on each of the 4 providers, approve it, confirm it lands in the planner, then use the chat's "Ångra" (undo) button and confirm `CoachEdit`/`PlannedWorkout` revert correctly. This flow is shared code (`executeCoachTool`, `CoachEdit`) that all four loops now call identically — a single regression here would affect every provider, so it's worth checking on at least 2 of the 4.
- [ ] **Rate-limit fallback (`streamWithFallback`) unaffected:** This logic lives entirely in `route.ts`'s shared helper, untouched by Tasks 2-3 (those tasks only replace the tool-detection phase before the final streaming call, not `streamWithFallback` itself). Spot-check that a 429 from the primary provider still triggers the NVIDIA Nemotron fallback notice banner.
- [ ] **Cost tracking:** Confirm `Message.tokensUsed`/`estimatedCostUsd` still populate correctly for nvidia/groq after Task 2 — note the new loop's tool-detection iterations don't carry token-usage data the way the old single-call did; the final streaming call (unchanged, still goes through `streamWithFallback`) is what actually reports usage, so this should already be correct, but confirm the `$0.00xx` cost label still appears under nvidia/groq replies in the UI.
- [ ] **Backfill UI (pause/resume/stop buttons in Settings) unaffected:** Task 4's Step 3 deliberately changes how a `daily_limit` event is displayed (see A4), but the pause/resume/stop control flow itself — `backfillRunner.start/pause/resume/stop` — is untouched. Click through pause → resume → stop once to confirm those three still work, and separately confirm a `daily_limit` event (if reachable) now lands on "idle" with the Swedish one-off message instead of a stuck "waiting" state (see Task 4 Step 6, item 5).
- [ ] **Activity detail page for a normal GPS run unaffected:** Task 5 only changes error-path behavior; confirm a known-good activity's chart still renders pixel-identical to before.

### E4. Documentation consistency check

- [ ] `docs/api/coach.md` — providers list and chart/table convention match what's actually implemented (Task 6/7).
- [ ] `docs/integrations/strava.md` — backfill/cron concurrency description matches Task 4's actual code.
- [ ] `docs/api/cron.md` — 00:30 job description matches Task 4.
- [ ] `docs/schemas/ai-context.md` — re-read after all tasks; confirm nothing in this plan changed *what* is sent to the model (it didn't — only *how reliably tools execute* changed), so no edit should be needed there. If anything in implementation drifted from that (e.g. a task accidentally included raw stream data in a tool's text output beyond what `get_activity_stream`'s existing aggregation already does), fix the code, not the doc.

### E5. Archive this plan

Once E1-E4 are all checked off and any findings from "Step 5/manual verification" sub-items are resolved, move this file to `docs/planning/archive/` per the `docs/` folder convention ("planning/ — active research... archive/ once resolved").

---

## Part F — What this plan deliberately does NOT do

- **Does not send the whole database (or even the whole activity history) as literal AI context.** See Part B — the fix for "the AI should reach everything" is a working tool-calling loop, not context stuffing, and the latter would violate the project's own Hard Rule.
- **Does not touch Claude's existing agentic loop logic** in `route.ts:153-283` — it already works; Task 2/3 add parallel implementations for the other three providers rather than risk the one path that's proven.
- **Does not add a test framework.** Out of scope for this bug-fix plan; verification follows the project's existing manual/build-check convention. Worth a separate, explicit decision with the user if ongoing AI-coach reliability work continues to need this much manual re-verification per change.
- **Does not implement literal "send unprompted follow-up chat messages over time."** The transcript's "let it continue" read as wanting multi-step *tool use within one turn* (which Claude already does and this plan extends to the rest), not autonomous messaging without a user prompt — flagged explicitly in case that's a distinct, separate feature request the user actually meant.
- **Does not build a literal multi-agent system** (separate planner/retriever/writer agents talking to each other). "Köra flera agenter åt gången" in the original prompt is read here as the same underlying ask as "call multiple tools in parallel / keep going across several tool calls" — which the system prompt ([lib/ai/prompts.ts:79](lib/ai/prompts.ts#L79)) already frames as "you can call multiple tools per turn in parallel," and which Tasks 2-3 make actually work for every provider. If a genuinely separate multi-agent architecture (distinct specialized agents, not one model calling tools) was intended instead, that's a much larger, separate design question worth its own brainstorming session before a plan — flagged here rather than assumed.
- **No Prisma schema changes.** Every fix in this plan is application logic; nothing here requires `prisma db push`. (Part G below adds one *optional* task that does need a schema change — flagged explicitly there, separate from this constraint.)

---

## Part G — Roadmap: building a genuinely competent AI coach (research-grounded)

Parts A-F fix the plumbing — every provider can now reliably call tools. This section answers the follow-up question: once the plumbing works, what does it actually take to make the coach *competent* — able to answer questions, run specific analyses, and do reliable comparisons against the athlete's full history, the way the user described wanting? Grounded in a focused pass of current (2025-2026) research and industry practice, not intuition.

### G1. Research summary

**G1.1 — Scientific grounding is the dominant failure mode, not raw capability.** A scoping review of LLM-based exercise/health coaching found no standardized evaluation framework and flagged factual accuracy/hallucination as the foundational challenge (Evaluation Strategies for LLM-Based Models in Exercise and Health Coaching, JMIR 2025). A direct test of chatbot sports-nutrition accuracy found a **31-74% accuracy range across models** depending on provider. This matches what actually happened in the original transcript: the model produced confident, precisely-numbered heat-adjustment claims ("3-6 sek/km" / "2-4% per 5°C") with no cited source — plausible-sounding, unverifiable numbers, the exact pattern this research warns about.

**G1.2 — Domain knowledge grounding measurably fixes this.** A knowledge-grounded LLM system for personalized training plans (LLM-SPTRec, *Scientific Reports* 2026) built a ~10,000-triple sports-science knowledge graph (exercises, principles, contraindications) and a retrieval pipeline that injects relevant entries into the prompt before generation, plus a rule-based post-generation validator. Ablating the knowledge graph dropped the system's Plan Coherence score by **31.8%** and human-rated Safety from **4.8/5 down to 3.1/5** for the same base model with no grounding. The lesson generalizes directly: an LLM with *no* curated domain reference invents plausible numbers; one with a small, curated, citable reference doesn't.

**G1.3 — Tool-augmented numeric reasoning measurably beats "mental math."** Research on tool-integrated reasoning (Program-of-Thoughts, ReTool, SciAgent and related 2025-2026 work) consistently shows LLMs given a callable computation tool outperform the same model reasoning in plain text — one survey found **+5.3 percentage points absolute / +61.6% relative accuracy** when math moves from in-context reasoning to an executable tool call. TrainingLab's existing design already follows this for *single-number* queries (every fitness metric is precomputed server-side and handed to the model as text — see `lib/fitness/`), but **comparisons between two periods/activities are not precomputed** — the model is left to subtract two separate tool outputs in its head, which is exactly the failure mode this research warns about, and exactly what the original transcript's "jämför med liknande pass" (compare with a similar session) request needed and didn't get.

**G1.4 — Coaching-dialogue architecture: prompt chaining over single-shot prompting.** GPTCoach (CHI 2025) found a single vanilla LLM call for physical-activity coaching "struggled to adhere to structure... had a strong tendency to give unsolicited advice," and fixed this with staged prompt chains (what stage of the conversation → what coaching strategy → whether to pull data) rather than one big prompt. Its most relevant *failure* mode for TrainingLab: even with data access, the system scored only **3.7/5 on providing new insights** and **2.5/5 on avoiding generic advice** — access to data alone doesn't guarantee the model actually uses it well; tool use "was variable, sometimes failing to proactively incorporate data into its advice." [lib/ai/prompts.ts](lib/ai/prompts.ts)'s existing "Be concise — cite actual sessions, dates, and metrics from tool output" instruction is the right idea but, per this finding, needs reinforcing rather than assuming it's sufficient on its own.

**G1.5 — Memory architecture for personal AI agents.** 2026 surveys of agent-memory frameworks (Mem0, Letta/MemGPT, Zep) converge on a common pattern: production agents need **working memory** (current context — TrainingLab already has this via the cached system prompt), **semantic memory** (durable extracted facts/preferences — TrainingLab does **not** have this; nothing persists "the athlete mentioned a chronic left knee issue" or "doesn't like Sunday long runs" across conversations beyond whatever's in the last 20 raw messages), and a **forgetting/relevance policy**. Mem0 is explicitly recommended as "the right default for 2026 consumer apps where 'remember the user' is the feature" over heavier frameworks like Letta, which is aimed at autonomous long-horizon agents — a relevant calibration signal for an app this size.

**G1.6 — Industry pattern: establish a baseline from historical data, then layer the LLM on top.** WHOOP Coach (GPT-4-based), and aggregator apps like SensAI/Athletedata, all follow the same shape — a non-LLM analytics layer establishes recovery/fitness baselines from wearable history, and the LLM is a *reasoning and explanation layer* on top of those precomputed numbers, never the thing computing them. This is precisely TrainingLab's existing `FitnessCache` + `lib/fitness/` architecture — confirms it's the right foundation, not something to rearchitect.

**G1.7 — Injury/overtraining signal: ACWR + HRV, already computed, not yet surfaced proactively.** A systematic review and meta-analysis of Acute:Chronic Workload Ratio (ACWR) found the **0.8-1.3 range associated with lower injury risk** and **sustained ratios above ~1.5 associated with elevated risk**; separate ML work ranks **ACWR as the single most influential predictor of injury risk, with HRV second**. TrainingLab's `FitnessCache.acwr` and Garmin HRV data are both already computed and queryable (`get_fitness_summary`, `get_readiness`) — but neither is surfaced *proactively* in the cached system prompt; the model only sees them if it happens to call the right tool.

**G1.8 — Evaluation/QA frameworks exist but are sized for product teams, not personal apps.** Rubric-based LLM-as-judge evaluation pipelines are now standard practice for production AI products (continuous evaluation on every prompt change, multi-model grading, human calibration). This is real, useful infrastructure — and explicitly disproportionate to build out for a single-developer, closed-invite personal app. Noted here so the decision to *not* build it is informed rather than an oversight (see Task 13).

Sources: [Evaluation Strategies for LLM-Based Models in Exercise and Health Coaching (JMIR 2025)](https://www.jmir.org/2025/1/e79217), [sports nutrition chatbot accuracy study (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12165421/), [Knowledge-grounded LLM for personalized sports training plan generation (Scientific Reports 2026 / PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12916763/), [GPTCoach (CHI 2025)](https://arxiv.org/html/2405.06061v2), [Best AI Agent Memory Frameworks 2026 (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/), [Mem0 vs Letta (MemGPT) comparison](https://vectorize.io/articles/mem0-vs-letta), [WHOOP Coach announcement](https://www.whoop.com/us/en/thelocker/whoop-unveils-the-new-whoop-coach-powered-by-openai/), [ACWR systematic review and meta-analysis (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/), [ML-based sports injury risk assessment using training load (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11366842/).

### G2. What TrainingLab already gets right — confirmed, not redone

- **Precomputed metrics, not LLM mental math** (`lib/fitness/`, `FitnessCache`) — matches G1.3 and G1.6 directly. No change needed.
- **Curated/summarized context instead of context stuffing** (Part B of this plan) — matches the 2026 agentic-RAG consensus in G1.6/G1.5. No change needed.
- **`search_training_research` (PubMed) and `web_search` (Tavily) tools already exist** — a partial answer to G1.1/G1.2's grounding concern for *novel* questions. Task 10 below adds the missing piece: a curated reference for the small set of *recurring* physiological questions (heat, altitude, taper) where live web search produces inconsistent, unsourced numbers each time instead of one vetted answer reused consistently.

### G3. New tasks

These are additive to Tasks 1-8 — they assume the agentic-loop fix (Tasks 2-3) is already in place, since several of these tools are only reliably reachable once multi-step tool calling works for every provider.

---

#### Task 9: `compare_activities` and `compare_periods` tools — server-side comparison, not LLM mental math

Directly fixes the scenario in the original bug report ("jämför med liknande pass") and is the most direct implementation of G1.3.

**Files:**
- Modify: `lib/ai/tools.ts` (add two tool schemas to `COACH_TOOLS`, two executor cases)
- Modify: `lib/ai/prompts.ts` (point the model at these instead of manual diffing)

**Interfaces:**
- `compare_activities(activity_id_a, activity_id_b)` — returns a precomputed side-by-side diff: distance/time/pace/HR/elevation/weather deltas, plus a rep-by-rep split comparison when both activities have a similar split count (the exact "5x4min vs 7x4min" case from the transcript — compares as many corresponding reps as both have, flags the count mismatch explicitly rather than silently misaligning them).
- `compare_periods(date_from_a, date_to_a, date_from_b, date_to_b, sport?)` — returns precomputed volume/pace/HR/TSS deltas between two date ranges, reusing the same aggregation `get_volume_stats` already does per-period, but computing the diff server-side instead of leaving it to the model.

- [ ] **Step 1: Add the two tool schemas**

In [lib/ai/tools.ts](lib/ai/tools.ts), add to `COACH_TOOLS` (after `get_segment_history`, staying in the "Activity tools" group):

```typescript
  {
    name: "compare_activities",
    description: "Compares two specific activities side by side: distance, time, pace, HR, elevation, weather deltas, and a rep-by-rep split comparison if both have comparable interval structure. Use this instead of calling get_activity_detail twice and comparing manually — the deltas are computed exactly, not estimated.",
    input_schema: {
      type: "object" as const,
      properties: {
        activity_id_a: { type: "string", description: "First activity ID (e.g. the more recent one)" },
        activity_id_b: { type: "string", description: "Second activity ID to compare against" },
      },
      required: ["activity_id_a", "activity_id_b"],
    },
  },
  {
    name: "compare_periods",
    description: "Compares aggregate training volume, pace, HR, and TSS between two date ranges (e.g. this month vs the same month last year). Returns exact deltas computed server-side — use this instead of calling get_volume_stats twice and subtracting the numbers yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from_a: { type: "string", description: "Period A start YYYY-MM-DD" },
        date_to_a:   { type: "string", description: "Period A end YYYY-MM-DD" },
        date_from_b: { type: "string", description: "Period B start YYYY-MM-DD" },
        date_to_b:   { type: "string", description: "Period B end YYYY-MM-DD" },
        sport:       { type: "string", description: "Sport filter (optional)" },
      },
      required: ["date_from_a", "date_to_a", "date_from_b", "date_to_b"],
    },
  },
```

- [ ] **Step 2: Implement the executors**

In [lib/ai/tools.ts](lib/ai/tools.ts)'s `executeCoachTool` switch, add two new cases (after `get_segment_history`):

```typescript
      // ── compare_activities ────────────────────────────────────────────────
      case "compare_activities": {
        const [a, b] = await Promise.all([
          prisma.activity.findUnique({ where: { id: input.activity_id_a as string }, select: { id: true, userId: true, name: true, sportType: true, startDate: true, distance: true, movingTime: true, averageSpeed: true, averageHeartrate: true, totalElevationGain: true, weatherTemp: true, splitsMetric: true } }),
          prisma.activity.findUnique({ where: { id: input.activity_id_b as string }, select: { id: true, userId: true, name: true, sportType: true, startDate: true, distance: true, movingTime: true, averageSpeed: true, averageHeartrate: true, totalElevationGain: true, weatherTemp: true, splitsMetric: true } }),
        ]);
        if (!a || a.userId !== userId || !b || b.userId !== userId) return { success: false, message: "One or both activities not found.", data: "error: not found or unauthorized" };

        const paceStr = (speedMs: number | null) => {
          if (!speedMs) return "—";
          const s = 1000 / speedMs;
          return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;
        };
        const lines: string[] = [
          `A: ${a.name} (${format(a.startDate, "yyyy-MM-dd")}) — ${(a.distance / 1000).toFixed(1)}km, ${Math.floor(a.movingTime / 60)}min, ${paceStr(a.averageSpeed)}, ${a.averageHeartrate ? Math.round(a.averageHeartrate) + "bpm" : "no HR"}, ${Math.round(a.totalElevationGain)}m elev${a.weatherTemp != null ? `, ${Math.round(a.weatherTemp)}°C` : ""}`,
          `B: ${b.name} (${format(b.startDate, "yyyy-MM-dd")}) — ${(b.distance / 1000).toFixed(1)}km, ${Math.floor(b.movingTime / 60)}min, ${paceStr(b.averageSpeed)}, ${b.averageHeartrate ? Math.round(b.averageHeartrate) + "bpm" : "no HR"}, ${Math.round(b.totalElevationGain)}m elev${b.weatherTemp != null ? `, ${Math.round(b.weatherTemp)}°C` : ""}`,
          "",
          "Deltas (A − B):",
          `  Distance: ${((a.distance - b.distance) / 1000).toFixed(1)}km`,
          `  Time: ${Math.round((a.movingTime - b.movingTime) / 60)}min`,
        ];
        if (a.averageSpeed && b.averageSpeed) {
          const paceDeltaSec = Math.round(1000 / a.averageSpeed - 1000 / b.averageSpeed);
          lines.push(`  Pace: ${paceDeltaSec >= 0 ? "+" : ""}${paceDeltaSec}sec/km (positive = A slower)`);
        }
        if (a.averageHeartrate && b.averageHeartrate) lines.push(`  HR: ${Math.round(a.averageHeartrate - b.averageHeartrate)}bpm`);
        if (a.weatherTemp != null && b.weatherTemp != null) lines.push(`  Weather: ${Math.round(a.weatherTemp - b.weatherTemp)}°C`);

        type Split = { split: number; moving_time: number; average_speed: number; average_heartrate?: number };
        const splitsA = (a.splitsMetric as Split[] | null)?.filter(s => s.moving_time > 0 && s.average_speed > 0) ?? [];
        const splitsB = (b.splitsMetric as Split[] | null)?.filter(s => s.moving_time > 0 && s.average_speed > 0) ?? [];
        if (splitsA.length >= 2 && splitsB.length >= 2) {
          const n = Math.min(splitsA.length, splitsB.length);
          lines.push("", `Rep-by-rep (first ${n} of ${splitsA.length} vs ${splitsB.length} — counts ${splitsA.length === splitsB.length ? "match" : "DIFFER, compare with care"}):`);
          for (let i = 0; i < n; i++) {
            const pa = paceStr(splitsA[i].average_speed), pb = paceStr(splitsB[i].average_speed);
            const hrA = splitsA[i].average_heartrate ? `${Math.round(splitsA[i].average_heartrate!)}bpm` : "—";
            const hrB = splitsB[i].average_heartrate ? `${Math.round(splitsB[i].average_heartrate!)}bpm` : "—";
            lines.push(`  Rep ${i + 1}: A ${pa} ${hrA}  vs  B ${pb} ${hrB}`);
          }
        }
        return { success: true, message: `Compared: ${a.name} vs ${b.name}`, data: lines.join("\n") };
      }

      // ── compare_periods ───────────────────────────────────────────────────
      case "compare_periods": {
        const sport = input.sport as string | undefined;
        const where = (from: Date, to: Date) => ({ userId, startDate: { gte: from, lte: to }, ...(sport ? { sportType: { contains: sport, mode: "insensitive" as const } } : {}) });
        const [actsA, actsB] = await Promise.all([
          prisma.activity.findMany({ where: where(new Date(input.date_from_a as string), new Date(input.date_to_a as string)), select: { distance: true, movingTime: true, averageSpeed: true, averageHeartrate: true, trainingLoad: true } }),
          prisma.activity.findMany({ where: where(new Date(input.date_from_b as string), new Date(input.date_to_b as string)), select: { distance: true, movingTime: true, averageSpeed: true, averageHeartrate: true, trainingLoad: true } }),
        ]);
        const agg = (acts: typeof actsA) => ({
          km: acts.reduce((s, a) => s + a.distance / 1000, 0),
          hours: acts.reduce((s, a) => s + a.movingTime, 0) / 3600,
          tss: acts.reduce((s, a) => s + (a.trainingLoad ?? 0), 0),
          count: acts.length,
          avgPaceSecKm: (() => {
            const speeds = acts.map(a => a.averageSpeed).filter((v): v is number => !!v && v > 0);
            return speeds.length ? 1000 / (speeds.reduce((s, v) => s + v, 0) / speeds.length) : null;
          })(),
          avgHR: (() => {
            const hrs = acts.map(a => a.averageHeartrate).filter((v): v is number => !!v);
            return hrs.length ? hrs.reduce((s, v) => s + v, 0) / hrs.length : null;
          })(),
        });
        const A = agg(actsA), B = agg(actsB);
        const pct = (a: number, b: number) => b === 0 ? "n/a" : `${a - b >= 0 ? "+" : ""}${Math.round((a - b) / b * 100)}%`;
        const lines = [
          `Period A: ${A.count} sessions, ${A.km.toFixed(1)}km, ${A.hours.toFixed(1)}h, ${Math.round(A.tss)} TSS${A.avgPaceSecKm ? `, avg ${Math.floor(A.avgPaceSecKm / 60)}:${String(Math.round(A.avgPaceSecKm % 60)).padStart(2, "0")}/km` : ""}${A.avgHR ? `, ${Math.round(A.avgHR)}bpm avg` : ""}`,
          `Period B: ${B.count} sessions, ${B.km.toFixed(1)}km, ${B.hours.toFixed(1)}h, ${Math.round(B.tss)} TSS${B.avgPaceSecKm ? `, avg ${Math.floor(B.avgPaceSecKm / 60)}:${String(Math.round(B.avgPaceSecKm % 60)).padStart(2, "0")}/km` : ""}${B.avgHR ? `, ${Math.round(B.avgHR)}bpm avg` : ""}`,
          "",
          `Volume: ${pct(A.km, B.km)} (${(A.km - B.km).toFixed(1)}km)`,
          `Time: ${pct(A.hours, B.hours)}`,
          `TSS: ${pct(A.tss, B.tss)}`,
          A.avgPaceSecKm && B.avgPaceSecKm ? `Pace: ${Math.round(A.avgPaceSecKm - B.avgPaceSecKm) >= 0 ? "+" : ""}${Math.round(A.avgPaceSecKm - B.avgPaceSecKm)}sec/km (positive = A slower)` : "",
          A.avgHR && B.avgHR ? `HR: ${Math.round(A.avgHR - B.avgHR) >= 0 ? "+" : ""}${Math.round(A.avgHR - B.avgHR)}bpm` : "",
        ].filter(Boolean);
        return { success: true, message: "Period comparison", data: lines.join("\n") };
      }
```

- [ ] **Step 3: Point the model at the new tools**

In [lib/ai/prompts.ts](lib/ai/prompts.ts)'s tool list (line 81), add `compare_activities, compare_periods` to the read-tools list, and add to "Coach instructions" (after the existing "For any analysis that compares two time periods..." line):

```typescript
- For comparing two specific activities or two date ranges, always call compare_activities/compare_periods rather than computing the difference yourself from two separate tool calls — the deltas it returns are exact, not estimated
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Ask the coach (any provider, post-Task-2/3 fix): "Jämför mitt senaste intervallpass med ett liknande från i våras" (compare my latest interval session with a similar one from spring). Confirm `compare_activities` gets called (visible as a tool-action card) instead of the model fetching both via `get_activity_detail` and eyeballing the difference in text.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/tools.ts lib/ai/prompts.ts
git commit -m "feat: add compare_activities and compare_periods tools for server-side comparison instead of LLM mental math"
```

---

#### Task 10: curated training-science reference tool — ground physiological claims instead of inventing numbers

Directly fixes the heat-adjustment scenario from the original transcript, grounded in G1.1/G1.2.

**Files:**
- Create: `lib/ai/training-science-reference.ts`
- Modify: `lib/ai/tools.ts` (one new read-only tool, no DB access needed)
- Modify: `lib/ai/prompts.ts`

- [ ] **Step 1: Write the curated reference**

```typescript
// lib/ai/training-science-reference.ts
// Curated, app-maintained reference for recurring physiological adjustment questions.
// These are applied "rules of thumb" from the cited consensus literature, not measured
// values for any specific athlete — the coach must present them as estimates and prefer
// the athlete's own historical data (via search_activities/compare_activities) when available.

export const TRAINING_SCIENCE_REFERENCE = {
  heat: {
    topic: "Heat adaptation and pace adjustment",
    guidance: [
      "Above ~15°C, expect a measurable pace decrement at the same HR/effort for a non-heat-acclimatized athlete; the effect accelerates non-linearly above ~25°C, more so with high humidity.",
      "Commonly cited applied range for a non-acclimatized athlete at threshold effort: roughly +1 to +3 sec/km pace adjustment per °C above 15°C, upper end of the range at high humidity. Treat as a rough planning estimate, not a precise constant.",
      "HR at a given pace commonly runs ~10-15 bpm higher above 25°C versus under 15°C for non-acclimatized athletes.",
      "10-14 days of repeated heat exposure (heat acclimatization) meaningfully narrows this gap — always note whether the athlete is acclimatized when applying these numbers.",
    ],
    citeAs: "Applied heat-performance guidance (consensus literature on heat and athletic performance, e.g. Racinais et al. 2015; ACSM heat-illness guidance) — present as an estimate, not a measured value for this athlete.",
  },
  altitude: {
    topic: "Altitude adaptation and pace adjustment",
    guidance: [
      "Below ~1,500m, performance effects are typically negligible for most athletes.",
      "Above ~1,500-2,000m, expect a roughly 1-3% pace/power decrement per 300m of additional elevation at the same effort for a non-acclimatized athlete, more pronounced for higher-intensity efforts (VO2max-dependent work) than for easy aerobic pace.",
      "Full acclimatization typically takes 1-3 weeks depending on altitude; the first 3-5 days often feel disproportionately hard before partial adaptation.",
    ],
    citeAs: "Applied altitude-performance guidance (consensus exercise-physiology literature on hypoxia and endurance performance) — present as an estimate, not a measured value for this athlete.",
  },
  taper: {
    topic: "Taper volume/intensity guidance before a goal race",
    guidance: [
      "Typical evidence-based taper: reduce volume 40-60% over 1-3 weeks while maintaining (not cutting) intensity — frequency and some high-intensity work preserve fitness better than volume does.",
      "Longer tapers (2-3 weeks) suit longer/harder training blocks (marathon, high weekly volume); shorter tapers (4-10 days) suit shorter races off lower volume.",
    ],
    citeAs: "Applied taper guidance (Bosquet et al. 2007 meta-analysis on tapering and performance, and related consensus literature).",
  },
} as const;

export type TrainingScienceTopic = keyof typeof TRAINING_SCIENCE_REFERENCE;
```

- [ ] **Step 2: Add the tool**

In [lib/ai/tools.ts](lib/ai/tools.ts), add to the schema list (in the "External tools" group, alongside `web_search`):

```typescript
  {
    name: "get_training_science_reference",
    description: "Returns curated, pre-vetted applied guidance on common physiological adjustment questions (heat adaptation, altitude adaptation, tapering) with their literature basis. Use this instead of estimating pace/HR adjustments for heat, altitude, or taper from memory — these numbers are app-maintained and citable, not invented per-conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "'heat' | 'altitude' | 'taper'" },
      },
      required: ["topic"],
    },
  },
```

And to `executeCoachTool`'s switch:

```typescript
      // ── get_training_science_reference ────────────────────────────────────
      case "get_training_science_reference": {
        const topic = input.topic as TrainingScienceTopic;
        const entry = TRAINING_SCIENCE_REFERENCE[topic];
        if (!entry) return { success: false, message: "Unknown topic.", data: `error: unknown topic, valid: ${Object.keys(TRAINING_SCIENCE_REFERENCE).join(", ")}` };
        const lines = [entry.topic, ...entry.guidance.map(g => `- ${g}`), "", `Source: ${entry.citeAs}`];
        return { success: true, message: `Reference: ${entry.topic}`, data: lines.join("\n") };
      }
```

Add the import at the top of `lib/ai/tools.ts`: `import { TRAINING_SCIENCE_REFERENCE, type TrainingScienceTopic } from "./training-science-reference";`

- [ ] **Step 3: Update the system prompt**

In [lib/ai/prompts.ts](lib/ai/prompts.ts), add `get_training_science_reference` to the read-tools list and add to "Coach instructions":

```typescript
- For heat/altitude/taper pace or HR adjustment questions, call get_training_science_reference first and present its numbers explicitly as estimates ("roughly", "applied guidance suggests") rather than precise measured values — prefer the athlete's own historical data (via compare_activities against a similar past session in similar conditions) when it exists
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Re-ask a version of the original transcript's opening question ("hur påverkar 27 grader och hög luftfuktighet prestationen, vilket tempo i 10 grader motsvarar det"). Confirm `get_training_science_reference` (topic: heat) is called and the answer's numbers visibly trace back to it rather than being freshly invented each time.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/training-science-reference.ts lib/ai/tools.ts lib/ai/prompts.ts
git commit -m "feat: add curated training-science reference tool to ground heat/altitude/taper claims instead of inventing numbers"
```

---

#### Task 11: proactive ACWR + HRV risk flag in the cached system prompt

Grounded in G1.7 — surfaces an already-computed signal the model currently only sees if it happens to call the right tool.

**Files:**
- Modify: `lib/ai/context-builder.ts` (the `healthLines` block in `buildCoachContext`)

- [ ] **Step 1: Add the ACWR check**

In [lib/ai/context-builder.ts](lib/ai/context-builder.ts), in the `healthLines` block (around where HRV trend is computed), add:

```typescript
  if (fitnessCache?.acwr != null && fitnessCache.acwr > 1.5) {
    healthLines.push(`⚠ ACWR elevated (${fitnessCache.acwr.toFixed(2)}) — sustained ratios above ~1.5 are associated with increased injury risk in the literature; consider an easier week`);
  }
```

Place this after the existing HRV-trend push and before the `missedWorkouts` block, so it reads naturally alongside the other recovery flags.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

If `FitnessCache.acwr` is ever observed above 1.5 for the test account, confirm the flag appears in a fresh coach conversation's first response context (it's part of the cached system prompt, so check via a tool-free question like "hur mår min form?"). If never naturally reachable, temporarily verify by reading `FitnessCache.acwr` in Prisma Studio and confirming the threshold logic against that real value, then revert nothing (no test data should be fabricated in the DB).

- [ ] **Step 4: Commit**

```bash
git add lib/ai/context-builder.ts
git commit -m "feat: surface elevated ACWR as a proactive risk flag in the coach's health log"
```

---

#### Task 12 (optional — requires explicit go-ahead, the one task in this plan with a schema change): lightweight semantic memory

Grounded in G1.5. **Not started without separate confirmation** — this is the one piece of Part G that changes `prisma/schema.prisma`, which the rest of this plan deliberately avoided.

**Proposal, not a committed task:** a small `AthleteMemoryNote` table (`id`, `userId`, `content`, `category` — e.g. `injury | preference | constraint`, `createdAt`, `sourceConversationId`) that the coach can write to via a new `remember_note` write tool (same approval-card flow as `update_profile`) and that gets included as a short bullet list in the cached system prompt (capped at, say, 15 most recent/relevant notes — not a vector store; this app's note volume is small enough that a flat recency-ordered list is sufficient, per G1.5's calibration that Mem0-style "consumer app" memory, not Letta-style autonomous-agent memory, is the right tier here). This is what would let the coach actually remember "the athlete mentioned a chronic left knee issue" or "prefers not to run intervals on Sundays" across conversations, which nothing in the current architecture does today (conversation history is per-`Conversation`, not shared across them).

If this is wanted, it should go through `superpowers:brainstorming` as its own small design pass before a plan — it touches schema, a new write-tool-approval flow, and a "what's worth remembering vs. noise" policy that's worth thinking through deliberately rather than speccing inline here.

---

#### Task 13 (practice, not a code task): proportionate quality-checking, not a rubric pipeline

Grounded in G1.8. The production LLM-as-judge/rubric evaluation pipelines surveyed in the research are sized for product teams shipping to many users with continuous prompt iteration — building that out for a single-developer, closed-invite personal app would be effort disproportionate to the payoff. The proportionate version: after Tasks 1-11 ship, periodically (e.g. monthly, or after any prompt/tool change) re-run a small fixed set of the same 4-5 representative questions (a heat-adjustment question, a multi-tool comparison question, a "how's my form" open question, a write-tool request) against the live coach and read the answers for the G1.1/G1.2/G1.4 failure modes specifically — invented numbers without a tool citation, generic advice despite having the data, ignored prior-conversation context. This is a checklist to run by hand, not infrastructure to build, and is flagged here so the decision not to build a judge pipeline is a documented choice rather than a gap nobody decided on.

---

### G4. Audit & testing additions for Part G

Add to Part E's verification pass, once Tasks 9-11 are implemented:

- [ ] **G-1:** Ask a comparison question matching Task 9's scenario; confirm `compare_activities`/`compare_periods` is the tool actually called (not two separate `get_activity_detail`/`get_volume_stats` calls followed by manual subtraction in the reply text).
- [ ] **G-2:** Ask a heat/altitude/taper question; confirm `get_training_science_reference` is called and the reply's numbers are presented as estimates with the reference's caveat language, not as precise unsourced figures.
- [ ] **G-3:** If/when ACWR is ever observed above 1.5 for the test account, confirm the system prompt's health log includes the flag without the model needing to call a tool for it.
- [ ] **G-4:** Confirm `npx tsc --noEmit` and `pnpm build --no-lint` still pass clean with the new tools added (25 → 28 tools in `COACH_TOOLS` — also a good moment to sanity-check that tool count isn't approaching a real ceiling for any provider's context window; at ~28 short tool schemas this is nowhere close for any of the four providers' context limits, but worth a one-line note if this list keeps growing in future sessions).
