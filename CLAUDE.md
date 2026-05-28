# TrainingLab

Personal AI-powered training platform. Connects Strava activity data + Garmin physiological data with an AI coach. Single user, self-hosted on Ubuntu/nginx. See `IMPLEMENTATION_PLAN.md` for full feature spec.

## Stack
- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js v5
- **Styling**: Tailwind CSS + shadcn/ui
- **AI**: Claude API + Gemini Flash (switchable per user setting)
- **Package manager**: pnpm

## Session Start — Always
1. `git pull` before touching anything
2. Read the docs files relevant to your task (see below)

## Starting the dev server
Always start the dev server with the Bash tool using `run_in_background: true`:
```
cd "c:\Users\uppfi\Desktop\TrainingLab" && pnpm dev
```
If port 3000 is blocked, kill the blocking process first with PowerShell:
```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```
Then start pnpm dev again. Never start multiple dev servers — always kill all node processes first.

## Session End — Always
After every task, do all of the following before declaring it done:
1. Run `pnpm build --no-lint` to verify the build compiles without errors before pushing
2. Stage changed files by name, commit, and push
3. Restart the dev server on localhost:3000 (kill node, then `pnpm dev` with `run_in_background: true`)
4. If any API endpoint or cross-module function signature changed → update its doc in `docs/api/`
5. If architecture, workflow, or integration knowledge changed → update the relevant file in `docs/`
6. Update `docs/planning/IMPLEMENTATION_PLAN.md` to reflect what was built or changed (see below)

## Keeping IMPLEMENTATION_PLAN.md Current
`docs/planning/IMPLEMENTATION_PLAN.md` is a living document — it must always reflect reality, not just intent.

**After building something:** Mark the relevant Phase checklist item as done (`- [x]`), and if the implementation deviated from the spec (different approach, added detail, simplified), update the spec text to match what was actually built.

**After fixing a bug:** Add a brief note in the relevant feature section describing what the correct behavior is (so the same misunderstanding doesn't recur).

**After a design decision during implementation:** If something was decided differently than planned (a component merged, a flow changed, a field renamed), update the plan section to reflect the actual decision.

The goal: any future session should be able to read `IMPLEMENTATION_PLAN.md` and know exactly what exists, how it works, and what remains to be built — without reading the code.

## Docs — Read Before Working
All project documentation lives in `docs/`. Determine which files apply to your task:

| File | When to read |
|---|---|
| [docs/architecture/overview.md](docs/architecture/overview.md) | Any work touching DB schema, file structure, or data flow |
| [docs/integrations/strava.md](docs/integrations/strava.md) | Any work touching Strava, Garmin, weather, or AI APIs |
| [docs/guides/workflows.md](docs/guides/workflows.md) | Running, building, or deploying the app |
| [deployment/README.md](deployment/README.md) | Deploying to production (Ubuntu/nginx/helgars.se) |
| [docs/guides/documentation-rules.md](docs/guides/documentation-rules.md) | Adding any endpoint, schema change, or cross-module function |
| [docs/planning/MASTER_PLAN.md](docs/planning/MASTER_PLAN.md) | Current research, bug audit, and implementation plans |
| [docs/fitness/](docs/fitness/) | VO2max models, HR zone research, analytics roadmap |

## Hard Rules
- All newly created markdown files that are improvement analyses, implementation plans, bug audits, or research documents **must** be placed in `docs/planning/` — not in `docs/fitness/` or project root
- Write I/O docs in `docs/` **before** implementing endpoints — see `GlobalDoc/documentation-rules.md`
- AI context is always summarized — never send raw bulk activity data to the model
- Strava is the sole source for activities (descriptions are AI context); Garmin only for HRV/sleep
- Sport types and workout types are user-defined — never hardcode them in logic or UI
- No comments unless the WHY is non-obvious to a future reader
- No error handling for scenarios that cannot happen

## Bug Audit Practice
When performing a bug audit, **verify each suspected bug is real before fixing it**:
1. Read the exact code path — do not assume the bug exists based on description alone
2. Confirm the bug is actually reachable (e.g. check if the code path runs at all)
3. Confirm the fix doesn't break existing correct behaviour (check all callers)
4. Only mark a bug as fixed after verifying the corrected code path end-to-end
5. If a "bug" turns out to be correct behaviour, document why it looks suspicious but is intentional
This prevents fixing non-bugs and breaking things that already work correctly.
