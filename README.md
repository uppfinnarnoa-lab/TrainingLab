# TrainingLab

Personal AI-powered training platform — Strava + Garmin + AI coach.

## Local Development

### Prerequisites
- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io) — `npm install -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — for the local database

### 1. Start the database

```bash
docker-compose up -d
```

This starts PostgreSQL on `localhost:5432`. Data persists in a Docker volume between restarts.

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in at minimum:
- `AUTH_SECRET` — generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `STRAVA_CLIENT_ID` + `STRAVA_CLIENT_SECRET` — from [strava.com/settings/api](https://www.strava.com/settings/api)

The `DATABASE_URL` already matches the Docker Compose setup — no change needed.

### 3. Set up the database

```bash
pnpm db:migrate       # run migrations
pnpm db:generate      # generate Prisma client types
```

### 4. Create your user account

```bash
npx tsx scripts/seed-user.ts
```

Default credentials: `admin@traininglab.local` / `changeme123`

Override with env vars:
```bash
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword SEED_NAME="Your Name" npx tsx scripts/seed-user.ts
```

### 5. Start the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

### 6. Connect Strava

Go to Settings → Strava → follow the setup guide → click Connect.
After connecting, click **Sync new activities** to import your history.

---

## Setting up Strava API credentials

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an application (any name, website = `localhost`)
3. Set **Authorization Callback Domain** = `localhost`
4. Copy Client ID and Client Secret into `.env.local`
5. Make sure `STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback`

---

## Stop / clean up

```bash
docker-compose down        # stop DB (data preserved)
docker-compose down -v     # stop DB + delete all data
```

---

## Production deploy

See `docs/planning/IMPLEMENTATION_PLAN.md §9` for Apache + PM2 deployment instructions.
