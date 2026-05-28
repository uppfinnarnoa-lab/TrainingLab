# TrainingLab — Implementation Plan

> Personal AI-powered training platform integrating Strava, coaching intelligence, and training planning.

---

## 1. Project Overview

A personal web application hosted on an Ubuntu/Apache server that serves as a complete training ecosystem:

- **Strava sync** — full history + daily auto-sync
- **Statistics** — richer and more customizable than Strava's native dashboards
- **Training Planner** — calendar-based weekly/monthly planning
- **Virtual Coach** — AI chat (Claude or Gemini) with full training context
- **Race/PB Tracker** — personal records per distance with trend visualization

**Primary user:** Single user, but architecture is designed to scale to multi-user.

**Sports covered:** Running, orienteering, cycling, skiing (Nordic/roller), strength training.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│              Next.js (React, App Router)            │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│              Apache (Reverse Proxy)                 │
│                 SSL via Let's Encrypt               │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           Next.js Server (PM2, port 3000)           │
│           API Routes + Server Components            │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ Strava API  │  │  AI Client  │  │  Cron Jobs │  │
│  │  (OAuth 2)  │  │ Claude/Gem. │  │ Daily sync │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              PostgreSQL Database                    │
└─────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | **Next.js 15** (App Router, TypeScript) | Full-stack, single repo, SSR + API routes |
| Database | **PostgreSQL** + **Prisma ORM** | Robust, relational, great for time-series queries |
| Auth | **NextAuth.js v5** | Email/password + Strava OAuth, future multi-user ready |
| Styling | **Tailwind CSS** + **shadcn/ui** | Consistent design system, soft components |
| Charts | **Recharts** | Composable, React-native, good for training data |
| Calendar | **react-big-calendar** | Full calendar view with custom event rendering |
| AI | **Abstracted AIClient** (Claude + Gemini) | Switchable in settings |
| Background jobs | **node-cron** | Daily Strava sync, built into the Next.js server process |
| Deployment | **PM2** + **Apache** reverse proxy | Standard Ubuntu server setup |
| Package manager | **pnpm** | Fast, efficient |

---

## 4. Design System

### Theme Philosophy
> Organized, data-driven, precision-focused. Like a serious athlete's training log — clean, functional, and quietly beautiful.

### Dark / Light Mode
- Both modes are fully supported. Implementation uses **Tailwind CSS `dark:` variant** + `next-themes` for persistence and system-preference detection.
- Toggle: sun/moon icon in the top-right of the nav bar. Preference stored in `localStorage` and respected on load.
- Default: follows OS preference (`prefers-color-scheme`).
- All colors defined as CSS custom properties on `:root` (light) and `.dark` (dark), consumed via Tailwind's `theme.extend.colors`. No hardcoded color classes in components — always use semantic tokens (`bg-surface`, `text-primary`, etc.).

### Color Palette

**Dark mode (default shown first):**
```
Background:   #0F1117  (deep charcoal)
Surface:      #1A1D27  (soft dark blue-gray)
Surface 2:    #222534  (card backgrounds)
Border:       #2D3148  (subtle borders)
Accent:       #6EE7B7  (muted emerald — primary actions)
Accent 2:     #818CF8  (soft indigo — secondary)
Text Primary: #F1F5F9  (warm white)
Text Muted:   #94A3B8  (slate-400)
Error:        #F87171  (soft red)
Warning:      #FBBF24  (amber)
```

**Light mode:**
```
Background:   #F8FAFC  (near-white, cool)
Surface:      #FFFFFF  (pure white cards)
Surface 2:    #F1F5F9  (subtle off-white)
Border:       #E2E8F0  (slate-200)
Accent:       #059669  (deeper emerald — readable on white)
Accent 2:     #6366F1  (indigo-500)
Text Primary: #0F172A  (near-black)
Text Muted:   #64748B  (slate-500)
Error:        #DC2626  (red-600)
Warning:      #D97706  (amber-600)
```

**Sport colors** — same in both modes (saturated enough to work on light and dark backgrounds):
```
Run:          #10B981  (emerald-500)
Orienteering: #059669  (emerald-600)
Cycling:      #6366F1  (indigo-500)
Skiing:       #38BDF8  (sky-400)
Roller ski:   #0EA5E9  (sky-500)
Strength:     #F87171  (red-400)
```

**Charts in light mode:** axis labels and grid lines use `#CBD5E1` (slate-300), chart backgrounds are transparent.

### Typography
- Font: **Inter** (system fallback: -apple-system)
- Headings: 600 weight, tight tracking
- Data labels: **JetBrains Mono** (numbers, paces, times)

### Components
- Border radius: `rounded-xl` (12px) for cards, `rounded-full` for pills/badges
- Dark shadows: `shadow-lg shadow-black/30`; Light shadows: `shadow-lg shadow-slate-200/80`
- Transitions: 150ms ease-out on all interactive elements, including theme switch (no flash)
- Cards in dark: `backdrop-blur-sm` for depth; in light: `border border-border` for definition

---

## 5. Database Schema

```prisma
// schema.prisma

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  name          String?
  createdAt     DateTime @default(now())

  stravaAccount    StravaAccount?
  activities       Activity[]
  plannedWorkouts  PlannedWorkout[]
  workoutTemplates WorkoutTemplate[]
  raceRecords      RaceRecord[]
  conversations    Conversation[]
  aiSettings       AISettings?
  athleteProfile   AthleteProfile?
}

// Physical profile used by AI coach for VO2max, TSS, race predictions, nutrition context
model AthleteProfile {
  id              String   @id @default(cuid())
  userId          String   @unique
  weightKg        Float?   // body weight in kg
  heightCm        Float?   // height in cm
  dateOfBirth     DateTime? @db.Date
  sex             String?  // "male" | "female" | "other" — affects VO2max norms and HR zones
  maxHeartRate    Int?     // if known from testing; otherwise estimated from data
  restingHeartRate Int?    // morning resting HR baseline (Garmin auto-fills this)
  primaryGoal     String?  // "marathon", "5K", "orienteering", "general fitness", etc.
  yearsTraining   Int?     // years of structured training (context for AI)
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id])
}

model StravaAccount {
  id              String   @id @default(cuid())
  userId          String   @unique
  athleteId       BigInt   @unique
  accessToken     String
  refreshToken    String
  expiresAt       DateTime
  scope           String
  lastSyncAt      DateTime?
  totalSynced     Int      @default(0)
  user            User     @relation(fields: [userId], references: [id])
}

model Activity {
  id                  String    @id  // Strava activity ID as string
  userId              String
  stravaId            BigInt    @unique
  name                String
  description         String?
  sportType           String    // Run, TrailRun, Ride, NordicSki, RollerSki, WeightTraining, etc.
  startDate           DateTime
  startDateLocal      DateTime
  timezone            String

  // Distance & Time
  distance            Float     // meters
  movingTime          Int       // seconds
  elapsedTime         Int       // seconds
  totalElevationGain  Float     // meters

  // Performance
  averageSpeed        Float?    // m/s
  maxSpeed            Float?
  averageCadence      Float?
  averageWatts        Float?
  weightedAverageWatts Float?

  // Heart Rate
  averageHeartrate    Float?
  maxHeartrate        Float?

  // Strava metadata
  sufferScore         Int?
  perceivedExertion   Int?      // 1-10
  workoutType         Int?      // 0=default, 1=race, 2=long run, 3=workout
  isRace              Boolean   @default(false)
  mapPolyline         String?

  // Splits (stored as JSON)
  splitsMetric        Json?
  laps                Json?
  bestEfforts         Json?

  // Computed/cached fields (updated periodically)
  trainingLoad        Float?    // Calculated TSS equivalent
  intensityFactor     Float?

  user                User      @relation(fields: [userId], references: [id])
  matchedPlanned      PlannedWorkout? @relation(fields: [matchedPlannedId], references: [id])
  matchedPlannedId    String?

  @@index([userId, startDate])
  @@index([userId, sportType])
  @@index([userId, isRace])
}

// User-defined sport categories (pre-seeded with defaults, fully addable)
model SportCategory {
  id       String   @id @default(cuid())
  userId   String
  name     String   // "Running", "Cycling", "Nordic Skiing", "Roller Skiing", "Orienteering", "Strength"
  color    String   // hex — used across calendar, charts, badges
  icon     String   // icon slug ("run", "bike", "ski", etc.)
  isDefault Boolean @default(false)
  order    Int      @default(0)
  user     User     @relation(fields: [userId], references: [id])
  workoutTypes WorkoutType[]
  templates    WorkoutTemplate[]
}

// User-defined workout types per sport (e.g. Easy Run, LT Run, Long Run, OL Sprint)
model WorkoutType {
  id         String   @id @default(cuid())
  userId     String
  sportId    String
  name       String   // "Easy Run", "LT Run", "Long Run", "Intervals", "OL", "Strength A"
  color      String?  // optional override
  order      Int      @default(0)
  sport      SportCategory @relation(fields: [sportId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
  templates  WorkoutTemplate[]
}

model WorkoutTemplate {
  id          String   @id @default(cuid())
  userId      String
  name        String
  description String?
  sportId     String
  typeId      String?
  color       String?  // overrides sport color if set

  // Estimated totals (auto-computed from sections)
  estimatedDistance Float?   // meters
  estimatedDuration Int?     // seconds
  estimatedTSS      Float?   // training stress score
  estimatedZoneDistribution Json? // { z1: 600, z2: 1200, z3: 300, ... } seconds per zone

  sections    WorkoutSection[]
  user        User            @relation(fields: [userId], references: [id])
  sport       SportCategory   @relation(fields: [sportId], references: [id])
  type        WorkoutType?    @relation(fields: [typeId], references: [id])
  planned     PlannedWorkout[]

  @@index([userId, sportId])
  @@index([userId, typeId])
}

// Ordered sections within a workout (warm-up, main block, recovery, etc.)
model WorkoutSection {
  id           String   @id @default(cuid())
  templateId   String
  order        Int

  name         String   // "Warm-up", "Threshold block", "Recovery jog", "Cool-down"

  // Volume — one of time or distance
  durationType String   // "time" | "distance" | "open" (no target, just a note section)
  duration     Int?     // seconds (if time-based)
  distance     Float?   // meters (if distance-based)
  repetitions  Int?     // if > 1: this section repeats N times (e.g. 5× 1km intervals)

  // Intensity target — one of hr_zone, pace_zone, rpe, power_zone
  zoneType     String?  // "hr_zone" | "pace_zone" | "power_zone" | "rpe"
  targetZone   Int?     // 1–5 (for hr_zone or pace_zone using user's calculated zones)
  targetPaceLow  Float? // m/s — lower bound of pace range
  targetPaceHigh Float? // m/s — upper bound
  targetHRLow  Int?     // bpm
  targetHRHigh Int?
  targetRPE    Int?     // 1–10
  notes        String?

  template     WorkoutTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@index([templateId, order])
}

model PlannedWorkout {
  id              String    @id @default(cuid())
  userId          String
  templateId      String?
  date            DateTime  @db.Date
  name            String
  sportType       String
  notes           String?
  targetDistance  Float?
  targetDuration  Int?
  targetIntensity String?
  color           String?

  // Completion tracking — only settable on or after the workout date
  status          String    @default("planned") // "planned" | "completed" | "missed" | "partial"
  missedReason    String?   // see MissedReason enum below
  missedNote      String?   // free-text elaboration (e.g. "left knee pain")
  markedAt        DateTime? // when the user logged the outcome

  user            User      @relation(fields: [userId], references: [id])
  template        WorkoutTemplate? @relation(fields: [templateId], references: [id])
  matchedActivity Activity[]

  @@index([userId, date])
  @@index([userId, status])
  @@index([userId, missedReason])
}

// MissedReason values (enforced in app logic, not DB enum for flexibility):
// "injury"       — physical injury prevented training
// "illness"      — sick
// "fatigue"      — excessive fatigue / overreaching
// "travel"       — travel / logistics
// "work"         — work or other obligations
// "weather"      — weather conditions
// "planned_rest" — intentionally swapped to rest
// "other"        — free-text only

model RaceRecord {
  id               String   @id @default(cuid())
  userId           String
  distance         String   // "5K", "10K", "Half Marathon", "Marathon", custom — no orienteering
  distanceM        Float    // meters, for sorting
  time             Int      // seconds
  date             DateTime @db.Date
  eventName        String?
  stravaActivityId String?
  notes            String?
  isManual         Boolean  @default(false)
  user             User     @relation(fields: [userId], references: [id])

  @@index([userId, distance])
  @@index([userId, distanceM])
}

// Training block: a named period of weeks with a shared purpose (Base, Build, Peak, Taper)
model TrainingBlock {
  id           String    @id @default(cuid())
  userId       String
  name         String    // "Base 1", "Build", "Peak", "Taper", or custom
  blockType    String    // "base" | "build" | "peak" | "taper" | "custom"
  color        String    // hex — used as calendar week overlay and banner badge
  startDate    DateTime  @db.Date
  endDate      DateTime  @db.Date
  targetRaceId String?   // optional link to a race calendar entry
  notes        String?

  // Targets (set when planning the block)
  targetKmPerWeek   Float?
  targetIntensity   String? // "polarized" | "pyramidal" | "threshold"

  // Actuals (populated automatically when block is archived)
  archived          Boolean  @default(false)
  actualKm          Float?
  actualTimeSec     Int?
  actualTSS         Float?
  actualCompletionRate Float? // 0–1

  user         User      @relation(fields: [userId], references: [id])

  @@index([userId, startDate])
  @@index([userId, archived])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  title     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
  user      User      @relation(fields: [userId], references: [id])
}

model Message {
  id             String      @id @default(cuid())
  conversationId String
  role           String      // "user" | "assistant" | "system"
  content        String
  createdAt      DateTime    @default(now())
  tokensUsed     Int?
  modelUsed      String?
  conversation   Conversation @relation(fields: [conversationId], references: [id])
}

model AISettings {
  id            String  @id @default(cuid())
  userId        String  @unique
  provider      String  @default("gemini")  // "claude" | "gemini"
  claudeApiKey  String?
  geminiApiKey  String?
  systemPrompt  String? // customizable coach persona
  user          User    @relation(fields: [userId], references: [id])
}
```

