# TrainingLab

Personal AI-powered endurance training platform — Strava + Garmin + Claude/Gemini AI coach.

## Features

- **Activity sync** — Full Strava history, hourly incremental sync
- **Statistics** — VO2max, VDOT, ATL/CTL/TSB, ACWR, HR zones, race predictions, polarisation score, AEI trend
- **Training Planner** — Calendar, templates, training blocks, week summaries with predicted distance
- **AI Coach** — Claude/Gemini with full training context, tool use (creates workouts, reads activities, updates profile)
- **Races & PBs** — Manual PB tracking with Strava activity linking
- **Garmin integration** — HRV, sleep, resting HR

---

## Local Development

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io) — `npm install -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — for PostgreSQL

### 1. Start the database

```bash
docker start traininglab-db
# or first time:
docker-compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in at minimum:
- `AUTH_SECRET` — `openssl rand -base64 32`
- `STRAVA_CLIENT_ID` + `STRAVA_CLIENT_SECRET` — from [strava.com/settings/api](https://www.strava.com/settings/api)
- `ANTHROPIC_API_KEY` or `GOOGLE_AI_API_KEY` — for the AI coach

### 3. Set up the database

```bash
pnpm prisma migrate deploy   # run migrations
pnpm prisma generate         # generate Prisma client
```

### 4. Create your user

```bash
node scripts/seed-user.mjs
# or: SEED_EMAIL=you@example.com SEED_PASSWORD=secret node scripts/seed-user.mjs
```

### 5. Start the app

Always kill any existing node processes first to avoid port conflicts:

```powershell
# PowerShell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Connect Strava

Settings → Strava → Setup guide → Connect → Sync activities.

---

## Production Deploy

See [`docs/guides/deployment.md`](docs/guides/deployment.md) for the full Ubuntu + Apache + PM2 + Let's Encrypt guide.

Quick deploy after pushing to main:

```bash
ssh yourserver "/var/www/traininglab/deploy.sh"
```

---

## Documentation

| File | Description |
|---|---|
| [`docs/guides/deployment.md`](docs/guides/deployment.md) | Ubuntu server setup + deploy script |
| [`docs/guides/workflows.md`](docs/guides/workflows.md) | Development workflows |
| [`docs/planning/IMPLEMENTATION_PLAN.md`](docs/planning/IMPLEMENTATION_PLAN.md) | Feature status + implementation notes |
| [`docs/planning/FUTURE_PLANS.md`](docs/planning/FUTURE_PLANS.md) | Upcoming features backlog |
| [`docs/fitness/`](docs/fitness/) | VO2max models, HR zone research |
| [`docs/api/`](docs/api/) | API endpoint reference |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Database | PostgreSQL + Prisma |
| Auth | NextAuth.js v5 |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| AI | Claude Sonnet 4.6 / Gemini 2.5 Flash |
| Process manager | PM2 |
| Reverse proxy | Apache |
