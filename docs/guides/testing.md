# TrainingLab — Local Testing Guide

Step-by-step instructions to get the app running locally and test all features.

---

## Prerequisites

Install these before starting:

| Tool | Install |
|---|---|
| Node.js 20+ | https://nodejs.org |
| pnpm | `npm install -g pnpm` |
| Docker Desktop | https://www.docker.com/products/docker-desktop |
| Git | Already installed |

---

## Step 1 — Start the database

```bash
docker-compose up -d
```

Starts PostgreSQL on `localhost:5432`. Verify it's running:
```bash
docker ps
# Should show: traininglab-db   Up
```

---

## Step 2 — Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and set at minimum:

```env
# Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AUTH_SECRET="paste-64-char-hex-here"
```

The `DATABASE_URL` already matches docker-compose — leave it as-is.

---

## Step 3 — Set up the database

```bash
pnpm db:push        # applies the schema (no migration files in this project)
pnpm db:generate    # generates Prisma client types
```

---

## Step 4 — Create your account

```bash
# Default: admin@traininglab.local / changeme123
npx tsx scripts/seed-user.ts

# Or with custom credentials:
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword SEED_NAME="Your Name" npx tsx scripts/seed-user.ts
```

---

## Step 5 — Start the app

```bash
pnpm dev
```

Open http://localhost:3000 — you should see the login page.

Log in with the credentials from Step 4.

---

## Step 6 — Connect Strava

### 6a. Create a Strava developer app

1. Go to https://www.strava.com/settings/api
2. Create an application:
   - **Application Name:** TrainingLab (any name)
   - **Website:** `http://localhost`
   - **Authorization Callback Domain:** `localhost`
3. Copy **Client ID** and **Client Secret**

### 6b. Add to .env.local

```env
STRAVA_CLIENT_ID=your_id
STRAVA_CLIENT_SECRET=your_secret
STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback
```

Restart the dev server (`Ctrl+C` then `pnpm dev`).

### 6c. Connect in the app

1. Go to **Settings** (bottom of sidebar)
2. In the Strava section, click **Connect with Strava**
3. Authorise in the Strava popup
4. Back in Settings, click **Sync new activities**

Initial sync of 10 years of activities takes 2–5 minutes (rate limited to 200 requests/15 min).

---

## Step 7 — Set up AI Coach

### Option A: Gemini Flash (free, easiest)

1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API key**
3. In the app: **Settings → AI Coach → Gemini API key** → paste key → Save

### Option B: Claude (better quality, ~$1–5/month)

1. Go to https://console.anthropic.com → API Keys → Create Key
2. In the app: **Settings → AI Coach → Claude API key** → paste key → Save
3. Set a monthly budget (default $5)

### Option C/D: NVIDIA NIM or Groq (advanced, OpenAI-compatible)

Same flow — pick the provider in Settings → AI Coach, paste the matching API key. See `docs/integrations/strava.md` "NVIDIA NIM" / "Groq" sections for the default models used.

---

## Step 8 — (Optional) Import the training plan

To load the included training plan CSV as test data:

```bash
npx tsx scripts/import-training-plan.ts
```

This imports weeks 43/2025 through ~19/2026 as planned workouts.

---

## Testing Checklist

Work through each section to verify everything works:

### Dashboard (`/`)
- [ ] Overview cards show this week / this month / YTD totals
- [ ] Cards show "—" if no activities synced yet (graceful empty state)

### Activities (`/activities`)
- [ ] Activity list loads with sport filter chips
- [ ] Filter by sport (e.g. "Run") shows only running activities
- [ ] Pagination works (Next / Previous buttons)
- [ ] Activity cards show name, date, distance, time, pace, HR

### Statistics (`/stats`)
- [ ] All 5 tabs load without error
- [ ] Overview: cards show data, sparklines visible
- [ ] Volume: stacked bar chart renders with sport colours
- [ ] Load: ATL/CTL/TSB lines chart renders
- [ ] Zones: pie chart visible (requires activities with HR data)
- [ ] Fitness: VO2max gauge shows value, race predictions table renders
- [ ] Hover `ⓘ` icon → tooltip appears with explanation

### Planner (`/planner`)
- [ ] Calendar shows current month
- [ ] Template library sidebar is visible (empty until you create templates)
- [ ] Click a day → Workout Builder opens
- [ ] In builder: enter name, select sport, add sections with zone picker
- [ ] Save → workout pill appears on the calendar
- [ ] Click a past workout pill → Outcome modal opens
- [ ] Mark as Missed → choose reason → pill shows red tint + reason
- [ ] Mark as Completed → pill shows green check
- [ ] Block banner visible at top (empty until you create blocks)

### AI Coach (`/coach`)
- [ ] Chat interface loads
- [ ] If no API key: shows setup prompt linking to Settings
- [ ] Type a message → response streams in real time
- [ ] Cost badge appears under AI response (0.000 for Gemini free)
- [ ] Session cost counter updates in header
- [ ] Suggested questions visible when conversation is empty, click one to pre-fill input

### Races (`/races`)
- [ ] Page loads (empty state if no race activities)
- [ ] Click **Import from Strava** → imports race activities
- [ ] Distance selector shows imported distances
- [ ] PB card shows best time for selected distance
- [ ] Chart appears when ≥ 2 results for a distance
- [ ] Click **Add manually** → modal opens → fill time and date → save
- [ ] Delete button (hover row) removes record

### Settings (`/settings`)
- [ ] Strava section shows "Connected" + sync stats after connecting
- [ ] AI section: provider toggle (Claude / Gemini / NVIDIA / Groq) works
- [ ] Athlete Profile form: save weight, height, etc. → reload confirms saved
- [ ] After saving athlete profile, coach context mentions name/goal

---

## Importing the CSV training plan

After running `npx tsx scripts/import-training-plan.ts`:

1. Go to **Planner** → navigate to October 2025 (week 43)
2. Should see workouts from the plan (Easy run, 4x10, Intervals, etc.)
3. Navigate forward month by month to see the full plan through mid-2026

---

## Common issues

| Problem | Fix |
|---|---|
| `ECONNREFUSED` on startup | `docker-compose up -d` — database not running |
| `No AUTH_SECRET` error | Generate and add to `.env.local` (Step 2) |
| Strava sync returns 0 activities | Check `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` in `.env.local`, restart dev server |
| AI chat shows "No API key" | Add key in Settings → AI Coach |
| Stats page shows all zeros | Sync Strava first (Settings → Sync new activities) |
| Planner calendar blank | Normal if no planned workouts — click a day to add one |
| `pnpm db:push` fails | Check `DATABASE_URL` in `.env.local` matches `docker-compose.yml` |
| TypeScript errors after `pnpm db:generate` | Run `pnpm tsc --noEmit` to check — all should be clean |

---

## Resetting the database

```bash
docker-compose down -v    # stops DB and deletes all data
docker-compose up -d      # fresh DB
pnpm db:push
pnpm db:generate
npx tsx scripts/seed-user.ts
```

---

## Running in production (Ubuntu)

See [`deployment/README.md`](../../deployment/README.md) for the full nginx + PM2 + multi-user deployment guide — this is the single source of truth for production setup, don't follow a separate procedure here.
