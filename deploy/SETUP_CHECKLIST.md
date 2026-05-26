# TrainingLab — First-Run Setup Checklist

Complete these steps after the server is up and the app is running.

---

## 1. Security

- [ ] **Change your password** — Settings → Account → Change password
- [ ] **Verify AUTH_SECRET in .env** is a real random value (`openssl rand -base64 32`), not the placeholder
- [ ] **Verify DATABASE_URL password** matches what you set in PostgreSQL — not `CHANGE_ME`
- [ ] Confirm the app is only reachable via HTTPS (HTTP should redirect)

---

## 2. Athlete Profile

- [ ] Settings → Profile → fill in:
  - Name, age, weight, height
  - Years of training experience
  - Primary sport
  - Current weekly training volume goal
- [ ] This data is sent to the AI coach as context — the more accurate, the better

---

## 3. Connect Strava

- [ ] Settings → Integrations → Connect Strava
- [ ] Authorize TrainingLab in the Strava popup
- [ ] After connecting, trigger the **backfill** to import past activities:
  - Go to Settings → Strava → "Backfill activities"
  - Run in batches — start with the last 90 days, then go further back
  - Watch the logs (`pm2 logs traininglab`) to confirm it's working
- [ ] Verify activities appear on the Dashboard

---

## 4. Connect Garmin (optional but recommended for HRV/sleep)

- [ ] Register your app at developer.garmin.com (Health API)
- [ ] Add `GARMIN_CLIENT_ID` and `GARMIN_CLIENT_SECRET` to `.env` on the server
- [ ] Reload the app: `pm2 reload traininglab`
- [ ] Settings → Integrations → Connect Garmin
- [ ] Authorize TrainingLab
- [ ] HRV and sleep data will sync automatically going forward

---

## 5. AI Coach

- [ ] Settings → AI Coach → enter your API key:
  - **Anthropic** (Claude): get a key at console.anthropic.com
  - **Google AI** (Gemini): get a key at aistudio.google.com
- [ ] Choose your preferred AI model
- [ ] Set a monthly spend limit so you don't get surprise bills
- [ ] Send a test message in the Coach tab to verify it works

---

## 6. HR Zones

- [ ] Settings → HR Zones → verify or enter:
  - Max heart rate (measured, not age-formula — do a 5K time trial)
  - Resting heart rate (measure lying down, first thing in morning)
- [ ] The zones will recalculate automatically
- [ ] If you have a recent lactate threshold test, enter LT heart rate too

---

## 7. Sport Categories

- [ ] Settings → Sports → review the defaults (Running is pre-configured)
- [ ] Add any other sports you do (Cycling, Swimming, etc.)
- [ ] For Running, verify the workout types match what you actually do:
  - Easy / Long / Tempo / LT / AT / Interval / Fartlek
  - Add, rename, or remove types to match your training vocabulary
- [ ] Set colors for each type (used in calendar and charts)

---

## 8. Training Planner

- [ ] Planner → Templates → create your standard weekly workout templates:
  - E.g., "Easy 10km", "LT 2×20min", "Long Run 25km"
  - Set target duration and/or distance
- [ ] Planner → Blocks → create your first training block:
  - Name (e.g., "Base building May–July")
  - Start and end dates
  - Link to a goal race if you have one
- [ ] Drag templates onto the calendar to build your plan

---

## 9. Races

- [ ] Races → add any recent races you have results for
  - These are used by the Riegel race predictor model
  - The more results you have, the better the predictions
- [ ] Add your next goal race

---

## 10. Verify Everything Works

- [ ] Dashboard loads and shows recent activities
- [ ] Activity detail page shows laps, HR zones, map
- [ ] Stats page loads (may be slow on first load — it builds the cache)
- [ ] Coach responds in the Chat tab
- [ ] Planner calendar shows your planned workouts
- [ ] Check `pm2 logs traininglab` for any errors

---

## Ongoing Maintenance

- **Deploy updates**: `cd /var/www/traininglab && ./deploy/update.sh`
- **DB backup**: set up a daily cron (see DEPLOY.md)
- **Strava backfill**: if you want historical data older than what's already synced, run backfill again
- **Garmin sync**: runs automatically on each visit — no manual action needed
- **SSL renewal**: Let's Encrypt auto-renews via certbot cron — verify with `sudo certbot renew --dry-run`
