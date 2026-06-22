# TrainingLab

Personal AI-powered training platform. Connects Strava activity data + Garmin physiological data with an AI coach. Self-hosted on Ubuntu/nginx — multi-user (closed invite system: users register, admin approves in Settings → Users), with per-user data isolation. See `docs/planning/IMPLEMENTATION_PLAN.md` for full feature spec.

## Stack
- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js v5
- **Styling**: Tailwind CSS + shadcn/ui
- **AI**: Claude API, Gemini Flash, NVIDIA NIM, or Groq (switchable per user setting)
- **Package manager**: pnpm

## Session Start — Always
1. `git pull` before touching anything
2. Read the docs files relevant to your task (see below)

## Starting the dev server
Only start the dev server if explicitly asked (e.g. to test a UI change in a browser). It is **not** part of Session End — the user works directly against the production server.

Start it with the Bash tool using `run_in_background: true`:
```
cd "c:\Users\uppfi\Desktop\TrainingLab" && pnpm dev
```
If port 3000 is blocked, kill the blocking process first with PowerShell:
```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```
Then start pnpm dev again. Never start multiple dev servers — always kill all node processes first. When done testing, kill the node process again — don't leave a dev server running.

## Deploying to Production
The live site (`training.helgars.se`, `/var/www/traininglab`) is the user's other server. **You cannot reach it from this machine** — `ssh ...@training.helgars.se` times out (port 22 unreachable). The user SSHes in themselves.

After build + commit + push succeed, check whether `package.json`, `pnpm-lock.yaml`, or `prisma/schema.prisma` were touched by this session's commits.

**Default — nothing in those 3 files changed (the common case):**
```bash
cd /var/www/traininglab && git pull --ff-only && pnpm exec next build --no-lint && pm2 reload traininglab --update-env
```

**Only if `package.json`/`pnpm-lock.yaml` or `prisma/schema.prisma` changed:**
```bash
cd /var/www/traininglab && git pull --ff-only && pnpm install --frozen-lockfile --prod=false && pnpm exec prisma generate && set -a && source .env.local && set +a && pnpm exec prisma db push --skip-generate && pnpm exec next build --no-lint && pm2 reload traininglab --update-env
```
- Prisma CLI only auto-loads `.env`, not `.env.local` (where prod's `DATABASE_URL` lives) — the `set -a && source .env.local && set +a` before `prisma db push`/`generate` is required or it fails with P1012.
- Don't suggest `deployment/deploy.sh` — the user prefers this manual sequence.
- `prisma db push --skip-generate` is required whenever `prisma/schema.prisma` changed (no migration files in this project).
- Running the longer command when nothing changed is harmless (the install/prisma steps become no-ops) — but default to the shorter one so the user isn't waiting on a redundant `pnpm install`.

## Documentation — After Every Change (MANDATORY)
**Update docs immediately after each task, before declaring it done.** Never defer this.

- **`docs/planning/IMPLEMENTATION_PLAN.md`** — always. Add a session entry describing what changed and why. One bullet per changed file/function with the concrete behavior (not just "updated X"). Mark any Phase checklist items done.
- **`docs/api/`** — if any API endpoint or cross-module function signature changed.
- **`docs/`** other files — if architecture, data flow, or integration knowledge changed.

This is not optional. Future sessions (and future you) must be able to read IMPLEMENTATION_PLAN.md and know exactly what exists, how it works, and what remains — without reading the code.

## Session End — Always
After every task, do all of the following before declaring it done:
1. Run `pnpm build --no-lint` to verify the build compiles without errors before pushing
2. Stage changed files by name, commit, and push
3. Give the user the production deploy command (see "Deploying to Production" below) so they can apply it on `training.helgars.se`
4. Update documentation (see above — Documentation section)

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
| [docs/schemas/ai-context.md](docs/schemas/ai-context.md) | Any work touching what gets sent to the AI coach |
| [docs/planning/](docs/planning/) | Current research, bug audits, and in-progress feature plans (dated docs; moved to `docs/planning/archive/` once resolved) |
| [docs/fitness/](docs/fitness/) | VO2max models, HR zone research, analytics roadmap |

## Hard Rules
- All newly created markdown files that are improvement analyses, implementation plans, bug audits, or research documents **must** be placed in `docs/planning/` — not in `docs/fitness/` or project root
- Write I/O docs in `docs/` **before** implementing endpoints — see `docs/guides/documentation-rules.md`
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