---

## 6. Feature Modules

### 6.1 Authentication

- Email + password login (hashed with bcrypt)
- Protected routes via NextAuth middleware
- Session stored in database
- **Future multi-user:** just allow registration — schema already supports it
- No public registration by default (single user mode: registration disabled after first account)

### 6.1b Settings Page

The settings page (`/settings`) is divided into sections:

**Integrations** — Strava, Garmin, AI coach. Each section has a collapsible **Setup Guide** with numbered steps, links to the relevant developer portals, and copy-pasteable env var snippets. Guides auto-open when the integration is not yet connected.

**Athlete Profile** — Physical data that the AI coach uses for VO2max estimation, TSS normalization, race predictions, and nutrition context:

| Field | Description |
|---|---|
| Name | Display name |
| Date of birth | Age context for age-graded performance tables |
| Sex | Affects VO2max reference norms and HR zone thresholds |
| Weight (kg) | Used in running power estimation and w/kg cycling metrics |
| Height (cm) | Supplementary context |
| Max heart rate | If known from testing; otherwise auto-estimated from activity data |
| Resting heart rate | Baseline; auto-filled from Garmin if connected |
| Primary goal | e.g. "marathon", "5K", "orienteering elite", "general fitness" — shapes coach personality |
| Years of structured training | Coach context: how experienced an athlete to treat you as |

The AI coach receives the full athlete profile in its cached system prompt. Example:
```
Athlete profile:
  Name: Noa · Age: 28 · Male · Weight: 72 kg · Height: 180 cm
  Max HR: 194 bpm · Resting HR: 42 bpm
  Primary goal: Orienteering performance (middle + long distance)
  Training experience: 8 years structured training
```

This enables personalized pacing advice (weight-adjusted), realistic VO2max benchmarks, and goal-relevant training plans without the user repeating their background each session.

**AI Coach** — Provider selector (Claude / Gemini), API key fields with show/hide toggle, monthly budget with spend progress bar and warning thresholds (80% = yellow, 100% = red).

**Account** — Bottom section with two actions:
- **Log out** — calls `next-auth/react` `signOut({ callbackUrl: "/login" })`
- **Delete account** — two-step inline confirm; calls `DELETE /api/settings/account`, which runs `prisma.user.delete` (cascades to all user-owned rows via `onDelete: Cascade`), then signs out

### 6.2 Strava Integration

