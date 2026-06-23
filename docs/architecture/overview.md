# Architecture

## Data Flow Overview
```
Strava API ──► sync job ──► Activity table ──► Statistics engine
                                           ──► AI context builder ──► Claude/Gemini
Garmin API ──► sync job ──► GarminDailySummary (HRV, sleep, rHR)
Open-Meteo ──► backfill ──► Activity.weather* fields

Browser ◄──► Next.js App Router (SSR + API routes) ◄──► PostgreSQL (Prisma)
                        │
                    nginx (reverse proxy, SSL, SSE passthrough)
                        │
                    PM2 (port 3000)
```

## Build Status
Multi-user (registration + admin approval + per-user data isolation) is live. See `docs/planning/IMPLEMENTATION_PLAN.md` for the running session-by-session log of everything built since — that log, not a phase count, is the current source of truth for build status.

## Key Schema Tables
Full schema with all fields is in `prisma/schema.prisma`. All user-owned models have `onDelete: Cascade`. Summary:

| Table | Purpose |
|---|---|
| `User` | Multi-user — `status` (`pending`/`active`), `isAdmin`; new registrations require admin approval |
| `StravaAccount` | OAuth tokens, lastSyncAt |
| `Activity` | All Strava activities incl. name, description, HR, splits, weather fields |
| `GarminAccount` | Garmin OAuth tokens |
| `GarminDailySummary` | Per-day HRV, sleep stages, resting HR, Body Battery |
| `SportCategory` | User-defined sports with color + icon |
| `WorkoutType` | User-defined workout types per sport |
| `WorkoutTemplate` | Saved workout templates with ordered sections |
| `WorkoutSection` | Sections within a template (zone targets, reps, duration, optional rest segment for interval blocks) |
| `TrainingBlock` | Named multi-week periods (Base/Build/Peak/Taper) with date range + race link |
| `PlannedWorkout` | Calendar entries; status + missedReason when past |
| `RaceRecord` | PBs per distance with full history |
| `Conversation` / `Message` | AI coach chat history with token cost tracking |
| `AISettings` | Provider choice (claude/gemini), API keys, monthly budget |
| `AthleteProfile` | Weight, height, DOB, sex, max HR, resting HR, primary goal — sent in AI system prompt |

## Pages (all implemented)
| Route | Description |
|---|---|
| `/login` | Email/password login |
| `/register` | New user signup — creates a `pending` account, blocked until admin approves |
| `/pending` | Shown to logged-in users awaiting admin approval |
| `/` | Dashboard — overview cards, recent activity |
| `/activities` | Activity list with sport filter + pagination |
| `/stats` | 5-tab statistics: Overview, Volume, Load, Zones, Fitness |
| `/planner` | Training calendar + template library + block banner |
| `/coach` | AI chat (Claude or Gemini), streaming, cost tracking |
| `/races` | PB tracker per distance, timeline chart, manual entry |
| `/settings` | Strava/Garmin connect, AI keys, athlete profile, sports/types, goals, account; admins also see a Users panel to approve/revoke accounts |

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

docs/                  I/O truth documents for all API endpoints, integrations, architecture
deployment/            nginx/PM2/Ubuntu deploy guide, deploy.sh, ecosystem.config.js
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
- **Readiness score** (`lib/garmin/insights.ts`) — HRV 40% + TSB 30% + sleep 20% + resting HR trend 10%, each normalized relative to the athlete's own baseline and re-weighted over whichever components have data; optionally blended 60/40 with Garmin's own `trainingReadiness` score when available. Shared by the dashboard's readiness pill and the Stats → Recovery tab's detail card.

## AI Context Architecture
The coach never receives raw bulk data. `lib/ai/context-builder.ts` selects:
- **Cached in system prompt**: fitness snapshot (VO2max, paces, zones, TSB), health log, race calendar
- **Per-message (dynamic)**: last 4 weeks activity summaries, relevant history by query type
- **Never sent**: raw activity streams, full splits arrays, bulk weather data
