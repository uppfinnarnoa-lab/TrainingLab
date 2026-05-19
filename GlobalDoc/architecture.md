# Architecture

## Data Flow Overview
```
Strava API ──► sync job ──► Activity table ──► Statistics engine
                                           ──► AI context builder ──► Claude/Gemini
Garmin API ──► sync job ──► GarminDailySummary (HRV, sleep, rHR)
Open-Meteo ──► backfill ──► Activity.weather* fields

Browser ◄──► Next.js App Router (SSR + API routes) ◄──► PostgreSQL (Prisma)
                        │
                    Apache (reverse proxy, SSL)
                        │
                    PM2 (port 3000)
```

## Key Schema Tables
Full schema with all fields is in `prisma/schema.prisma`. Summary:

| Table | Purpose |
|---|---|
| `User` | Single user initially; schema supports multi-user |
| `StravaAccount` | OAuth tokens, lastSyncAt |
| `Activity` | All Strava activities incl. name, description, HR, splits, weather fields |
| `GarminAccount` | Garmin OAuth tokens |
| `GarminDailySummary` | Per-day HRV, sleep stages, resting HR, Body Battery |
| `SportCategory` | User-defined sports with color + icon |
| `WorkoutType` | User-defined workout types per sport |
| `WorkoutTemplate` | Saved workout templates with ordered sections |
| `WorkoutSection` | Sections within a template (zone targets, reps, duration) |
| `TrainingBlock` | Named multi-week periods (Base/Build/Peak/Taper) with date range + race link |
| `PlannedWorkout` | Calendar entries; status + missedReason when past |
| `RaceRecord` | PBs per distance with full history |
| `Conversation` / `Message` | AI coach chat history with token cost tracking |
| `AISettings` | Provider choice (claude/gemini), API keys, monthly budget |
| `AthleteProfile` | Weight, height, DOB, sex, max HR, resting HR, primary goal — sent in AI system prompt |

## File Structure (key paths)
```
app/
  (auth)/              Login
  (dashboard)/
    page.tsx           Dashboard overview
    activities/        Strava activity list + detail
    stats/             Statistics dashboard
    planner/           Training calendar + template library
    planner/builder/   Workout builder
    coach/             AI chat
    races/             PB tracker
  api/
    strava/            OAuth callback, sync, webhook
    garmin/            OAuth callback, sync
    coach/chat/        Streaming AI responses
    planner/           CRUD for planned workouts + templates
    races/             Race record CRUD

lib/
  strava/              API client + sync logic
  garmin/              API client + HRV/sleep sync
  weather/             Open-Meteo client + backfill
  ai/                  AIClient interface, Claude + Gemini implementations, context builder
  fitness/             VO2max, ATL/CTL/TSB, zones, plan-analysis
  db/prisma.ts         Prisma singleton

GlobalDoc/             Project knowledge for Claude (this folder)
docs/                  I/O truth documents for all API endpoints
prisma/schema.prisma   Authoritative DB schema
```

## Computed Metrics (lib/fitness/)
All metrics are derived from stored activity data and cached where expensive:
- **VDOT/VO2max** — from race performances, HR-rest ratio, or tempo-HR regression
- **Training paces** — Easy / Marathon / Threshold / Interval / Repetition derived from VDOT
- **HR Zones** — Z1–Z5 from max HR in data
- **ATL** — 7-day exponential weighted average of TSS
- **CTL** — 42-day exponential weighted average of TSS
- **TSB** — CTL − ATL
- **Readiness score** — HRV 40% + TSB 30% + sleep 20% + resting HR trend 10%

## AI Context Architecture
The coach never receives raw bulk data. `lib/ai/context-builder.ts` selects:
- **Cached in system prompt**: fitness snapshot (VO2max, paces, zones, TSB), health log, race calendar
- **Per-message (dynamic)**: last 4 weeks activity summaries, relevant history by query type
- **Never sent**: raw activity streams, full splits arrays, bulk weather data
