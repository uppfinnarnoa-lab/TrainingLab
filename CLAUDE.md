# ClaudeTrainer

Personal AI-powered training platform. Connects Strava activity data + Garmin physiological data with an AI coach. Single user, self-hosted on Ubuntu/Apache. See `IMPLEMENTATION_PLAN.md` for full feature spec.

## Stack
- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js v5
- **Styling**: Tailwind CSS + shadcn/ui
- **AI**: Claude API + Gemini Flash (switchable per user setting)
- **Package manager**: pnpm

## Session Start — Always
1. `git pull` before touching anything
2. Read the GlobalDoc files relevant to your task (see below)

## Session End — Always
1. Stage changed files by name, commit, and push
2. If any API endpoint or cross-module function signature changed → update its doc in `docs/`
3. If architecture, workflow, or integration knowledge changed → update the relevant `GlobalDoc/` file

## GlobalDoc — Read Before Working
Determine which files apply to your task before starting:

| File | When to read |
|---|---|
| [GlobalDoc/architecture.md](GlobalDoc/architecture.md) | Any work touching DB schema, file structure, or data flow |
| [GlobalDoc/integrations.md](GlobalDoc/integrations.md) | Any work touching Strava, Garmin, weather, or AI APIs |
| [GlobalDoc/workflows.md](GlobalDoc/workflows.md) | Running, building, or deploying the app |
| [GlobalDoc/documentation-rules.md](GlobalDoc/documentation-rules.md) | Adding any endpoint, schema change, or cross-module function |

## Hard Rules
- Write I/O docs in `docs/` **before** implementing endpoints — see `GlobalDoc/documentation-rules.md`
- AI context is always summarized — never send raw bulk activity data to the model
- Strava is the sole source for activities (descriptions are AI context); Garmin only for HRV/sleep
- Sport types and workout types are user-defined — never hardcode them in logic or UI
- No comments unless the WHY is non-obvious to a future reader
- No error handling for scenarios that cannot happen