**OAuth Flow:**
1. User clicks "Connect Strava" → redirected to Strava OAuth
2. Callback receives auth code → exchange for access + refresh tokens → store in `StravaAccount`
3. Initial sync: paginate all activities (handles Strava's 200/page limit)

**Sync Strategy:**
```
Initial sync:   Fetch all historical activities (paginated, may take minutes)
Daily sync:     Cron job at 06:00 → fetch activities since lastSyncAt
Manual sync:    Button triggers same incremental sync immediately
```

**Data fetched per activity:**
- All basic fields (distance, time, HR, speed, cadence, elevation)
- Splits and laps (for interval analysis)
- Best efforts (for race detection and PR tracking)
- Polyline (for map display)

**Activity Stream (optional, per-second data):**
- Only fetched on-demand (when user opens detailed activity view)
- Cached after first fetch to avoid repeated API calls
- Strava rate limit: 200 req/15min, 2000 req/day

**Token refresh:** Middleware checks expiry before each API call, refreshes automatically.

**Activity descriptions as AI context:**
Strava is the primary data source specifically because activity names and descriptions are written there. Every synced activity stores `name` and `description` in full. These are indexed and used as context for the AI coach — enabling queries like *"what did I write about that long run in March?"* or the coach noticing *"you mentioned knee pain in 3 activities last month"*.

### 6.2b Garmin Connect Integration (HRV + Sleep only)

Garmin is synced **only** for physiological data that Strava does not provide. Activities remain exclusively Strava-sourced so that user-written descriptions are always present.

**Data fetched from Garmin:**
- **HRV status** — nightly HRV score + HRV balance trend (Garmin's 5-night rolling baseline)
- **Sleep data** — total sleep, sleep stages (light/deep/REM/awake), sleep score, bed/wake times
- **Resting HR** — morning resting heart rate (more reliable from Garmin than Strava)
- **Body Battery** (if available) — Garmin's proprietary energy reserve score (0–100)
- **Respiration rate** (if available) — nightly average

**What is NOT fetched from Garmin:**
- Activities (use Strava for all activity data, always)
- GPS routes, segments, laps, splits

**Sync strategy:**
- Daily pull at 08:00 (after nighttime data is processed by Garmin)
- Stores per-day in `GarminDailySummary` table
- Manual sync button in Settings → Integrations

**Schema addition:**
```prisma
model GarminAccount {
  id           String   @id @default(cuid())
  userId       String   @unique
  accessToken  String
  refreshToken String
  expiresAt    DateTime
  user         User     @relation(fields: [userId], references: [id])
}

model GarminDailySummary {
  id              String   @id @default(cuid())
  userId          String
  date            DateTime @db.Date
  restingHR       Int?
  hrvNightly      Float?   // ms — overnight average
  hrvBalance      String?  // "Balanced" | "Low" | "Unbalanced" — Garmin's status
  sleepScore      Int?     // 0–100
  sleepDuration   Int?     // seconds
  sleepDeep       Int?     // seconds
  sleepLight      Int?     // seconds
  sleepRem        Int?     // seconds
  sleepAwake      Int?     // seconds
  bodyBattery     Int?     // 0–100, end-of-day value
  respirationRate Float?
  user            User     @relation(fields: [userId], references: [id])

  @@unique([userId, date])
  @@index([userId, date])
}
```

**AI context integration:**
HRV trend and sleep data are included in the coach's daily context block:
```
Recovery data (last 7 days):
  HRV:   52 → 49 → 47 → 45 → 43 → 41 → 40 ms  ← declining trend, flagged
  Sleep: 7.2h avg, 68 score avg
  Body Battery: 72 (this morning)
  Status: HRV has dropped 23% over 7 days — potential early overreaching or illness onset
```

### 6.2c Weather Data

**Source:** [Open-Meteo](https://open-meteo.com/) — free, no API key required, historical weather by coordinates and date.

**Why not from Strava:** Strava occasionally includes `device_watts` and perceived conditions in newer activities, but the data is device-dependent and incomplete. Open-Meteo provides consistent, queryable historical data.

**Data fetched per activity (on sync, not on-demand):**
- Temperature (°C) at activity start time
- Wind speed (km/h)
- Precipitation (mm)
- Weather condition code (clear / cloudy / rain / snow)

Fetched in a **batch background job** after Strava sync — one API call per activity per day, rate-limited to avoid hammering the API during initial sync of 2000 activities.

**Schema addition to `Activity`:**
```prisma
weatherTemp     Float?   // °C
weatherWind     Float?   // km/h
weatherPrecip   Float?   // mm
weatherCode     Int?     // WMO weather code
```

**Usage in statistics:**
- Activity detail card shows weather badge: `🌤 14°C · 12 km/h wind`
- Statistics filter: filter charts by temperature range, condition (show only runs in rain, etc.)
- Correlation insight (AI): *"Your average pace is 9 sec/km slower in temperatures above 20°C"*
- Tooltip: *"Weather significantly affects performance. Heat increases cardiovascular strain; cold air can reduce lung capacity. Comparing similar-condition efforts gives a truer picture of fitness."*

**AI context:** Temperature and conditions included in activity summaries sent to the coach — enabling comments like *"that threshold session was run in 27°C heat, which explains the elevated HR."*

### 6.3 Statistics Dashboard

#### Educational Tooltips — Global Design Rule
Every metric, chart, and section header has an `ⓘ` icon. Hovering/tapping it shows a compact tooltip with:
- **What it is** — plain-language definition
- **Why it matters** — what it tells you about your training
- **Good range / what to aim for** — concrete target or rule of thumb

Example tooltip for TSB:
> **Training Stress Balance (TSB)** — the difference between your long-term fitness (CTL) and short-term fatigue (ATL). A positive TSB means you're fresh; negative means you're carrying fatigue.
> *Good range to race in: +5 to +25. Deep in a training block: −10 to −30 is normal. Below −40 is overreaching risk.*

Tooltip content is written in the app's copy layer (`lib/tooltips.ts`) so it can be updated without touching component code.

---

#### Overview Cards (top row)
Each card has an `ⓘ` tooltip and a sparkline showing the last 8 weeks trend.

- This week: distance, time, elevation — per sport or total
- This month: same + comparison vs same month last year (Δ% badge)
- Year to date: vs same point last year
- Rolling 4-week average: smoothed volume — *tooltip: "Removes week-to-week noise to show your true training trend"*
- Consistency score: % of planned sessions completed in last 4 weeks — *tooltip: "Consistency matters more than any single session. 85%+ is elite-level adherence."*

#### Volume & Load Charts

**Weekly volume — stacked bar, rolling 12 weeks**
- Y-axis: distance or time (toggle)
- Bars stacked by sport (sport colors)
- Overlay: 4-week rolling average as a line
- Tooltip: *"Each bar is one week. Colors show how your sport mix shifts over time."*

**Rullande 4-veckorssnitt (line chart)**
- Smoothed distance and time trend per sport or total
- Tooltip: *"Shows your underlying fitness trajectory. Rising = building. Falling = recovering or tapering."*

**Höjdmeter per vecka (bar chart)**
- Per sport or total
- Tooltip: *"Elevation is a major driver of training load — the same distance uphill is significantly harder."*

**Lifetime totals (stat grid)**
- Total km, hours, elevation per sport since Strava start
- Tooltip per sport: *"Your lifetime running distance: equivalent to X marathons / Y laps of a track."*

**Training frequency (bar chart)**
- Sessions per week, per sport, rolling 12 weeks
- Tooltip: *"Frequency drives adaptation. Running 5× per week at lower volume beats 2× at high volume for most athletes."*

**Weekday distribution (bar chart)**
- Which days of the week you train most
- Per sport breakdown
- Tooltip: *"Reveals your structural patterns — useful for spotting if recovery days are consistent."*

#### Intensity & Zones

**HR zone distribution — stacked bar, per week, rolling 12 weeks**
- Z1–Z5 colored bands per week
- Tooltip per zone:
  - Z1 *"Recovery — very easy, conversational. Builds aerobic base with minimal fatigue."*
  - Z2 *"Aerobic — comfortable effort. The foundation of endurance. Most of your volume should be here."*
  - Z3 *"Tempo — 'comfortably hard'. Efficient but accumulates fatigue quickly. Use sparingly."*
  - Z4 *"Threshold — at or near lactate threshold. Raises your sustainable race pace ceiling."*
  - Z5 *"VO2max — maximum effort. Develops top-end aerobic capacity. Short intervals only."*

**Pace zone distribution — same layout as HR zones**
- Overlays user's calculated pace zones on actual data
- Tooltip: *"Pace zones are derived from your current VDOT. As you improve, zones shift automatically."*

**Polarization trend (line chart)**
- Shows % easy (Z1–Z2) vs % hard (Z4–Z5) over time
- Reference line at 80% easy
- Tooltip: *"Polarized training (80% easy, 20% hard, minimal moderate) is backed by the strongest evidence for endurance development. Most recreational athletes spend too much time in Z3."*

**TRIMP / TSS per week (bar chart)**
- Training load units — normalized across sports
- Tooltip: *"Training Stress Score quantifies the total demand of a session accounting for both duration and intensity. 100 TSS ≈ an all-out 1-hour effort."*

**ATL — Acute Training Load (line, 7-day rolling)**
- Tooltip: *"Your 'fatigue number'. High ATL = tired. After a hard week you'll feel this before CTL catches up."*

**CTL — Chronic Training Load (line, 42-day rolling)**
- Tooltip: *"Your 'fitness number'. Slow-moving — takes weeks to build and weeks to lose. This is what peaks at your best races."*

**TSB — Training Stress Balance (line + shaded zones)**
- = CTL − ATL, with colored bands: fresh / optimal / fatigued / overreaching
- Tooltip: *"Form indicator. Negative = carrying fatigue (normal in heavy training). Positive = fresh. Race when TSB is +5 to +25 after a taper."*

**Training Load chart implementation:**
- Renders ATL, CTL, TSB as a multi-line Recharts chart (`TrainingLoadChart.tsx`)
- **Time range selector**: 3M / 6M / 1Y / 2Y buttons (top-right of chart) — slices the data client-side
- Data window: server queries 730 days (2 years) of load curve; client slices to selected range
- Tick density auto-adjusts: labels every 28 days for 2Y, 14 days for 1Y, 7 days otherwise

#### Performance Metrics

**VO2max estimate (gauge + trend line)**
- Calculated from: race performances (VDOT), HR-rest ratio, tempo-HR regression — weighted average of available methods
- Confidence indicator: High / Medium / Low based on data recency
- Tooltip: *"VO2max is your aerobic engine size — the maximum oxygen your muscles can use. Elite runners: 70–85 ml/kg/min. Well-trained: 55–65. Improves with consistent training, especially intervals and volume."*

**VDOT (number + history line)**
- Jack Daniels' fitness index — directly maps to training paces and race predictions
- Tooltip: *"VDOT is a single number describing your current running fitness. Developed by coach Jack Daniels. A VDOT of 50 predicts a ~20:00 5K, 41:40 10K, 1:32 HM."*

**Training paces table**
- Auto-calculated zones from VDOT: Easy, Marathon, Threshold, Interval, Repetition
- Shows min/km range per zone
- Tooltip per zone: explains the physiological purpose and when to use it

**HR Efficiency trend (line chart)**
- Pace-per-HR-beat over time on easy runs (Z1–Z2 only)
- Rising = improving aerobic fitness
- Tooltip: *"Cardiac efficiency: how fast you run per heartbeat. Improving this means your heart is delivering more oxygen per pump — a core sign of growing aerobic fitness."*

**Aerobic decoupling / Pa:HR (per long run, scatter plot)**
- % drift between pace:HR ratio in first vs second half of long runs
- <5% = well-coupled (good aerobic base); >10% = struggling
- Tooltip: *"Aerobic decoupling measures how much your HR drifts relative to pace during a long effort. Low drift means your aerobic system can sustain the effort. High drift = your aerobic base needs more work."*

**Running economy trend (line)**
- Pace per HR at a standardized effort, rolling 6-week average
- Tooltip: *"Running economy is how efficiently you convert oxygen into speed. Improves with strength training, increased mileage, and technique work."*

**Cadence trend (line)**
- Steps/min average on runs, rolling 4-week
- Tooltip: *"Optimal cadence is typically 170–185 spm. Low cadence often means overstriding, which increases injury risk. Improving cadence by 5–10% can meaningfully reduce impact forces."*

**Stride length estimate (line)**
- Derived from cadence + speed
- Tooltip: *"Stride length × cadence = speed. Elite runners achieve speed primarily through longer strides, not faster cadence."*

#### Race Predictions

**Predicted race times table**
- 1500m, 3K, 5K, 10K, 15K, Half Marathon, Marathon — derived from current VDOT
- Color-coded vs your actual PBs: green (predicted faster), gray (similar), red (slower than PB)
- Tooltip: *"These predictions assume peak fitness and a good race. They're most accurate when your VDOT is based on a recent race performance."*

**TSB-adjusted ("today's") race predictions**
- A second column alongside the VDOT-based prediction: what you'd likely run *right now* given current fatigue/freshness
- Formula: base VDOT prediction × adjustment factor derived from TSB (fresh = ~100%, fatigued at TSB −30 = ~96–97%)
- Shows two rows per distance: `Peak fitness: 38:45` / `Today (TSB −18): 39:20`
- Tooltip: *"Your peak prediction assumes you've tapered and are fully rested. The today-adjusted number reflects your current fatigue state. The gap between them is how much performance you're currently 'leaving on the table' through accumulated fatigue — normal and expected in heavy training."*

**Race readiness per distance (gauge row)**
- How well your recent training matches the demands of each distance (volume, long runs, interval type)
- Tooltip: *"A 5K demands more VO2max work; a marathon demands more aerobic volume and long runs. This score reflects how targeted your recent training is for each distance."*

**Form history — CTL/TSB timeline (chart)**
- Annotated with your actual races — shows what your fitness/form looked like for each race
- Tooltip: *"Use this to learn your optimal taper. What was your TSB on your best race day? Repeat that pattern."*

**Best 8-week training blocks (ranked list)**
- Identifies your historically strongest build periods by CTL gain + performance outcome
- Tooltip: *"Knowing which training blocks actually moved the needle helps you repeat what works."*

#### Recovery & Health

**Recovery time estimate (banner on dashboard)**
- After each logged activity: estimated hours until fully recovered, based on duration + intensity + HR data
- Tooltip: *"Rough estimate only — individual recovery varies greatly. Use it as a minimum guide, not a ceiling."*

**Overtraining risk indicator (gauge)**
- ATL/CTL ratio: if ATL rises >10% faster than CTL over 2 weeks, triggers warning
- Tooltip: *"The '10% rule': avoid increasing weekly training load by more than 10% week-over-week. Rapid ATL spikes without CTL base are the leading predictor of overuse injury."*

**HRV trend (line chart)**
- Nightly HRV (ms) from Garmin, plotted over time alongside training load (CTL)
- Colored band: balanced / low / declining — based on Garmin's own baseline
- Tooltip: *"Heart Rate Variability measures the variation in time between heartbeats. Higher HRV = your nervous system is well-recovered. A sustained downward trend (>7 days) often precedes illness or overtraining by days."*

**Sleep quality trend (stacked area chart)**
- Hours of deep / REM / light / awake per night, rolling 4 weeks
- Sleep score overlay
- Tooltip: *"Deep sleep drives physical recovery and growth hormone release. REM sleep drives cognitive function and motor learning. Consistently low deep sleep impairs athletic adaptation even when training load is moderate."*

**Readiness score (daily gauge on dashboard)**
- Composite of: HRV status (40%), TSB (30%), sleep score (20%), resting HR trend (10%)
- Color: green / yellow / red
- Tooltip: *"A composite daily score. Use it to decide whether to push or pull back on a planned quality session. It is a guide, not a rule — learn how it correlates with how you actually feel."*

**Resting HR trend (line)**
- From Garmin daily summaries, 12-week view
- Tooltip: *"A rising resting HR (3–5 bpm above your normal) is an early signal of fatigue, illness, or dehydration. Track your baseline: for most trained athletes it's 40–55 bpm."*

**Injury/illness log (timeline)**
- Visual timeline of all missed-workout reasons over the past year
- Monthly breakdown: missed sessions by category
- Tooltip: *"Tracking why you miss sessions reveals patterns — recurring injuries at high mileage, illness during stress periods, etc."*

#### Sport-Specific

**Running: split analysis (scatter per activity)**
- Negative vs positive splits across all runs
- Tooltip: *"A negative split (second half faster) indicates better pacing and aerobic capacity. Consistently positive splits may indicate starting too fast or glycogen depletion."*

**Running: interval analysis (auto-detected)**
- Detects structured efforts from lap/HR data
- Shows rep times, average HR per rep, coefficient of variation (consistency)
- Tooltip: *"CV% across reps shows how consistent your effort was. <3% = very consistent execution. >8% = high variability, possibly pacing or fatigue issues."*

**Running: elevation impact**
- Gradient-adjusted pace (GAP) vs flat pace comparison
- Tooltip: *"Grade Adjusted Pace normalizes your effort for hills, making hilly runs directly comparable to flat ones."*

**Cycling: FTP estimate & w/kg (if power data available)**
- Tooltip: *"Functional Threshold Power is the highest average wattage you can sustain for ~60 minutes. w/kg (watts per kilogram) is the key cycling performance number — comparable across different body weights."*

#### Goals & Progress

**Annual goal tracker (per sport)**
- Set distance or time goal for the year → arc/gauge showing progress
- "On track" projection based on current pace
- Tooltip: *"Your projected year-end total assumes your current average weekly volume continues. Adjust training or the goal if needed."*

**Monthly goal (auto-derived or custom)**
- Breakdown of annual goal into monthly targets
- Actual vs target bar

**Comparison view (side-by-side)**
- Pick any two time periods → all metrics shown side by side
- Useful for: this year vs last year, pre-injury vs post-injury, summer vs winter

**Season spider chart**
- Radar/spider chart per month: shows how volume distributes across sports through the year
- Tooltip: *"Reveals your seasonal patterns — e.g. heavy skiing in winter, running peaks in spring/autumn."*

### 6.4 Training Planner

**Layout:**
- Two-panel view: left = template library, right = calendar
- Calendar fills the main area; library is a collapsible sidebar

**Calendar View:**
- Month view (default) and Week view
- Each day shows planned workouts as colored pills (sport color or type color)
- Completed Strava activities appear alongside planned ones (auto-matched by date + sport)
- Drag-and-drop to reschedule planned workouts between days
- Drag-and-drop from template library directly onto any calendar day

**Template Library (sidebar):**
- Full list of saved templates, grouped by sport then type
- Search/filter bar: by sport (tabs), by type (chips), by name (text)
- Sports and types are user-defined — manage via a Settings → Sports & Types page
- Each template card shows: name, type badge, sport color, estimated distance/duration, zone bar (colored strip showing section intensity distribution)
- Drag a card from the library → drop on a calendar day → creates a `PlannedWorkout` from that template
- "+" button on each template card → adds to today or prompts for a date

**Workout Builder:**
- Accessible from: template library ("New template"), calendar day ("Custom workout"), editing an existing template, **or editing a future planned workout** (clicking a future workout on the calendar opens the full builder pre-filled with the workout's data)
- When editing a future planned workout (`plannedWorkoutMode` prop): title changes to "Edit workout", a Delete button with inline confirm is shown in the footer
- If the planned workout has a linked `templateId`, saving also PATCHes the template (sections, name, sport, etc.)
- If there is no linked template, a stub `WorkoutTemplate` is synthesized from the `PlannedWorkout` fields so the builder has something to pre-fill from
- **Fields:** Name, Sport (dropdown from `SportCategory`), Type (dropdown filtered by sport, from `WorkoutType`), Description, Color override
- **Sections editor** (the core):
  - List of sections, drag-to-reorder
  - Each section row: `[Name] [Time or Distance] [×Reps] [Zone type] [Zone target] [Notes] [Delete]`
  - Zone target: if `hr_zone` or `pace_zone` selected → shows zone selector (Z1–Z5) with user's actual pace/HR values shown as reference: `Z4 · 3:45–3:55/km · 168–178 bpm`
  - If `rpe` → 1–10 slider
  - "Add section" button: pre-fills with defaults based on previous section
  - Section templates: quick-insert common blocks (Warm-up 15min Z1, Cool-down 10min Z1, etc.)
- **Live preview panel** (right side of builder):
  - Structured workout summary (like a Garmin workout preview)
  - Estimated totals: distance, duration, TSS
  - Zone distribution bar: horizontal stacked bar showing % time in each zone (Z1=blue, Z2=green, Z3=yellow, Z4=orange, Z5=red)
  - `Save as template` / `Add to plan` buttons

**Example section structure (LT run):**
```
Warm-up         15 min    pace_zone Z1–Z2
Easy build       5 min    pace_zone Z2–Z3
Threshold block 20 min    pace_zone Z4      ← "LT pace: ~3:55/km"
Recovery jog    10 min    pace_zone Z1
─────────────────────────────────────────
Total: 50 min | ~11 km | TSS ~65
Zone dist: Z1 42% · Z2 10% · Z3 0% · Z4 40% · Z5 0%  (rest: recovery)
```

**Planning:**
- Click any calendar day → quick-add panel: choose from templates or "Custom (blank)"
- Custom workouts: same builder, but saved only to the plan (not the template library unless user clicks "Save as template")
- Color-coded by sport; intensity shown via a thin colored bottom border (green=easy, yellow=moderate, orange=hard, red=max)

**Inline week summary (month view — always visible):**

In month view, each week row has a compact summary strip directly beside the week number — always visible without any click:

```
Wk 21  |  Run 82km · 6h 45min  |  Cykel 40km · 1h 20min  |  TSS 340  |  ▓▓▓▓░  Z2-heavy
```

- Shows km + time for each sport present that week (only sports with planned sessions shown)
- TSS estimate for the week
- A miniature 5-segment zone bar as a visual intensity fingerprint
- Completeness badge if the week is in the past: `4/5 ✓` or `3/5 (1 missed)`
- Block label shown as a colored tag if the week belongs to a training block: `[BUILD]`
- Clicking anywhere on the strip opens the **Detail Panel** (see below)

**Detail Panel (on click — slides in from right or expands below):**

Three tabs: **Week**, **Block**, **Plan**

*Week tab:*
```
Week 21 · May 19–25 · BUILD block · Planned load: 380 TSS

Volume by sport:
  Running   ████████████░░░  85 km · 7h 20min
  Cycling   ███░░░░░░░░░░░░  45 km · 1h 30min

Zone distribution (all sports):
  Z1 Easy       ████████████░░░  52%  4h 32min
  Z2 Aerobic    ████░░░░░░░░░░░  18%  1h 34min
  Z3 Tempo      ██░░░░░░░░░░░░░   8%  0h 42min
  Z4 Threshold  █████░░░░░░░░░░  15%  1h 18min
  Z5 VO2max     ███░░░░░░░░░░░░   7%  0h 37min

Intensity: Easy/recovery 70% · Hard/quality 30%  ← slightly high for build phase
Quality sessions: 3  (LT run, Intervals, Race-pace)
Interval time:  42 min · Long run: 2h 10min (Sunday)
```

*Block tab* (visible when the week belongs to a block):
- Block name, type, date range, target race
- Aggregated stats for the entire block: total km/time per sport, TSS per week as a curve, zone distribution over all block weeks
- Polarization chart for the block: how intensity distribution held across weeks
- Progress: week X of Y in block, % of planned sessions completed so far

*Plan tab* (entire planned season at a glance):
- Timeline view of all defined blocks from today to the target race
- Each block shown as a horizontal bar with: name, type color, week count, total planned km
- Load curve (planned TSS per week) over the full season
- Taper start marker and race date marker
- "How far out" summary: `14 weeks to race · 3 blocks remaining · Est. peak CTL: 72`

**Training Block planning:**

**Block dropdown banner (top of planner page — always visible, collapsible):**

A sticky header banner that collapses to a thin bar and expands on click. When expanded:

```
┌─ TRAINING BLOCKS ─────────────────────────────────────────────────────── [+ New block] [⌄ collapse] ┐
│                                                                                                       │
│  PAST (archived)                                                                                      │
│  ████ Base 1    Jan 6 – Feb 9     6 wks   completed   258 km · 21h · TSS 890   [↗ view]             │
│  ████ Build 1   Feb 10 – Mar 16   5 wks   completed   312 km · 25h · TSS 1180  [↗ view]             │
│                                                                                                       │
│  ── 🏁 Lidingöloppet  Mar 23  [C race] ──────────────────────────────────────────────────────────    │
│                                                                                                       │
│  CURRENT                                                                                              │
│  ████ Build 2   Mar 24 – Apr 27   5 wks   week 2/5    187 km so far · on track                      │
│                                                                                                       │
│  UPCOMING                                                                                             │
│  ████ Peak      Apr 28 – May 11   2 wks   planned     Target: 90 km / week                          │
│  ████ Taper     May 12 – May 25   2 wks   planned     –30% volume, race-pace work                   │
│                                                                                                       │
│  ── 🏁 Stockholm Marathon  May 25  [A race] ────────────────────────────────────────────────────     │
│                                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Chronological order** — past blocks, then races, then upcoming blocks, interspersed with race markers
- Completed/archived blocks show aggregate actuals (km, hours, TSS achieved)
- Current block shows live progress vs plan
- Upcoming blocks show targets
- Race entries appear inline at their correct chronological position with A/B/C badge
- Clicking a block row opens the Block Detail (same as Block tab in Detail Panel)
- Clicking a race entry opens the race goal editor

**Calendar week overlay:**
- Each calendar week has a **full-width colored hue** behind its row — the block's color at 15% opacity
- The week number cell shows the block type abbreviation as a small label: `BASE`, `BUILD`, `PEAK`, `TAPER`
- Weeks without a block have no overlay (transparent)
- Block color bleeds across all 7 days of the week, making the block structure immediately readable at a glance in the calendar

**Block creation / editing:**
- "New block" button in banner → modal: name, type (Base / Build / Peak / Taper / Custom), date range (date picker), color, optional target race link, notes, target km/week and intensity profile
- Block types have default colors: Base = `#3B82F6` blue, Build = `#F97316` orange, Peak = `#EF4444` red, Taper = `#14B8A6` teal, Custom = user-picked
- Date ranges can overlap or have gaps (unlabeled recovery weeks are allowed)
- Editing a block re-renders the calendar overlay and banner instantly

**Automatic archiving:**
- When a block's `endDate` passes, it is automatically marked `archived = true`
- Archived blocks move to the "Past" section in the banner
- Actuals (real Strava km/time/TSS) are computed and stored on the block at archive time
- Archived blocks are read-only but always accessible via `[↗ view]`

**Block statistics (Block tab in Detail Panel):**
- Planned vs actual: total km, time, TSS, zone distribution for the full block
- Week-by-week load bar chart within the block
- Polarization trend across the block's weeks
- Completion rate: sessions completed vs missed, with reasons breakdown
- If linked to a race: shows what CTL/TSB was on race day and resulting performance

**AI coach sees:**
- Current block name, type, week number within block, and target race
- Full block sequence from current date to next A race
- Archived block performance for context: *"your last build block averaged 72 km/week with 18% threshold work"*

**Polarization analysis:**
- Compares zone distribution to target profile (configurable: polarized 80/20, threshold-heavy, pyramidal)
- Shows deviation with a recommendation: "Z3 is overrepresented — consider replacing the Tuesday moderate run with an easy run"
- Historical polarization chart: how intensity distribution has shifted over weeks

**Workout outcome logging:**
- Past and today's workouts show a status indicator: `Completed`, `Missed`, `Partial`, or blank (planned)
- **Locking rule:** Status can only be set on or after the workout's date — future workouts have no status UI at all. Enforced both client-side (button hidden) and server-side (API rejects `date > today`)
- Clicking a past unresolved workout prompts: `Did you complete this session?`
  - **Yes** → auto-matches to Strava activity if found, or marks completed without activity
  - **Partial** → same as yes + optional note on what was shortened/modified
  - **No** → reason picker (dropdown: Injury, Illness, Fatigue, Travel, Work, Weather, Planned rest, Other) + optional free-text note
- Missed workouts shown in calendar with a muted red tint and reason tag
- **Injury/illness streaks** detected automatically: if 2+ consecutive days missed with reason `injury` or `illness`, a banner appears in the planner and coach context flags it

**Health & availability tracking:**
- Settings page has an "Availability log" view: timeline of all missed workouts grouped by reason
- Charts: missed sessions per month, breakdown by reason, injury frequency over time
- This feeds directly into AI context (see below)

**Race Calendar (integrated in planner view):**
- Dedicated section above the calendar: upcoming races listed chronologically with countdown
- Each race entry: name, date, distance, priority (A / B / C race), goal time, notes
- Priority system:
  - **A race** — peak event, full taper, everything else is prep
  - **B race** — important but no full taper, used as fitness check
  - **C race** — training race, no special prep
- Auto-generated **taper start date** shown in the calendar as a visual marker based on race date and distance (e.g. marathon → taper starts 3 weeks out, 5K → 1 week)
- Coach sees the race calendar as context and can structure training blocks around A races automatically
- After a race is completed it links to the matched Strava activity and moves to race history

**Adaptive plan re-scheduling:**
- When a workout is marked as missed, a prompt appears: *"Adjust the rest of the week?"*
- If confirmed: AI suggests a revised schedule (moves the quality session, protects recovery days)
- Suggestions shown as a diff vs current plan — user accepts, rejects, or edits each change
- Tracks whether the rescheduled workout was eventually completed (adherence metric)

**AI integration point:**
- "Plan my training" button → opens coach chat pre-loaded with current plan context
- AI can suggest workouts and add them directly to calendar via tool calls
- Coach sees race calendar (A/B/C priority, upcoming dates, goal times) as permanent context

### 6.5 Virtual Coach (AI)

**Chat Interface:**
- Persistent conversation history per session
- Markdown rendering for AI responses
- Code blocks for structured plans, tables for schedules

**Context Strategy (cost-efficient):**
```
System prompt (cached):
  - Coach persona + instructions
  - User's sport profile, goals
  - Current fitness metrics (VO2max, training paces, HR zones)
  - Current week's training plan

Per-message context (dynamic, NOT cached):
  - Last 4 weeks of activities (summary, not full detail)
  - Relevant history for the specific question (semantic search on activity names/descriptions)
  - Recent race results

Full activity data: NEVER sent wholesale — always filtered/summarized
```

**Coach capabilities:**
1. Answer questions about training history
2. Estimate VO2max, race times, training paces
3. Identify trends (overreaching, declining HR efficiency, etc.)
4. Create training plans (returns structured JSON → saves to planner)
5. Analyze specific workouts (user can share one)
6. Suggest recovery when load is high

**AI Provider Abstraction:**
```typescript
interface AIClient {
  chat(messages: Message[], context: TrainingContext): AsyncIterable<string>
  provider: 'claude' | 'gemini'
}

class ClaudeClient implements AIClient { ... }   // Anthropic SDK + prompt caching
class GeminiClient implements AIClient { ... }   // Google AI SDK
```

**Cost optimizations:**
- Claude: Use `cache_control` on system prompt + base context (saves ~80% on repeated tokens)
- Gemini: Use context caching API for same effect
- Store conversation history in DB — only send last N messages to model
- Summarize old conversations instead of expanding context indefinitely
- Activity data: always summarized (avg pace, distance, HR) — never raw stream data

**Switching providers:**
- Dropdown in chat UI: "Claude" / "Gemini Flash"
- API keys stored encrypted in `AISettings`
- Conversations tagged with which model was used

### Cost Tracking & Warnings

Every AI API call logs tokens used and estimated cost to the `Message` table. The UI surfaces this transparently:

**Per-message cost indicator:**
- Small badge under each AI response: `~$0.004 · 1,240 tokens`
- Collapsed by default, expandable on hover

**Session cost counter:**
- Sticky indicator in chat header: `Session: $0.02 | Month: $0.47`
- Updates live after each response

**Monthly budget system (Settings page):**
- User sets a monthly budget threshold (default: $5.00)
- At 80%: yellow warning banner in chat
- At 100%: red warning, chat still works but warns each message
- Cost resets on the 1st of each month

**Cost breakdown in Settings:**
```
This month:
  Claude API:   $0.47  (23 messages, 45K tokens)
  Gemini Flash: $0.00  (free tier)
  Total:        $0.47 / $5.00 budget

All time:
  Total spent:  $2.14
```

**Cost model stored per message:**
```typescript
// Pricing constants (updateable)
const PRICING = {
  claude: {
    input_per_1m:        3.00,   // $ per 1M input tokens
    output_per_1m:       15.00,  // $ per 1M output tokens
    cache_write_per_1m:  3.75,
    cache_read_per_1m:   0.30,   // 90% cheaper than input
  },
  gemini_flash: {
    input_per_1m:        0.00,   // Free tier (up to limits)
    output_per_1m:       0.00,
  }
}
```

**Gemini free tier limits tracked:**
- Gemini Flash: 15 RPM, 1M TPM, 1500 RPD on free tier
- Counter shown: `Gemini: 12 / 1,500 daily requests used`
- Warning when approaching limit

### 6.6 Race / PB Tracker

**Auto-detection:**
- Strava activities with `workout_type = 1` (race) auto-imported
- Activities with keywords in name: "race", "lopp", "tävling", "sprint", "competition" flagged
- User confirms/rejects suggested race imports

**Distance categories:**
```
Running:   800m, 1500m, Mile, 3K, 5K, 10K, 15K, Half Marathon, Marathon, Ultra (custom)
Cycling:   Custom distances
Skiing:    Custom distances
```
Orienteering is excluded from the race tracker — OL-pass are logged as activities and inform training stats, but are not tracked as timed races with PBs (course variations make direct comparison meaningless).

**PB Management:**
- For each distance: show current PB prominently
- Full history table: date, time, event name, ∆ from PB, Strava link
- Manual entry for pre-Strava races or other platforms
- Edit any record (manual correction)

**Visualizations:**
- Timeline chart per distance (all times plotted, PB highlighted)
- Year-over-year comparison per distance
- Age-graded performance (WMA tables) for context
- "Trajectory" line — trend direction

**Race Analysis:**
- Split comparison between races of same distance
- Heart rate comparison between races
- Conditions (elevation, date/season)

---

## 7. AI Integration — Detailed Strategy

### System Prompt (cached, ~500 tokens)
```
You are a professional endurance sports coach specializing in running, 
orienteering, cycling, and skiing. You have access to [athlete name]'s 
complete training history. Be data-driven, specific, and evidence-based.
Always reference actual activities when making claims about their training.

Current fitness snapshot:
- Estimated VO2max: {value} ml/kg/min (confidence: {high/med/low})
- Training paces: Easy {pace}, Marathon {pace}, Threshold {pace}, ...
- HR Zones: Z1 <{bpm}, Z2 {range}, Z3 {range}, Z4 {range}, Z5 >{bpm}
- Current TSB (form): {value} (fresh/neutral/fatigued)
- Weekly CTL trend: {rising/stable/declining}
```

### Context Selection per Query Type

| Query type | Context sent |
|---|---|
| "How was my training last month?" | Last 4 weeks summary, aggregated stats, missed workout log |
| "Plan my next 8 weeks" | Current week plan, last 6 weeks history + missed log, goals |
| "Why is my pace slow lately?" | Last 8 weeks with HR data, trend metrics, recent illness/fatigue misses |
| "What's my VO2max?" | Race history, recent tempo efforts, HR data |
| "Analyze this workout" | Single activity detail + recent comparable workouts |
| "Am I injured / overtraining?" | Full missed log with reasons, TSB trend, recent HR anomalies |

### Missed Workout Data in AI Context

The context builder always includes a compact missed workout summary in the system prompt alongside the fitness snapshot:

```
Availability & health log (last 12 weeks):
  Missed sessions: 4
    - 2025-04-14: Illness (influensa, 3 days out)
    - 2025-05-02: Injury (left knee pain)
    - 2025-05-03: Injury (left knee pain, consecutive)
  Current status: Active injury streak detected (knee, 2 days)
  Injury history: 2 knee incidents in last 6 months
```

This lets the coach proactively flag injury risks, adjust load recommendations during illness recovery, and track patterns (e.g. recurring knee issues after high mileage weeks) without the user having to explain their history each time.

### VO2max Estimation Algorithm
```
Method 1 (Race-based, most accurate):
  vdot = daniels_vdot_from_time(distance, time)
  vo2max = vdot

Method 2 (HR-based):
  vo2max ≈ 15.3 × (HRmax / HRrest)

Method 3 (Pace-HR regression):
  From workouts with both pace and HR data:
  extrapolate to theoretical max pace → convert to VO2max

Final estimate = weighted average of available methods
Confidence = based on how many methods available + data recency
```

### Token Cost Estimates
| Scenario | Tokens/query | Cost (Claude Sonnet) | Cost (Gemini Flash) |
|---|---|---|---|
| Simple question (cached context) | ~800 | ~$0.003 | Free |
| Complex analysis | ~3000 | ~$0.012 | Free |
| Training plan generation | ~5000 | ~$0.020 | Free |
| **Monthly (100 queries avg)** | — | **~$1-3** | **~Free** |

---

## 8. Project Structure

```
traininglab/
├── app/                          # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Main app shell with sidebar
│   │   ├── page.tsx              # Dashboard / overview
│   │   ├── activities/
│   │   │   ├── page.tsx          # Activity list + sync controls
│   │   │   └── [id]/page.tsx     # Single activity detail
│   │   ├── stats/
│   │   │   └── page.tsx          # Statistics dashboard
│   │   ├── planner/
│   │   │   ├── page.tsx          # Training planner calendar + library sidebar
│   │   │   └── builder/page.tsx  # Workout template builder
│   │   ├── coach/
│   │   │   └── page.tsx          # AI coach chat
│   │   └── races/
│   │       └── page.tsx          # Race/PB tracker
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── strava/
│   │   │   ├── callback/route.ts
│   │   │   ├── sync/route.ts
│   │   │   └── webhook/route.ts
│   │   ├── activities/
│   │   │   └── route.ts
│   │   ├── coach/
│   │   │   └── chat/route.ts     # Streaming AI responses
│   │   ├── planner/
│   │   │   └── route.ts
│   │   └── races/
│   │       └── route.ts
│   ├── globals.css
│   └── layout.tsx
│
├── components/
│   ├── ui/                       # shadcn/ui base components
│   ├── charts/
│   │   ├── WeeklyVolumeChart.tsx
│   │   ├── TrainingLoadChart.tsx
│   │   ├── HRZonesChart.tsx
│   │   └── PaceChart.tsx
│   ├── planner/
│   │   ├── TrainingCalendar.tsx
│   │   ├── TemplateLibrary.tsx      # Draggable sidebar with template cards
│   │   ├── TemplateCard.tsx         # Single template with zone bar preview
│   │   ├── WorkoutBuilder.tsx       # Section editor + live preview
│   │   ├── WorkoutSection.tsx       # Single section row (zone picker, reps, etc.)
│   │   ├── ZoneBar.tsx              # Stacked zone distribution bar
│   │   ├── WeekSummaryStrip.tsx     # Inline km/time/zone bar per week row in month view
│   │   ├── DetailPanel.tsx          # Slide-in panel with Week/Block/Plan tabs
│   │   ├── BlockEditor.tsx          # Create/edit training blocks with date ranges
│   │   ├── BlockBanner.tsx          # Collapsible dropdown banner (top of planner page)
│   │   ├── BlockBannerRow.tsx       # Single block/race row inside the banner
│   │   ├── SeasonTimeline.tsx       # Full season arc in Plan tab
│   │   ├── WeeklySummary.tsx        # Volume + zone + polarization panel (week tab)
│   │   └── IntensityAnalysis.tsx    # Polarization chart + recommendations
│   ├── coach/
│   │   ├── ChatInterface.tsx
│   │   ├── MessageBubble.tsx
│   │   └── ContextIndicator.tsx
│   └── races/
│       ├── PBCard.tsx
│       └── RaceTimeline.tsx
│
├── lib/
│   ├── strava/
│   │   ├── client.ts             # Strava API wrapper
│   │   ├── sync.ts               # Sync logic
│   │   └── types.ts
│   ├── garmin/
│   │   ├── client.ts             # Garmin Connect API wrapper (OAuth 2)
│   │   └── sync.ts               # Daily HRV + sleep sync
│   ├── weather/
│   │   ├── client.ts             # Open-Meteo API wrapper
│   │   └── backfill.ts           # Background weather fetch for existing activities
│   ├── ai/
│   │   ├── client.ts             # AIClient interface
│   │   ├── claude.ts             # Claude implementation
│   │   ├── gemini.ts             # Gemini implementation
│   │   ├── context-builder.ts    # Smart context selection
│   │   └── prompts.ts            # System prompts
│   ├── fitness/
│   │   ├── vo2max.ts             # VO2max estimation
│   │   ├── training-load.ts      # ATL/CTL/TSB
│   │   ├── paces.ts              # Training pace zones
│   │   ├── zones.ts              # Zone definitions (HR + pace) per user
│   │   └── plan-analysis.ts      # Zone dist, polarization, week structure analysis
│   ├── db/
│   │   └── prisma.ts             # Prisma client singleton
│   └── utils.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── public/
├── .env.local                    # Secrets (gitignored)
├── .env.example                  # Template (committed)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 9. Deployment (Ubuntu + nginx + helgars.se)

**Target setup:** Ubuntu server (SSH-only), existing nginx server with `theodal.helgars.se` already running. Wildcard cert `*.helgars.se` (Let's Encrypt) already in place. DNS A record for `training.helgars.se` and port forwarding already configured. Just add a new nginx server block using the existing cert.

---

### Step 1 — Find the Existing Cert Path

Check the existing theodal nginx config for the exact cert paths:
```bash
grep -r "ssl_certificate" /etc/nginx/sites-enabled/
```
The wildcard cert `*.helgars.se` covers `training.helgars.se` — no new cert needed. Path will look like:
```
/etc/letsencrypt/live/helgars.se/fullchain.pem
/etc/letsencrypt/live/helgars.se/privkey.pem
```

---

### Step 2 — Ubuntu Server Packages

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm and PM2 globally
sudo npm install -g pnpm pm2

# PostgreSQL (if not already installed)
sudo apt install -y postgresql postgresql-contrib
```

---

### Step 3 — Database

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE traininglab;
CREATE USER traininglab WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE traininglab TO traininglab;
SQL
```

---

### Step 4 — Application

```bash
sudo mkdir -p /var/www/traininglab
sudo chown $USER:$USER /var/www/traininglab
git clone git@github.com:uppfinnarnoa-lab/TrainingLab.git /var/www/traininglab
cd /var/www/traininglab
pnpm install --frozen-lockfile
```

Create `/var/www/traininglab/.env.local`:
```env
DATABASE_URL="postgresql://traininglab:CHOOSE_A_STRONG_PASSWORD@localhost:5432/traininglab"
AUTH_SECRET="run: openssl rand -base64 32"
NEXTAUTH_URL="https://training.helgars.se"
STRAVA_CLIENT_ID="your_client_id"
STRAVA_CLIENT_SECRET="your_client_secret"
STRAVA_REDIRECT_URI="https://training.helgars.se/api/strava/callback"
ANTHROPIC_API_KEY=""
GOOGLE_AI_API_KEY=""
```

Apply migrations and build:
```bash
pnpm prisma migrate deploy
pnpm tsx scripts/seed-user.ts       # creates admin user (run once)
pnpm build
```

---

### Step 5 — PM2

`ecosystem.config.js` is already in the repo. Start and persist:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed sudo command
```

---

### Step 6 — nginx Server Block

Create `/etc/nginx/sites-available/traininglab.conf`.
Replace cert paths with whatever Step 1 showed:

```nginx
server {
    listen 443 ssl;
    server_name training.helgars.se;

    # Existing wildcard cert — same as theodal.helgars.se
    ssl_certificate     /etc/letsencrypt/live/helgars.se/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/helgars.se/privkey.pem;

    # SSE streaming endpoints — buffering must be off
    location ~ ^/api/(coach/chat|strava/backfill-history|strava/backfill-weather) {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_set_header   Connection '';
        proxy_set_header   Host $host;
        proxy_read_timeout 3600s;
    }

    # All other traffic
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/traininglab.conf /etc/nginx/sites-enabled/
sudo nginx -t                    # must say "syntax is ok"
sudo systemctl reload nginx
```

---

### Step 7 — Strava OAuth Update

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Set **Authorization Callback Domain** to: `training.helgars.se`
3. Enter Client ID and Secret in the app's Settings page

---

### Step 8 — Post-Deploy Checklist

```
[ ] https://training.helgars.se loads — padlock green, no warning
[ ] Log in as admin user
[ ] Settings → enter Strava Client ID + Secret → Save
[ ] Settings → Connect with Strava → authorize
[ ] Settings → Sync new activities → confirm count
[ ] Settings → Backfill all historical activities (auto-resumes nightly 00:30 UTC)
[ ] Settings → Backfill weather data
[ ] Stats page loads with real data
[ ] PM2 survives reboot: sudo reboot → pm2 list
```

---

### Maintenance

| Task | Command |
|------|---------|
| App logs | `pm2 logs traininglab` |
| nginx logs | `sudo tail -f /var/log/nginx/error.log` |
| Restart app | `pm2 restart traininglab` |
| Deploy update | `git pull && pnpm install && pnpm build && pm2 reload traininglab` |
| DB migrations | `pnpm prisma migrate deploy` |
| Check cert renewal | `sudo certbot renew --dry-run` |

---

## 10. Development Phases

### Phase 1 — Foundation ✅ COMPLETE
- [x] Next.js 15 + TypeScript + Tailwind CSS + pnpm initialized
- [x] Full Prisma schema written (`prisma/schema.prisma`) — all models from plan
- [x] NextAuth v5 with email/password (`auth.ts`, `middleware.ts`, `/api/auth/[...nextauth]`)
- [x] Seed script for first user + default sport categories (`scripts/seed-user.ts`)
- [x] Dark/light mode with `next-themes`, CSS custom properties, theme toggle
- [x] App shell: sidebar navigation, dashboard layout, route groups `(auth)` / `(dashboard)`
- [x] Login page (`/login`)
- [x] Dashboard placeholder (`/`)
- [x] Strava OAuth flow + token refresh (`lib/strava/client.ts`, `/api/strava/callback`)
- [x] Strava sync engine — full + incremental (`lib/strava/sync.ts`, `/api/strava/sync`)
- [x] Activity list view with sport filter chips + pagination (`/activities`)
- [x] Settings page with Strava connect UI + sync controls (`/settings`)
- [x] Garmin Connect OAuth + daily HRV/sleep sync (`lib/garmin/`, `/api/garmin/`)
- [x] Weather backfill job — Open-Meteo, polyline decode, throttled (`lib/weather/`)
- [x] Daily cron jobs: Strava 06:00, weather 07:00, Garmin 08:00 (`lib/cron.ts`)
- [x] Cron wired via Next.js instrumentation hook (`instrumentation.ts`)
- [x] `.env.example` with all required variables documented

**Notes from implementation:**
- Prisma types are `any` until user runs `pnpm db:generate` after connecting a real DB
- `pnpm.onlyBuiltDependencies` must be set in `pnpm-workspace.yaml` (not `package.json`) in pnpm v11+
- Next.js 15 `instrumentationHook` experimental flag removed — instrumentation is now automatic
- Weather uses first GPS point from summary polyline (simple decoder, no external lib needed)

### Phase 2 — Statistics ✅ CORE COMPLETE (remaining items deferred)
- [x] Fitness computation library: `lib/fitness/zones.ts`, `training-load.ts`, `vo2max.ts`, `paces.ts`
- [x] Educational tooltips: `lib/fitness/tooltips.ts` — ATL, CTL, TSB, VO2max, VDOT, TSS, HR zones, polarization, Pa:HR, readiness, consistency
- [x] Stats page (`/stats`) with 5-tab layout: Overview, Volume, Load, Zones, Fitness
- [x] Overview cards with inline SVG sparklines, YoY % delta badges, form card
- [x] Weekly volume chart — Recharts stacked bar by sport + 4-week rolling avg line
- [x] Training load chart — ATL/CTL/TSB 16-week line chart with reference line
- [x] HR zone distribution — donut chart + bar breakdown with % and duration
- [x] VO2max: 3-method estimation (race VDOT, HR ratio, submaximal run), confidence indicator
- [x] Training paces table: Easy / Marathon / Threshold / Interval / Repetition from VDOT
- [x] Race time predictions: 800m–marathon, peak fitness + TSB-adjusted "today" columns
- [x] Athlete profile form in settings (`/settings` → athlete profile section)
- [x] `/api/settings/profile` route — saves name, weight, height, DOB, sex, max/rest HR, goal
- [x] `/api/stats` route — full server-side aggregation endpoint

**Deferred to future session (Phase 2b):**
- [ ] HR efficiency trend, aerobic decoupling (Pa:HR), running economy, cadence trend charts
- [ ] Split analysis + auto-detected interval analysis
- [ ] Recovery time estimate + overtraining risk indicator
- [ ] Annual/monthly goal tracker
- [ ] Comparison view (period A vs B)
- [ ] Season spider / radar chart
- [ ] Daily cron sync (already built in Phase 1)

**Notes from implementation:**
- Stats page is a server component that computes everything — no client-side data fetching needed
- Fitness lib functions are pure TypeScript with no DB dependency — easy to unit test
- VO2max uses binary search to invert the Daniels VO2-pace formula
- TSS uses TRIMP-exponential (Banister) normalized to threshold effort
- Type safety: explicit `A` type alias required since Prisma client returns `any` before `db:generate`

### Phase 3 — Training Planner ✅ CORE COMPLETE

- [x] `lib/planner/types.ts` — shared types for all planner components
- [x] `/api/sports` — GET (all sports + types), POST (create sport or type)
- [x] `/api/planner/templates` — GET all, POST create (with section computation)
- [x] `/api/planner/templates/[id]` — DELETE
- [x] `/api/planner/workouts` — GET (date range), POST create
- [x] `/api/planner/workouts/[id]` — PATCH (reschedule, outcome), DELETE
- [x] Workout builder modal (`WorkoutBuilder.tsx`) — name/sport/type/date, ordered sections editor, zone picker with user's actual pace/HR values, live estimated totals + zone bar preview
- [x] Zone bar (`ZoneBar.tsx`) — proportional colored strip from zone distribution
- [x] Template library sidebar (`TemplateLibrary.tsx`) — search, sport filter tabs, grouped by sport, collapsible
- [x] Template card (`TemplateCard.tsx`) — sport badge, estimated duration/distance, zone bar, add/delete actions
- [x] Workout pill (`WorkoutPill.tsx`) — status icons, missed reason tag, "Log?" prompt for past unlogged
- [x] Outcome modal (`OutcomeModal.tsx`) — completed/partial/missed flow, missed reason picker (8 categories), free-text note
- [x] Week summary strip (`WeekSummaryStrip.tsx`) — km/time per sport, zone fingerprint bar, completeness for past weeks, block label
- [x] Planner calendar (`PlannerCalendar.tsx`) — month view, day cells with block color overlay, today highlight, workout pills (max 3 + overflow), week summary strips
- [x] Block banner (`BlockBanner.tsx`) — collapsible, chronological past/current/upcoming sections
- [x] Planner page (`/planner`) — server component fetching all data, passes zone ranges to builder
- [x] Planner client (`planner-client.tsx`) — state management, template → plan flow, outcome saving

**Deferred to future session:**
- [ ] Drag-and-drop from library to calendar (using @dnd-kit — currently using prompt-based date input)
- [ ] Activity → Planned workout auto-matching
- [ ] Block editor modal (create/edit blocks with date picker)
- [ ] Intensity analysis detail panel (Week/Block/Plan tabs)
- [ ] Sport/Type management settings page

**Notes from implementation:**
- Template library uses click-to-add with `prompt()` for date — DnD deferred as it requires significant extra work
- Block calendar overlay uses 5% opacity background on day cells from block color
- Outcome locking (no future status) enforced in PATCH route (`date > today` → 422)
- Zone ranges passed from server using user's actual VDOT (default VDOT 45 if insufficient data)
- Serialization helper converts all Prisma Dates to YYYY-MM-DD strings for client components

### Phase 4 — AI Coach ✅ COMPLETE
- [x] `lib/ai/client.ts` — AIClient interface, PRICING constants, estimateCost()
- [x] `lib/ai/claude.ts` — ClaudeClient with streaming + prompt caching (cache_control: ephemeral)
- [x] `lib/ai/gemini.ts` — GeminiClient with streaming via generateContentStream
- [x] `lib/ai/prompts.ts` — buildSystemPrompt(CoachContext), CoachContext interface
- [x] `lib/ai/context-builder.ts` — buildCoachContext() (profile, VO2max, TSB, health log, plan), buildRecentActivitiesSummary()
- [x] `/api/coach/chat` — SSE streaming route, saves messages, tracks cost, updates monthly spend
- [x] `/coach` page — full chat UI with streaming, cost header, session/monthly spend display, suggested questions
- [x] Conversation history (last 20 messages sent as context)
- [x] Plan-action parsing spec in `docs/api/coach.md`

**Notes:**
- `cache_control: ephemeral` on system prompt saves ~80% on Claude input tokens for repeated queries
- Gemini Flash is free tier — cost shown as $0.000
- Provider switchable per-user in AISettings; falls back to env-var keys

### Phase 5 — Race Tracker ✅ COMPLETE
- [x] `/api/races` — GET all, POST create, PUT auto-import from Strava
- [x] `/api/races/[id]` — PATCH edit, DELETE
- [x] Auto-import: matches Strava race activities to standard distances ±5%
- [x] `/races` page — distance selector, PB card, timeline line chart (reversed Y), history table
- [x] Manual entry modal with h:mm:ss input and custom distance support
- [x] Delete with confirmation, Strava activity link

### Phase 6 — Polish ✅ COMPLETE
- [x] `app/(dashboard)/loading.tsx` — skeleton loading state
- [x] `app/(dashboard)/error.tsx` — error boundary with reset button
- [x] Two full bug audits + all issues fixed (see notes below)

### Bug Fixes Applied
**First audit fixes:**
- `context-builder.ts`: name field was always null → now null (filled by caller from User.name)
- `prisma/schema.prisma`: added `onDelete: Cascade` to all 15 user-owned relations + Message→Conversation
- `workouts/[id]/route.ts`: date comparison changed to string comparison to avoid timezone bugs
- `strava/sync.ts`: silent `catch {}` replaced with logged error
- `planner-client.tsx`: added guard when sport lookup fails before creating workout

**Second audit fixes:**
- `vo2max.ts`: binary search direction was inverted — fixed (decreasing function, lo/hi now correct)
- `zones.ts`: `vdotToVelocity` initial guess was nonsensical — fixed to `vdot * 5.0` m/min
- `PlannerCalendar.tsx`: blockForDate O(days×blocks) per render → memoized to O(1) with Map
- `import-training-plan.ts`: `seenWeek52` / `crossedWeek52` naming inconsistency → unified to `crossedWeek52`

**Third audit fixes (from MASTER_PLAN.md + interval-vo2max-research.md):**
- `dashboard/page.tsx` BUG-06: TSS date was always `new Date()` → now uses `a.startDate`
- `context-builder.ts` BUG-08: `estimateVO2max()` now receives `name`, `startDate`, and `racePBs`
- `stats/page.tsx` BUG-09: activity window extended from 730 to 5×365 days
- `cache.ts`: `updateHRZones()` now uses `estimateMaxHRFromRaces()` with same priority as stats page
- `races/route.ts`: removed `PUT` (auto-import from Strava) — manual-only flow
- `races-client.tsx`: Edit modal added per row, activity linking (±3 days), no import button
- `api/races/[id]/route.ts`: `PATCH` endpoint added for editing existing records
- `api/races/activities-near/route.ts`: new endpoint — returns activities within ±3 days of a date
- `api/coach/calibrate/route.ts` BUG-03: AI mode now returns structured JSON zone boundaries and applies them to cache
- `splits-chart.tsx` 6D: avg-pace line height correctly computed from dynamic scale (`scaleMax - avgSecPerKm`) / scaleRange
- `vo2max.ts`: added Model 6 — Critical Speed (CS) from race PBs via linear regression; weight 0.15 when PBs present
- `vo2max.ts`: training-run conservative factor changed from 0.96 → 0.98 (less aggressive penalty)
- `cache.ts` Issue 2: HR-pace regression runs now include exponential recency weights (180-day half-life)
- `zones.ts`: `estimateLTFromRaces()` — data-driven LT1/LT2 from race PBs + HR-pace regression; used in `updateHRZones()`
- `zones.ts`: `buildHRZonesFromLT()` — non-uniform zone boundaries anchored to LT1/LT2
- `context-builder.ts`: race PBs now included in AI coach system prompt

**Session 2026-05-24 (Ny promot.md):**
- `zones.ts`: `buildPaceZonesFromLT(lt1, lt2)` — LT-anchored pace zones; Z1 > LT1×1.08, Z2 LT1×1.08–LT1, Z3 LT1–LT2, Z4 LT2–LT2×0.95, Z5 < LT2×0.95
- `stats/page.tsx`: LT-based pace zones now used in both fast and slow paths when race-PB LT estimation succeeds
- `stats/page.tsx`: Volume-Adjusted Riegel model (Alex Gascón) added to predictions dropdown; exponent d = clamp(1.18 − 0.0015 × avgWeeklyRunKm, 1.05, 1.18) from 8-week running volume
- `fitness-metrics.tsx`: model selector shows `exp X.XXX` instead of `VDOT X` for Volume-Adjusted Riegel; note text explains the exponent
- `cache.ts` `updateHRZones()`: now saves `predictionsJson` and `vo2maxBreakdownJson` so model selector works after manual calibration
- `api/races/activities-near/route.ts`: removed sport type filter — all sports returned, enabling linking for cycling/skiing/OL races
- `api/races/auto-link/route.ts`: fixed BigInt serialization crash — `stravaId` typed as `bigint` and converted with `.toString()`
- `races-client.tsx`: ExternalLink icon added to PB card when `stravaActivityId` is set; auto-link button and per-row unlink button added
- `docs/fitness/hr_zones_current.md`: moved from `docs/planning/` to `docs/fitness/`

**Session 2026-05-26 (part 1 — fitness + polish):**
- `settings/account-actions.tsx`: new Account section at bottom of settings — Log out + Delete account with two-step confirm
- `api/settings/account/route.ts`: `DELETE` endpoint — `prisma.user.delete` with cascade
- `TrainingLoadChart.tsx`: added 3M/6M/1Y/2Y time range selector; data window extended to 730 days
- `stats/page.tsx`: both fast and slow paths extended to query 730 days of load curve
- `planner-client.tsx`: `WorkoutBuilder` now used for editing future planned workouts (not just templates); IIFE pattern replaced with `useMemo`
- `WorkoutBuilder.tsx`: added `plannedWorkoutMode` prop + `onDelete` prop; delete with inline confirm shown in footer
- `athlete-profile.tsx`: `handleSave` now checks `res.ok` and surfaces error to user instead of always showing "Saved ✓"; dateOfBirth normalized to YYYY-MM-DD in form init to fix Zod `invalid_input`
- Logo: T-icon pull-in set to `-(size * 0.20)` for correct letter-gap spacing
- `zones.ts` `buildPaceZonesFromLT`: rewritten with velocity arithmetic — derives vVO2max from LT2 (LT2 ≈ 88% vVO2max, Seiler 2010), computes all Daniels zones as % of vVO2max in m/s before converting back to sec/km; old sec/km multiplication produced wrong interval zones
- `vo2max.ts`: removed Cooper model (duplicate of Uth-Sørensen); removed HR-pace regression from weighted estimate (unreliable due to warm-up/cool-down noise); added Volume-adjusted Riegel as Model 4 — exponent d = clamp(1.18 − 0.0015 × avgWeeklyKm, 1.05, 1.18), projects best PB to predicted 10K then computes VDOT; fixed "Decay bridge" capitalisation
- `vo2max.ts`: VDOT base weight reduced (0.35→0.28 with current signals, 0.55→0.45 without); PB age-decay added — factor 1.0 at ≤90 days, linear decay to 0.35 at 540+ days, so stale PBs cannot dominate over TSB/HR/Riegel signals
- `stats/page.tsx` + `cache.ts`: compute `avgWeeklyRunKm` (8-week rolling window, run/trail only) and pass as 6th arg to `estimateVO2max`

**Session 2026-05-26 (part 2 — 5-feature sprint):**
- `app/layout.tsx`: added `viewport` export (`width=device-width, initialScale=1`) for correct mobile scaling — separate from `Metadata` as required by Next.js 15
- `app/(dashboard)/dashboard/page.tsx`: `aggSince()` gains optional `until` param; added `runLyYtd` query (same sport, same day-of-year last year); computed `onPaceKm = (ytdKm / dayOfYear) × 365` and `lyYtdKm`; both passed to `DashboardCards` via `run` prop
- `app/(dashboard)/dashboard/dashboard-cards.tsx`: `StatCard` gains optional `onPace` and `lyYtd` string props shown as sub-labels under the YTD card value
- `prisma/schema.prisma`: added `startLat Float?` and `startLng Float?` to `Activity`; applied via `prisma db push` (migrate dev would reset due to schema drift)
- `lib/strava/sync.ts`: `mapActivity()` now extracts `startLat`/`startLng` from Strava `start_latlng` array; `syncActivities()` fires weather fetch after upsert (fire-and-forget); new `syncSingleActivity(userId, stravaActivityId)` fetches one activity from Strava and upserts+weather; new `deleteStravaActivity(userId, stravaActivityId)` deletes by userId+stravaId
- `lib/weather/open-meteo.ts`: NEW — `fetchHistoricalWeather(lat, lng, dateUtc)` calls Open-Meteo archive API (`archive-api.open-meteo.com/v1/archive`), picks hourly index closest to activity start hour, returns `WeatherSnapshot { tempC, windKph, precipMm, weatherCode, condition }`; `fetchAndSaveWeather(activityId, lat, lng, dateUtc)` fetches and persists to DB; no API key required
- `app/api/strava/webhook/route.ts`: NEW — `GET` verifies Strava hub challenge (`hub.mode=subscribe` + `hub.verify_token` env var check); `POST` receives activity events, looks up user by `StravaAccount.athleteId`, dispatches `create`/`update` to `syncSingleActivity` or `delete` to `deleteStravaActivity` (fire-and-forget); requires `STRAVA_WEBHOOK_VERIFY_TOKEN` env var; see `docs/api/strava.md` for activation steps
- `app/api/strava/backfill-weather/route.ts`: NEW — `POST`, auth-required; fetches up to 200 activities with `weatherTemp: null` and non-null coords; calls `fetchAndSaveWeather` with 300ms throttle; returns `{ processed, updated, skipped }`
- `app/(dashboard)/activities/[id]/page.tsx`: added `workoutType` to Prisma select; renders `<WorkoutAnalysis>` conditionally for `workoutType === 3` (Strava "workout" type — intervals/tempo)
- `app/(dashboard)/activities/[id]/workout-analysis.tsx`: NEW client component; `computeRating(splits, activity)` returns `{ score: 1-5, intensityIndex, consistencyPct, hrResponsePct, bullets }`; intensity index = `meanLapSpeed / overallSpeed`; consistency = `1 - stddev(speeds)/mean*5` clamped 0–100; `StarRating` uses lucide `Star` with fill-warning; "Analyze with AI" button streams from `/api/activities/[id]/analyze`; shows AI prose below rating
- `app/api/activities/[id]/analyze/route.ts`: NEW streaming endpoint — `POST`, auth-required, validates `workoutType === 3`; fetches activity + fitnessCache + aiSettings; builds compact prompt with lap breakdown, TSB, VDOT, weather; streams via Claude Haiku (`claude-haiku-4-5-20251001`) or Gemini Flash (`gemini-2.0-flash-lite`); returns `text/plain; charset=utf-8` `ReadableStream`; see `docs/api/activities.md`
- `app/(dashboard)/stats/page.tsx`: new `computeWeatherStats(acts)` — temp bands (<5, 5–10, 10–15, 15–20, >20°C) and wind bands (Calm <10, Light 10–20, Moderate 20–30, Strong >30 km/h); per band: count + avg pace sec/km; runs across all time (no date limit); result passed to client as `weatherStats: WeatherStats | null`
- `app/(dashboard)/stats/stats-client.tsx`: `WeatherProfileCard` renders two bar sections (byTemp, byWind); bar width relative to session count; pace color-coded (accent = fastest, error = 15+ s/km slower); wrapped in `<>...</>` fragment alongside analytics grid to support multiple JSX roots inside `{analytics && (}`

**Session 2026-05-27 (LT1/LT2 override + dashboard widgets + easy pace trend + R² in UI):**
- `prisma/schema.prisma`: added `manualLT1HR Int?` and `manualLT2HR Int?` to `AthleteProfile` — user-settable LT threshold overrides; estimation never writes here; applied via `prisma db push`
- `lib/fitness/zones.ts` `buildHRZones()`: LT1 percentage raised from 0.80 → 0.83; LT2 stays at 0.89
- `lib/fitness/zones.ts` `estimateLTFromRaces()`: fallback maxHR percentage for LT1 raised from 0.78 → 0.82 in both fallback paths
- `lib/fitness/cache.ts` `updateHRZones()`: manual LT1/LT2 override block added — if `profile.manualLT1HR` and `profile.manualLT2HR` are both set and physiologically valid, builds zones via `buildHRZonesFromLT` and applies them; estimation result is never written back to profile; function now also returns `rSquared`, `zonesMethod` ("statistical"/"race-pbs"/"fallback"/"manual"), `lt1HR`, `lt2HR`
- `app/(dashboard)/settings/athlete-profile.tsx`: added LT1 and LT2 input fields (same pattern as maxHR/restHR override)
- `app/api/settings/profile/route.ts`: `manualLT1HR` and `manualLT2HR` added to Zod schema; included in recalibration trigger condition
- `app/(dashboard)/settings/page.tsx`: `manualLT1HR` and `manualLT2HR` passed to AthleteProfileForm
- `app/(dashboard)/dashboard/page.tsx`: added `allLyYtd` query; computed `allOnPaceKm`, `allLyYtdKm`, `runAvgWeekKm`, `allAvgWeekKm`, `weeksElapsed`; updated DashboardCards props
- `app/(dashboard)/dashboard/dashboard-cards.tsx`: complete rewrite — added `SportExtra { onPaceKm, lyYtdKm, avgWeekKm }` interface; separated "On pace", "Avg/week YTD", and "YTD runs/sessions" into dedicated `TrendCard` components for both Running and All sports sections
- `app/(dashboard)/stats/page.tsx`: added `computeEasyPaceTrend(acts, lt1HR)` — groups running activities (HR < LT1, ≥ 6km, not race) by month, computes median GAP per month, requires ≥ 3 sessions; runs in both fast and slow paths; exports `EasyPacePoint` type
- `components/charts/EasyPaceTrendChart.tsx`: NEW — Recharts LineChart showing monthly median GAP on easy runs; Y-axis reversed (lower = faster = higher); linear regression trend line (dashed); quarterly grouping toggle (auto-enabled when > 18 months); custom tooltip with tempo, avgHR, count
- `app/(dashboard)/stats/stats-client.tsx`: `EasyPaceTrendChart` added to Fitness section (visible when ≥ 3 months of data); uses `tooltips.easyPaceTrend` for info tooltip
- `lib/fitness/tooltips.ts`: added `easyPaceTrend` tooltip entry
- `app/api/coach/calibrate/route.ts`: algorithmic response now includes `rSquared`, `zonesMethod`, `lt1HR`, `lt2HR` from `updateHRZones()` result
- `app/(dashboard)/stats/stats-client.tsx` `ZoneCalibrationButton`: result panel now shows LT1/LT2 bpm, method name, and R² (when statistical method ran); useful for debugging without reading server logs
- `CLAUDE.md`: Session End section updated — added step 3: restart dev server after every task

**Session 2026-05-28 (10-issue bug audit):**
- `app/api/strava/webhook-subscription/route.ts`: fix race condition — `verifyToken` now saved to DB *before* outbound Strava POST; Strava immediately fires GET validation against our endpoint which checks the DB; if Strava POST fails, token is cleared from DB
- `app/(dashboard)/stats/page.tsx` + `stats-client.tsx`: fix pace zone bucketing — all cascade checks changed from `[0]` (slow boundary) to `[1]` (fast boundary); pace zones are stored `[slow, fast]` so comparing to index 0 was classifying most training as marathon+; fixes both fast path and slow path
- `app/(dashboard)/stats/page.tsx`: weather/wind stats now exclude OL (orienteering) sessions — detected via sportType regex and name keywords; apply rolling 12-week fitness-drift correction (rolling median subtracted from each activity's pace before computing per-condition averages); added `median()` helper; minimum activity distance raised to 3 km; `isRace: false` filter added
- `app/(dashboard)/stats/stats-client.tsx` `WeatherProfileCard`: replace CSS custom property colors (`var(--accent)` etc.) with hardcoded hex performance colors — green `#6EE7B7` (within 5 s/km), amber `#FBBF24` (5–15 s/km slower), red `#F87171` (15+ s/km slower); applies to both bar fills (opacity 0.7) and pace text
- `app/(dashboard)/stats/stats-client.tsx` `IntensityProfileCard`: added Y-axis with hourly labels; computes `maxTotal` across all months, derives `yMax` rounded to 2h/5h increments; bars now scale to actual hours; month labels shown below columns
- `app/(dashboard)/stats/stats-client.tsx` `ZoneCalibrationButton`: HR zone method selector added — three modes: "Auto (statistical + race PBs)", "% of max HR", "AI-assisted"; `% of max HR` shows LT1% and LT2% number inputs (defaults 83/89); calls `/api/coach/calibrate?mode=pct&lt1Pct=83&lt2Pct=89`
- `app/api/coach/calibrate/route.ts`: new `pct` mode — builds zones from explicit % of maxHR; validates `lt1Pct < lt2Pct`; overrides LT boundaries in cache; returns same shape as other modes
- `lib/fitness/critical-speed.ts`: added optional `racePBs?: Array<{ distanceM: number; timeSec: number }>` parameter; merges both sources via a Map, race PBs override activity best-efforts for the same distance
- `lib/fitness/cache.ts`: Critical Speed call now passes `racePBs` from DB; decoupling query now fetches `weatherTemp` and `startDate`; `statisticalMax` percentile raised 70th → 80th
- `lib/fitness/decoupling.ts`: CV threshold tightened 0.20 → 0.10; temperature filter — skip runs >28°C, weight 22–28°C at 0.4x, 18–22°C at 0.7x; always skip first split (warm-up); requires ≥ 4 splits after skip; HR range tightened 0.55–0.95 → 0.58–0.90 maxHR; weighted median per bucket; requires ≥ 3 buckets
- `lib/fitness/zones.ts`: `MAXHR_ARTIFACT_CAP` raised 190 → 205 bpm; `estimateMaxHR` percentile 85th → 90th; `estimateMaxHRFromRaces` percentile 80th → 90th, minimum HR filter 140 → 150 bpm; `estimateMaxHRFromThreshold` divisor 0.88 → 0.89 (threshold ≈ 89% of max for trained runners)

**Correct pace zone bucketing behavior (post-fix):**
Pace zones are stored as `[slow_boundary, fast_boundary]` in sec/km (e.g., easy = [463, 368]).
The cascade checks against the *fast* (lower sec/km) boundary: if `pace >= easy[1]` then it's easy (or slower than easy). Checking `[0]` was the bug — it required pace > 7:43/km to be classified easy, missing all 6:08–7:43/km easy training.

**VO2max weighted model configuration (as of 2026-05-26):**
| Model | With TSB+HR signals | No current signals |
|---|---|---|
| VDOT race PBs | 0.28 × age-decay (floor ~0.10) | 0.45 × age-decay (floor ~0.16) |
| TSB-adjusted VDOT | 0.25 | — |
| HR-form signal | 0.20 | — |
| Volume-Adjusted Riegel | 0.12 | 0.18 |
| Critical Speed | 0.05 | 0.08 |
| Uth-Sørensen | 0.05 | 0.12 |
| Decay bridge | 0.01 | 0.05 |
Age-decay: ≤90d → factor 1.0, 540+d → factor 0.35, linear between. All weights renormalized over available models.
Note: breakdown key renamed from "Volume-adj. Riegel" → "Volume-Adjusted Riegel" (2026-05-29) to match page.tsx explicit entry and avoid a duplicate model selector button.

**Session 2026-05-29 (zone estimator overhaul + bug fixes):**

**Statistical zone estimator — root cause fixes (zones.ts, cache.ts, page.tsx):**
- `zones.ts` `estimateZonesFromStatisticalAnalysis`: removed `zoneProximity` weight (`hrFrac 0.62–0.85 → 1.5, else 0.75`) — was applied inside weighted P80 computation and systematically pulled all bucket HR values down by 10–20 bpm, causing LT1/LT2 to be proportionally too low. This was the primary bug.
- `zones.ts`: changed bucket P80 from cumulative-weighted to count-based (`sortedHR[floor(n×0.80)]`) — weighted P80 produced a different percentile than intended when weights vary.
- `zones.ts`: replaced sequential 2-segment LS + D-max LT1 with **joint 3-segment LS** — double loop finds globally optimal (bp1, bp2) simultaneously; bp1 is LT2, bp2 is the upper anchor. More robust, no D-max instability.
- `zones.ts`: LT1 now derived via **VT1/VT2 pace ratio = 0.844** (PMC12845794, n=1411) — lt1Pace = lt2Pace / 0.844, lt1HR interpolated linearly from bucket array. Replaces D-max which was noisy on small datasets.
- `zones.ts`: Z2 width formula fixed from `max(4, round((lt2-lt1)×0.12))` → `max(8, round(lt1HR×0.07))`, matching `buildHRZonesFromLT`.
- `zones.ts` `estimateLTFromRaces`: removed HR-pace regression parameter; LT2 = `round(maxHR×0.88)`, LT1 = `round(maxHR×0.83)`. Regression was extrapolating to unrealistic HR values (LT2 ≈ 97% maxHR).
- `cache.ts` `updateVO2maxAndPaces`: removed cooldown filter (`isHardActivity = actMaxHR > maxHR×0.87`) from `statLapRuns` — was excluding easy laps from hard-day activities, exactly the data most informative for LT1.
- `cache.ts` `updateHRZones`: same cooldown filter removal from `statLapRunsZones`; added `statLapOnlyResult` computation; now writes both `statZonesJson` and `statZonesLapsJson` to cache upsert (was missing).
- `page.tsx` slow path: removed identical cooldown filter from `statLapRuns` (was still present after cache.ts fix; triggers when cache > 1h stale).

**Result:** Statistical estimator now gives LT1=151, LT2=162, R²=0.99–1.00 (12–13 buckets) — physiologically expected values (LT2 ≈ 88% maxHR for trained runners; the match validates the estimator, it is not a formula output).

**UI — StatisticalZonesCard:**
- Removed Combined/Laps toggle — card now displays only lap-split statistical result (laps-only gives higher precision than activity-level combined data).
- Renamed card from "Statistisk zonanalys — HR vs tempo" → "Statistisk tröskelestimering".
- Removed `statZones` (combined) from Props interface, renderStats signature, and StatsClient props. Cache still writes `statZonesJson` for calibration use.
- Fixed display bug: pace showed "4:36/km/km (GAP)" — `secPerKmToPaceStr` already includes `/km`, so the suffix was doubled.

**Bug fixes:**
- `lib/fitness/vo2max.ts`: renamed breakdown key from `"Volume-adj. Riegel"` → `"Volume-Adjusted Riegel"` to match the explicit entry added in page.tsx. Previously two different keys produced two separate model selector buttons.
- `app/api/races/activities-near/route.ts`: changed `contains` → `startsWith` for all WU/CD/warm/cool/uppvärmning/nedvarvning filters. `contains: "CD"` was falsely excluding "5k TT vs. Elias + CD!" — an activity whose name ends with a reference to its cool-down section, not a dedicated cool-down activity.

**Docs / cleanup:**
- `docs/planning/statistical-zone-estimator.md`: concise write-up of how the estimator works, how it differs from % of maxHR, and the five bugs that were fixed (archived after merge into IMPLEMENTATION_PLAN).
- `docs/planning/zone-estimator-overhaul.md` archived to `docs/planning/archive/`.
- `docs/planning/IDEAS.md` archived (superseded by NOTES.md + IMPLEMENTATION_PLAN.md section 12).

### Documentation Written
- `docs/api/auth.md` — auth + settings endpoints
- `docs/api/strava.md` — sync + webhook endpoints
- `docs/api/planner.md` — workouts, templates, sports CRUD
- `docs/api/coach.md` — streaming chat, context strategy, plan-action spec
- `docs/api/races.md` — race records CRUD
- `docs/api/activities.md` — activity analyze streaming endpoint + backfill-weather
- `docs/schemas/ai-context.md` — full spec of what gets sent to AI
- `TESTING_GUIDE.md` — step-by-step local setup and feature testing checklist

### Test Data
- `scripts/import-training-plan.ts` — imports Swedish CSV training plan (weeks 43/2025–19/2026)

---

## 11. Documentation Standards

### Principle
All documentation is a **source-of-truth document** — not supplementary commentary, but the authoritative reference for how the system behaves. If the code and the docs disagree, the docs are wrong and must be updated immediately.

### Documentation Folder
```
docs/
├── api/
│   ├── strava-sync.md        # Strava API I/O, rate limits, data shapes
│   ├── ai-chat.md            # AI chat endpoint I/O, streaming format
│   ├── planner.md            # Planner CRUD endpoints
│   └── races.md              # Race/PB tracker endpoints
├── schemas/
│   ├── activity.md           # Activity object full field reference
│   ├── workout.md            # PlannedWorkout + Template schemas
│   └── ai-context.md        # AI context object structure
├── integrations/
│   ├── strava.md             # OAuth flow, webhook setup, token refresh
│   ├── claude.md             # Claude API usage, caching strategy
│   └── gemini.md             # Gemini API usage, free tier limits
└── deployment.md             # Server setup, Apache config, PM2, env vars
```

### I/O Documentation Format

Every internal API endpoint and cross-module function that crosses a boundary (HTTP, DB, external API) must have an I/O doc. Format:

```markdown
## POST /api/strava/sync

**Purpose:** Trigger incremental activity sync from Strava.

**Request:**
\`\`\`json
{
  "since": "2024-01-01T00:00:00Z"   // optional, ISO8601 — defaults to lastSyncAt
}
\`\`\`

**Response (success):**
\`\`\`json
{
  "synced": 42,
  "skipped": 3,
  "errors": [],
  "lastSyncAt": "2025-05-19T06:00:00Z"
}
\`\`\`

**Response (error):**
\`\`\`json
{
  "error": "strava_token_expired",
  "message": "Re-authentication required"
}
\`\`\`

**Side effects:** Updates `StravaAccount.lastSyncAt`. Writes new `Activity` rows.
**Rate limits:** Respects Strava 200 req/15min. Backs off automatically.
```

### Rules

1. **I/O must be documented before implementation** — write the I/O doc first, then build to it. This prevents interface drift.
2. **No breaking I/O changes without updating docs** — treat the doc as a contract.
3. **Enums and union types are exhaustively listed** — never "see code for values".
4. **Error codes are named constants** — documented in the relevant schema file, never magic strings.
5. **External API responses are documented as received** — if Strava adds a field we use, document it in `docs/integrations/strava.md`, not just the code.
6. **AI context object is fully specified in `docs/schemas/ai-context.md`** — any change to what gets sent to the AI must be reflected there to avoid prompt engineering regressions.

---

## 12. Open Questions / Future Ideas

- **Garmin / Polar integration** — alternative to Strava for raw data
- **Strava webhook activation** — implemented; needs `STRAVA_WEBHOOK_VERIFY_TOKEN` env var + registration via Strava API once deployed to public domain
- **Export** — PDF training report, CSV data export
- **Notifications** — daily training summary email, recovery alerts
- **Mobile** — PWA wrapper or React Native in future; viewport meta tag added, further responsive audit deferred
- **Multi-user** — just enable registration + add user isolation middleware
- **Drag-and-drop planner** — template library → calendar day (using @dnd-kit, deferred)
- **Activity → Planned workout auto-matching** — deferred

---

*Last updated: 2026-05-29 (zone estimator overhaul: zoneProximity fix, joint 3-segment LS, VT1/VT2 LT1, laps-only UI, duplicate model button fix, CD filter false positive fix)*
