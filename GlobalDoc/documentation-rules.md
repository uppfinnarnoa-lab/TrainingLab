# Documentation Rules

## Core Principle
All docs in `docs/` are **source-of-truth documents** — authoritative, not supplementary. If code and docs disagree, the docs are wrong and must be fixed immediately. They are contracts, not commentary.

## Folder Structure
```
docs/
  api/         I/O specs for every HTTP endpoint
  schemas/     Object shapes (Activity, WorkoutSection, AI context, etc.)
  integrations/ Per-integration data contracts (Strava fields used, Garmin fields, etc.)
```

## When to Write a Doc
- Every new API endpoint → `docs/api/<name>.md`
- Every new DB model or significant field change → update `docs/schemas/<model>.md`
- Any change to what gets sent to the AI → update `docs/schemas/ai-context.md`
- Any change to external API usage → update `docs/integrations/<name>.md`

## When to Update a Doc
Immediately when the corresponding code changes. No exceptions. A PR that changes an interface without updating its doc is incomplete.

## I/O Doc Format

```markdown
## METHOD /api/path/to/endpoint

**Purpose:** One sentence on what this does.

**Auth:** Required / None

**Request:**
\`\`\`json
{
  "field": "type"   // comment explaining non-obvious fields
}
\`\`\`

**Response (success 200):**
\`\`\`json
{
  "field": "value"
}
\`\`\`

**Response (error):**
\`\`\`json
{
  "error": "error_code",    // named constant, never a magic string
  "message": "Human-readable explanation"
}
\`\`\`

**Side effects:** What this writes to the DB, what external APIs it calls.
**Rate limits / performance notes:** If relevant.
```

## Rules

1. **Doc before code** — write the I/O doc before implementing. This prevents interface drift and forces you to think through the contract first.
2. **Enums are exhaustive** — never write "see code for values." List every possible value.
3. **Error codes are named constants** — defined in `docs/schemas/error-codes.md`, referenced by name in endpoint docs.
4. **External API responses are documented as-received** — if a Strava field is used, document the Strava shape in `docs/integrations/strava.md`, not just the internal mapping.
5. **AI context object is fully specified** — `docs/schemas/ai-context.md` is the single source of truth for what gets sent to the model. Any context change = doc change first.
6. **No breaking changes without a doc update** — treat docs as the interface contract. If you change the contract, update the doc, then change the code.

## Schema Doc Format

```markdown
## ActivitySummary (used in AI context)

Object shape passed to the AI coach representing a single activity.

\`\`\`typescript
{
  id: string
  date: string          // ISO 8601
  sport: string         // value from SportCategory.name
  name: string          // user-written Strava title
  description: string   // user-written Strava notes — primary AI context
  distanceM: number
  movingTimeSec: number
  avgHR: number | null
  maxHR: number | null
  avgPaceSecPerKm: number | null
  elevationM: number
  weatherTemp: number | null  // °C
  tss: number | null
  isRace: boolean
}
\`\`\`

**Never include**: raw splits arrays, lap data, polyline, per-second streams.
```
