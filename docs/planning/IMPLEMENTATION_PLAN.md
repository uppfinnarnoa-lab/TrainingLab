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
  isRunningRelated Boolean @default(false) // counts toward weekly running-distance projection (WeekSummaryStrip + planner page weekly-activity query)
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
  defaultZone Int?     // 1-5, overrides typeToZone() name heuristic in WorkoutBuilder when set
  sport      SportCategory @relation(fields: [sportId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
  templates  WorkoutTemplate[]
  planned    PlannedWorkout[]
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
  typeId          String?   // own type override, independent of template.typeId — required for templateless workouts and per-instance overrides
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
  type            WorkoutType?     @relation(fields: [typeId], references: [id])
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
- [x] `/api/sports` — GET (all sports + types), POST (create sport or type), PATCH (update workout type name/color/order/defaultZone)
- [x] Sport/Type management settings page (`/settings/sports`) — edit type name/color/order/default zone, mark sports as running-related
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

**Completed in 2026-06-16d:**
- [x] Touch drag-and-drop for workout pills (pill → different day cell) — dnd-kit PointerSensor + TouchSensor alongside existing HTML5 DnD
- [x] Inline week detail panel — click week summary strip to expand a bottom-sheet/inline stats panel
- [x] Taper start marker in calendar — shows ⚡ on the day taper should begin (computed from future Race workouts)

**Notes from implementation:**
- Template library uses click-to-add for mobile (placement mode), native HTML5 DnD for desktop templates
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

**Session 2026-05-31 (zone estimator Config K + D — universal athlete support):**

**Config K — Weighted P80 + slope-based LT2 detection:**
- `zones.ts` `estimateZonesFromStatisticalAnalysis`: replaced count-based P80 with **weighted P80** — accumulates recency × race-boost weight until 80% covered. Race laps (3× boost) drive P80 up at fast-pace buckets, preventing spurious PAV inversions that shifted LT2 by 20–30 sec/km. Fixes systematic mis-placement of LT2 at 4:15 instead of 3:52.
- `zones.ts`: replaced joint 3-segment exhaustive search with **slope-based LT2 detection** — scan from fastest bucket, first HR-pace slope exceeding 20% of curve's max slope = LT2. Dimensionless ratio (no HR values referenced). More reliable than exhaustive search across varied bucket counts.
- `zones.ts`: **effective-weight bucket threshold** `MIN_EFF_WEIGHT=8` replaces count ≥ N — 3 recent race laps (weight ≈ 9) qualify; 12 stale laps from 18 months ago (weight ≈ 2.4) do not.
- `zones.ts`: regression segment weights changed to `1/sqrt(count)` per bucket — sparse fast-pace (threshold) buckets get proportionally more regression influence than the dense easy-run region.

**Config D — Data-driven filters (universally applicable to any athlete):**
- `zones.ts`: removed **gap upper bound** (391 s/km = 6:31/km) from first-pass filter — sparse slow-pace buckets are naturally eliminated by MIN_EFF_WEIGHT=8, so no hardcoded upper limit is needed.
- `zones.ts`: compute **pace percentiles P60 and P85** from all raw valid points before the weight threshold. LT2 sanity: must be faster than P60 of training laps; LT1: must be faster than P85. Replaces hardcoded absolute ranges (LT1: 240–380 s/km, LT2: 200–420 s/km) that failed for elite or slow runners.
- `cache.ts` `updateHRZones`: **bootstrapped OL race pace threshold** — Phase 1 runs zone estimator with name-only OL filter to get preliminary LT1; Phase 2 threshold = `round(LT1 × 1.15)`. Replaces hardcoded 330 s/km (5:30/km). Produces ≈5:17/km for reference athlete; correctly scales for any fitness level.

**Validated results (maxHR=184):** LT1=151–153 bpm, LT2=162–163 bpm, R²=0.99 across 2025/2026/LIVE windows. Config D gives identical results while being universally applicable.

**Docs / cleanup:**
- `docs/fitness/hr-zone-statistical-estimation.md`: updated to reflect Config D; Known Limitations section replaced with data-driven implementation notes.
- `docs/planning/config-k-production-plan.md` and `config-d-data-driven-plan.md`: archived to `docs/planning/archive/`.
- New: `docs/guides/year-estimate-test.md` — documentation for standalone test script.
- New: `docs/planning/bug-audit-2026-05-31.md` — bug audit with 6 bugs + 3 feature change notes awaiting approval.
- `docs/planning/zone-estimator-overhaul.md` archived to `docs/planning/archive/`.
- `docs/planning/IDEAS.md` archived (superseded by NOTES.md + IMPLEMENTATION_PLAN.md section 12).

**Session 2026-06-01b — Volume Explorer (`/stats/volume`):**

**Feature:** Dedicated page for exploring and comparing training volume. Accessible by clicking the "3-year monthly volume overlay" card title on the Stats/Volume tab.

**Route:** `app/(dashboard)/stats/volume/page.tsx` (server) + `app/(dashboard)/stats/volume/volume-client.tsx` (client).

**Data:** Server component queries all activities (sportType, distance, movingTime, startDate — no large fields) and aggregates to `VolumeRecord[]` (`{ year, month, sport, km, timeSec }`). Covers full history (not capped at 3 years like the stats overview card).

**Four view modes (tabs):**
1. **Year comparison** — grouped monthly bar chart, multi-year selection, month-range filter (e.g., OL season Apr–Oct). Shows YoY delta labels ("+12%") above bars. Summary cards: total, avg/month, best month per year. Average-volume reference line.
2. **Cumulative YTD** — line chart, accumulated km/hours from Jan 1 through each month. Null for future months in the current year. Best for "am I ahead of last year?" comparison. Automatic dotted reference line for same date last year.
3. **Sport breakdown** — stacked bar chart for a single year, sport color-coded. Pie-like summary table showing % per sport for the selected period.
4. **Period comparison** — define two custom date ranges (YYYY-MM to YYYY-MM) and compare them side by side. Periods can span different months of different years (e.g., "OL season 2024" Apr–Oct vs "OL season 2025" Apr–Oct).

**Cross-cutting controls:** metric toggle (km / hours), sport filter (multi-select chips), month range (From/To selects for modes 1, 3, 4). Navigation: "← Stats" back link.

**Navigation hook:** `MonthlyOverlayCard` title in `stats-client.tsx` becomes a `Link` to `/stats/volume`.

**Session 2026-06-01 (LT trend stabilization + temperature stats + map fix + volume toggles):**

**LT/AT pace trend — ALL HL-auto algorithm:**
- `lib/fitness/zones.ts`: **bp1 slope search starts at `i=1`** (previously `i=0`) — prevents LT2 being placed at the fastest bucket when slopeMax is at the LT1 inflection, which caused a false LT2 at race pace and downstream HR gap check failure or wrong placement.
- `lib/fitness/zones.ts`: **HR gap threshold lowered 8 → 5 bpm** — the 8 bpm threshold rejected valid estimates during post-OL season (Aug–Oct) when training distribution is compressed and HR spread is 5–7 bpm. 5 bpm at 84%/81% maxHR is physiologically distinct.
- `lib/fitness/cache.ts`: **per-window OL bootstrap** — replaced global 90-day window + global OL threshold with per-window computation. Each of the 30 monthly windows now: (1) runs estimator on all acts up to `windowEnd` with name-only OL filter to get historical LT1; (2) derives OL threshold as `round(LT1 × 1.15)`; (3) runs final estimator on all filtered laps up to `windowEnd` (no lower bound). Equivalent to running LIVE calibration from a historical point in time. Fixes: global threshold (5:17/km) incorrectly excluded spring 2025 OL races (5:30–6:00/km, appropriate for that era's fitness).
- `lib/fitness/cache.ts`: **`smoothLTTrend()`** — two-pass post-processing: Pass 1 removes isolated single-month spikes (±15s from both neighbors via linear interpolation); Pass 2 caps improvement at 20s/month (physiological rate limit). Only applied between consecutive months (gap = 1 month), not across data gaps.
- DB: `ltPaceTrend` cleared from `FitnessCache` to force full recompute with new algorithm.
- **Expected result:** 18/18 months populated (2025-01 through 2026-06), smooth seasonal curve, no Feb 2026 outlier.

**Temperature statistics improvements:**
- `app/(dashboard)/stats/page.tsx` `computeWeatherStats()`: split `> 20°C` band → `20–25°C` + `> 25°C` for heat granularity above the inflection point.
- Added **precipitation bands** (`Dry < 0.5mm`, `Light 0.5–2mm`, `Rain > 2mm`) — controlled for 0–25°C to avoid cold/rain conflation. Requires `weatherPrecip` field in query select.
- Added **HR-normalized pace by temperature** (`hrNormByTemp`) — filters runs where `avgHR ∈ [70%, 80%] maxHR`, groups by temperature band. Effort-controlled, no fitness drift correction needed. Requires `maxHR` parameter passed to `computeWeatherStats`.
- Added **cold sensitivity** (`coldSensitivity`) — OLS regression on cold runs (< 10°C), reports sec/km penalty per 5°C below 5°C baseline. Requires ≥ 8 data points.
- **`tempSensitivity` always-null bug in fast path fixed** — moved computation to use `weatherActs` (always fetched fresh) before the fast/slow path split. Both paths now receive the value. Previously the fast path (which handles ~99% of page loads) always showed null.
- `WeatherStats` interface: added `byPrecip`, `hrNormByTemp`, `coldSensitivity`.
- `app/(dashboard)/stats/stats-client.tsx` `WeatherProfileCard`: added precipitation section, HR-normalized section, cold sensitivity chip.

**Activity map — double init fix:**
- `app/(dashboard)/activities/[id]/activity-map.tsx`: added `aborted` boolean flag set to `true` in cleanup, checked before creating the Leaflet map in the async import callback. Root cause: React 18 Strict Mode fires effects twice (mount → cleanup → mount); cleanup set `map = null` but the async import from the first mount had not yet resolved, so when it did, `container.isConnected` was still true and a second Leaflet map was created in the same container, producing split tile fragments.

**Easy pace trend — full 5-year history:**
- `lib/fitness/cache.ts`: `easyPaceTrend` now computed during sync (all 5 years of activities, not 2-year rolling window) and stored in `extraVizJson`.
- `app/(dashboard)/stats/page.tsx` fast path: reads `easyPaceTrend` from `extraVizJson` (full history) instead of computing from `recentForCurve` (capped at 730 days). Falls back to `recentForCurve` if cache pre-dates this change.
- `app/(dashboard)/stats/page.tsx` slow path: includes `easyPaceTrend` in the `extraVizJson` cache save.

**Volume section — global toggles:**
- `app/(dashboard)/stats/stats-client.tsx`: sport filter and km/time toggle moved to top of Volume section (outside any card) so they control all charts in the section.
- `MonthlyOverlayCard`: accepts `mode` and `sportFilter` props; respects volumeMode (bars scale to hours or km) and sport filter (via `bySport` breakdown per entry).
- `ActivityHeatmapCard`: accepts `mode` prop; shows weekly hours or weekly km; tooltip shows formatted time or km accordingly.
- `monthlyOverlay` data structure extended: added `timeSec` (total time) and `bySport: Record<string, { km, timeSec }>` per monthly entry. Updated in both `cache.ts` and `page.tsx` slow path.
- `heatmapData` structure extended: added `timeSec` per weekly entry. Updated in both `cache.ts` and `page.tsx` slow path.

**Archived plans:**
- `docs/planning/lt-trend-window-stabilization-plan.md` → `docs/planning/archive/` (status: Implemented 2026-06-01).

**Session 2026-06-06 — Bug fixes: activity map tiles + planner rolling-week separator line + resize handle:**

- `app/(dashboard)/activities/[id]/activity-map.tsx`: Map tiles loaded in fragments (2×2 quadrant pattern) because `fitBounds()` was called immediately on Leaflet init when the container may not yet have its final CSS-laid-out width. `invalidateSize()` was correcting the container size but keeping the wrong center/zoom from the bad `fitBounds`. Fixed by: (1) storing `bounds = line.getBounds()` at creation, (2) re-calling both `invalidateSize()` AND `fitBounds(bounds)` in the first 3 stabilization callbacks (refitsLeft counter exhausts after 3), then invalidateSize-only thereafter. Intervals extended to 100 / 500 / 1500ms to cover slow production page loads. ResizeObserver unchanged.
- `components/planner/PlannerCalendar.tsx`: Rolling-mode week-separator lines (the `h-px bg-border` line in each rolling-week label row) were rendered as a flex sibling **outside** the grid row, so they only spanned the scroll container's visible width (~viewport minus sidebar) instead of the full grid width (120 + 7×140 = 1100px+). Fixed by moving the entire label + line block **inside** the grid div as the first child, with `gridColumn: "1 / -1"` so it auto-spans all columns. The outer `space-y-1` wrapper is replaced by a plain `<div>` (spacing preserved via `pt-1`/`pb-0.5` on the label div).

**Session 2026-06-06 — Template library sidebar: draggable resize handle:**

- `components/planner/TemplateLibrary.tsx`: Added draggable resize handle on the right edge of the desktop sidebar. A 12px drag zone is centered on the sidebar-calendar border (via `right: -6px`) so the resize cursor is discoverable from either side of the dividing line. Dragging sets sidebar width freely between 160–480px; current width persisted to `localStorage` key `planner_lib_width` on mouse-up. Touch resize also supported via `onTouchStart`. Visual indicator: a 2px line centered on the border, always visible, brightens to accent color on hover. `startX` and `startWidth` stored as refs so drag logic survives React re-renders. Collapse/expand toggle and mobile overlay are unchanged.

**Session 2026-06-06 — Color theme: Sky → Sand (warm neutral + violet):**

- `app/globals.css`: Replaced **Sky** theme entirely with **Sand** — warm-neutral backgrounds (stone-50 `#FAFAF8` light bg, `#F2F1EC` surface), violet-700 accent (`#7C3AED`) in light mode; zinc-900 dark bg (`#18181B`), violet-400 accent (`#A78BFA`) in dark mode. All contrast ratios exceed WCAG AA; primary text exceeds AAA (18.4:1 light, stone-600 muted 7.3:1 AAA for outdoor readability). Warm neutral chosen over cold blue to reduce eye strain and avoid similarity with existing Ocean theme. Violet accent maximally distinct from all 5 other themes.
- `app/(dashboard)/settings/appearance-settings.tsx`: Updated Sand scheme dot color to violet (`#7C3AED` light / `#A78BFA` dark) in the scheme picker.

**Session 2026-06-06 — Planner/sports features, themes, collapsible sidebar:**

- `components/planner/TemplateLibrary.tsx`: Desktop sidebar now collapsible — `PanelLeftClose` button in header collapses to a 40px strip showing template count + expand icon (`LayoutTemplate`). State persisted in `localStorage` key `planner_lib_collapsed`. Mobile overlay unchanged.
- `app/api/planner/backfill-sections/route.ts` (new): POST endpoint that creates a default single WorkoutSection on every template with 0 sections. Section uses `estimatedDuration`/`estimatedDistance` + zone derived from type name (Race/Speedwork→Z5, LT→Z4, AT/Tempo→Z3, Easy→Z2, else Z1). Called automatically on planner mount (flag `planner_sections_backfilled_v1` in localStorage prevents re-runs).
- `app/api/sports/route.ts`: When `kind="sport"`, automatically creates a `Race` WorkoutType (color `#FBBF24`) for the new sport. Returns sport with `workoutTypes` included.
- `components/planner/WorkoutBuilder.tsx`: Full rework of sport/type selection UI. Replaced plain selects with expandable inline panels: "Add type to [Sport]" (name + 16-color palette + colors-in-use table) and "Add sport" (name + color + note that Race is added automatically). `onSportsUpdated?: (sports) => void` callback propagates new sports/types to parent. `localSports` state allows immediate use of newly created sports/types without page reload. `ColorSwatches` + `ColorUsageTable` sub-components.
- `app/(dashboard)/planner/planner-client.tsx`: Added `const [sports, setSports] = useState(props.sports)` — local mutable sports state. All three WorkoutBuilder instances receive `sports` (not `props.sports`) and `onSportsUpdated={setSports}`. Auto-backfill runs on mount.
- `lib/planner/colors.ts`: Orienteering regex extended to `orienteer|orientering|ol\b` — fixes Swedish "Orientering" (single e) returning wrong fallback color.
- `app/globals.css`: Added **Sky** color scheme — light blue-tinted backgrounds (`#F0F7FF`), blue-600 accent (`#2563EB`, 5.9:1 on white, WCAG AA). Dark variant: deep navy (`#0B1222`), blue-400 accent (7.1:1). Designed for maximum mobile legibility.
- `components/color-scheme-provider.tsx`: Sky added to `ColorScheme` type + `COLOR_SCHEMES`. Default scheme is now device-responsive: **Sky on mobile** (< 768px), **Slate on desktop** (first visit with no saved preference).
- `app/(dashboard)/settings/appearance-settings.tsx`: Sky added to scheme picker with distinct dot color (`#38BDF8` light / `#93C5FD` dark).

**Session 2026-06-06 — Bug audit fixes (8 bugs) + Orienteering color + Race type:**

Full audit documented in `docs/planning/bug-audit-2026-06-06.md`. All 8 confirmed bugs fixed:

- `components/planner/OutcomeModal.tsx`: `onSave` return type changed to `Promise<boolean>`; modal only closes on `true`; `saveError` state shows inline error on failure. `await` added to `onDelete` call (was missing, closing modal before delete completed).
- `components/planner/BlockEditorModal.tsx`: `onSave` returns `Promise<boolean>`; `handleSave` only calls `onClose()` on success. Added `invalidDateRange` check (`startDate > endDate`) — Save button disabled and inline error shown when invalid. Removed `Math.max(1, ...)` from week count so invalid ranges don't falsely show "1 week".
- `app/(dashboard)/planner/planner-client.tsx`: `handleOutcomeSave` returns `boolean` (no longer calls `setStatusWorkout(null)` on failure). `handleBlockSave` returns `boolean`. `handleBuilderSave` moved `setShowBuilder(false)` to AFTER all fetches complete (was closing builder before fetches). `handleDeleteTemplate` and `handleDeleteWorkout` now call `showError(msg)` on non-OK responses. Added `plannerError` state + auto-dismiss error banner (4 s) for mutation failures. Copy-mode banner text corrected: "click a day to paste (or right-click for options)" on desktop, "tap a day to paste" on mobile.
- `components/planner/WorkoutBuilder.tsx`: Date field label now reads "Date" (not "leave blank to add to library only") in `plannedWorkoutMode`. Added built-in "Race 🏆" type option (synthetic `__race__` id) for all sports — resolves to `typeId: null` + `color: #FBBF24` (yellow) when saved; `effectiveTypeName` ensures `autoColor` is computed correctly.
- `components/planner/WorkoutPill.tsx`: Added `inMoveMode?: boolean` prop — when true, `onClick` does NOT call `stopPropagation()`, letting the day-cell click fire and complete the move.
- `components/planner/PlannerCalendar.tsx`: Passes `inMoveMode={!!moveWorkout}` to WorkoutPill.
- `lib/planner/colors.ts`: Orienteering regex extended from `orienteer|ol\b` to `orienteer|orientering|ol\b` — fixes Swedish sport name "Orientering" (single e) being unrecognized and falling through to the `#7DD3FC` fallback (same as Running). Now correctly returns teal `#14B8A6`.

**Session 2026-06-06 — Mobile UX polish: 6 bug fixes across Volume Explorer, Planner, WorkoutBuilder, sidebar:**

- `app/(dashboard)/stats/volume/volume-client.tsx`: Metric toggle labels capitalized: `"km"→"Km"`, `"time"→"Time"`.
- `components/planner/WorkoutPill.tsx`: Long press now fires `onLongPressMenu(workout, x, y)` (touch coords captured via `touchX/Y` refs) instead of directly copying — parent shows the context menu. Removed `onCopyRequest` prop. Added `select-none` Tailwind class and `e.preventDefault()` on `onContextMenu` to suppress native text-selection overlay and browser context menu during long press.
- `components/planner/PlannerCalendar.tsx`: Long press from `WorkoutPill` wires to `setContextMenu` so the same floating menu appears as on desktop right-click. Added "Move to…" option to the workout context menu — sets `moveWorkout` state. Move mode banner renders above the grid showing workout name with a cancel button. Day-cell click handler checks move mode first: calls `onWorkoutMove(moveWorkout.id, date)` and clears state (tapping any day completes the move). Day cells show `MoveRight` icon in move mode instead of `ClipboardPaste`.
- `components/planner/WorkoutBuilder.tsx`: Main form grid changed from `grid-cols-2` to `grid-cols-1 sm:grid-cols-2`; section editor grid same change. `col-span-2` spans changed to `sm:col-span-2` — single column on mobile so fields no longer overlap on 375px screens.
- `components/planner/TemplateCard.tsx`: Button padding increased `p-1→p-2`, button gap `gap-1→gap-2` (larger touch targets). Added `onPointerDown={e => e.stopPropagation()}` to each action button — prevents the draggable card from intercepting the touch before the button click fires.
- `components/sidebar.tsx`: Mobile sidebar height changed from `h-screen` (= 100vh, includes iOS browser chrome) to `h-[100dvh]` (dynamic viewport height, excludes browser toolbar). Added `min-h-0` to nav element so flex correctly constrains it. Settings link and ThemeToggle at the bottom are now always visible on iOS Safari/Chrome.

**Session 2026-06-06 — Activity map tile loading fix + metric tooltip positioning:**

- `app/(dashboard)/activities/[id]/activity-map.tsx`: The single 200ms `invalidateSize()` call was insufficient in production — CSS/fonts settle slower, causing Leaflet to measure the container too early (small/0 size) and only load 2 tiles for that tiny area. Fixed by: (1) three staggered `setTimeout` calls at 100ms, 400ms, 900ms; (2) a `ResizeObserver` on the container div that calls `invalidateSize()` on any layout shift; (3) `minHeight: 320` on the map div ensures Leaflet always has a non-zero container height at initialization. All timers and the observer are cleaned up in the useEffect return.
- `components/stats/metric-tooltip.tsx`: Tooltip was positioned **below** the info button (r.bottom + 4), causing it to fall directly over chart content in cards like Training Load. Repositioned to **right of the button, vertically centered** (r.right + 8, vertically centered around button midpoint). Falls back to left side if the right side would overflow the viewport. Vertical position is clamped to viewport bounds. The click-away backdrop and hover behaviour are unchanged.

**Session 2026-06-06 — Planner sidebar view: column width, overflow, remove Log? indicator:**

- `components/planner/PlannerCalendar.tsx`: sidebar grid now uses `style={{ gridTemplateColumns: "120px repeat(7, minmax(140px, 1fr))" }}` (inline style, applied to both weekday header row and each week row). Replaces `md:grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr_1fr]` where `1fr` was only ~86px — too narrow to read workout names. Minimum 140px per day = ~1100px total; calendar container has `overflow-auto` so it scrolls horizontally when viewport is narrower. Day cell div gains `overflow-hidden` to clip any pill content that overflows the cell boundary (was causing text to render outside rounded boxes).
- `components/planner/WorkoutPill.tsx`: removed "Log?" / "Logga?" indicator entirely — past unlogged sessions are already visually distinct by status (no badge needed, just adds clutter). Meta row (duration + distance) changed from `flex gap-2` to `flex flex-wrap gap-x-1.5` with `shrink-0` on each item — items wrap to a new line when the cell is narrow instead of overflowing out of the pill.

**Session 2026-06-07 — Workout builder: total time/distance fields + OL color fix:**

- `components/planner/WorkoutBuilder.tsx`: added top-level **Total time (min)** and **Total distance (km)** fields; `totalDurMin` and `totalDistKm` state pre-populated from `editTemplate.estimatedDuration/estimatedDistance`. Added `typeToZone(typeName)` helper that maps type names to zones 1–5 (race/intervals→5, LT→4, AT/tempo→3, easy/base→2, no type→1). Added `makeDefaultSection(duration, distance, zone)` that initializes the first section from these values. When only the default single section exists (`!sectionsCustomized`), changing sport/type/totals auto-syncs zone+duration+distance into that section via `syncDefaultSection()`. `sectionsCustomized` becomes `true` when the user adds/removes a section or when editing a template that already has sections. `BuilderData` now includes `totalDuration: number | null` and `totalDistance: number | null` (computed from sections, falling back to top-level fields for open/empty sections). Field layout: Name → Sport/Type → Total time/Total distance → Date/Notes → Sections.
- `app/(dashboard)/planner/planner-client.tsx`: `handleBuilderSave` and `handleEditBuilderSave` now pass `targetDuration: data.totalDuration` and `targetDistance: data.totalDistance` when creating/patching planned workouts. `handleAddTemplateToDate` now uses `workoutColor(sport.name, type.name)` directly instead of `template.color ?? sport.color` — eliminates stale stored colors propagating to new workouts. Added one-time `fix-ol-colors` useEffect (localStorage flag `planner_ol_colors_fixed_v1`) that clears stale OL colors and refreshes if any were fixed.
- `app/api/planner/fix-ol-colors/route.ts` (new): `POST` endpoint — finds all Orienteering/OL sport names for the user; clears `color` on `PlannedWorkout` rows matching those names where color is wrong (not null, not `#14B8A6`, not race yellow `#FBBF24`); returns `{ workoutsFixed: number }`. Note: `TemplateCard` already recomputes color dynamically — templates don't need fixing.

**Session 2026-06-12 — Planner edit bugs (date/type reset), workout type editor, mobile template fix, running-related sports:**

**Date reset bug (editing a planned workout cleared the date field):**
- Root cause: `POST`/`PATCH /api/planner/workouts(/[id])` returned raw Prisma `Date` objects, which `JSON.stringify` serialises to full ISO timestamps (`"2026-06-15T00:00:00.000Z"`). `<input type="date">` requires exactly `"YYYY-MM-DD"` and renders empty for anything else — and the PATCH route's Zod schema (`/^\d{4}-\d{2}-\d{2}$/`) rejected that same timestamp on the next save, failing the **entire** PATCH (not just the date).
- `app/api/planner/workouts/route.ts`: added `serialiseWorkout()` helper (normalises `date` to `YYYY-MM-DD`); GET and POST responses now run through it.
- `app/api/planner/workouts/[id]/route.ts`: PATCH response now runs through the same `serialiseWorkout()` helper.

**Type reset bug (workout's type sometimes reverted to "No type" after editing):**
- Root cause: `PlannedWorkout` had no own type — type only existed via `template.typeId`. All planner-inserted workouts have `templateId: null`, so any type chosen for a templateless workout was never persisted (always reset to `type: null` when reopened).
- `prisma/schema.prisma`: added `PlannedWorkout.typeId String?` + `type WorkoutType?` relation (pushed via `prisma db push`, applied to prod automatically by `deployment/deploy.sh`).
- `lib/planner/types.ts`: `PlannedWorkout` gains `typeId: string | null` and `type: WorkoutType | null`; `WorkoutType` gains `defaultZone: number | null`; `SportCategory` gains `isRunningRelated: boolean`.
- `app/api/planner/workouts/route.ts` / `[id]/route.ts`: `typeId` accepted on create/update (with ownership check — 404 if the type doesn't belong to the user), `type: true` added to the `include` clause.
- `app/(dashboard)/planner/planner-client.tsx`: `editTemplate` useMemo now builds its `type`/`typeId` from `editWorkout.typeId`/`editWorkout.type` for templateless workouts, and detects a per-instance override when `editWorkout.typeId !== editWorkout.template.typeId`. `typeId` now flows end-to-end through copy/paste (`handleCopyWorkout`/`handlePasteWorkout`), template→date creation (`handleAddTemplateToDate`), and builder save/edit (`handleBuilderSave`/`handleEditBuilderSave`).

**DB data verification (the 30 previously-inserted planned workouts):**
- Confirmed correct: dates are stored as `@db.Date` (midnight UTC) — the expected Prisma representation, not corruption. `templateId: null` is intentional (these are standalone planned workouts, not template instances). The two bugs above were entirely in the API-serialization layer and a missing schema field — no DB data needed fixing. `typeId` is `null` for all 30 (no type was ever selected); this is accurate ("No type") and now persists correctly once a type is picked.

**Workout type editor in Settings (`/settings/sports`):**
- `app/api/sports/route.ts`: new `PATCH` handler — `{ kind: "type", id, name?, color?, order?, defaultZone? }`, ownership-checked, updates `WorkoutType`. `sportSchema` (POST sport) gains `isRunningRelated: z.boolean().optional()`.
- `app/(dashboard)/settings/sports/page.tsx`: passes `isRunningRelated`, and per-type `order`/`defaultZone`, through to `SportsManager`.
- `app/(dashboard)/settings/sports/sports-manager.tsx`: workout types are now rows (was a pill list) with: order up/down arrows (`moveType` — renumbers the whole sport's type list sequentially 0..n on every move, since existing types mostly share `order: 0`), a color dot that toggles an inline swatch picker (`updateType` PATCHes `/api/sports`), an editable name `<input>` (save on blur), and a "default zone" `<select>` (Auto / Z1–Z5 → `WorkoutType.defaultZone`). "Add new sport" form gained a "Related to running" checkbox (`isRunningRelated`).

**Mobile "+" on a template opened the template editor instead of adding to the selected date:**
- Root cause: `handleMobileTemplateSelect` opened the builder with `editTemplate={mobileTemplatePrefill}`, making `isEditing = true` — same header/footer/behaviour as actually editing the template.
- `components/planner/WorkoutBuilder.tsx`: new `forceCreateMode?: boolean` prop decouples `isEditing` from `!!editTemplate`. When `forceCreateMode` is true, the builder pre-fills from `editTemplate` but shows "Build workout" / "Add to plan" (create-mode UI, no "save as template" option).
- `app/(dashboard)/planner/planner-client.tsx`: passes `forceCreateMode={!!mobileTemplatePrefill}` to the create-new builder instance. `handleBuilderSave` now sets `templateId = mobileTemplatePrefill?.id ?? null` so the resulting planned workout keeps its link back to the source template (previously lost).
- **Superseded 2026-06-13**: this whole `mobileTemplatePrefill`/`forceCreateMode` approach (open the builder pre-filled) was replaced by a calendar placement mode — tap a template, then tap the destination day directly, no form shown. See Session 2026-06-13.

**Weekly running-km projection now includes all running-related sports:**
- `prisma/schema.prisma`: `SportCategory.isRunningRelated Boolean @default(false)`.
- `lib/planner/sportTypeMap.ts` (new): `STRAVA_SPORT_MAP` — shared `Activity.sportType` → `SportCategory.name` map (Run/VirtualRun/TrailRun → Running, Ride/VirtualRide/EBikeRide → Cycling, NordicSki/BackcountrySki → Skiing, RollerSki → Roller Skiing, WeightTraining/Workout → Strength). Used by both `normalizeSportType` (planner-client) and the server-side weekly-activity query.
- `components/planner/WeekSummaryStrip.tsx`: predicted weekly-km calculation now matches workouts whose `sportType` is in `{ sports where isRunningRelated }`, replacing the old `/run|trail|virtual/i` regex (which missed sports like Orienteering).
- `app/(dashboard)/planner/page.tsx`: `sports` is now fetched before the main `Promise.all` (its `isRunningRelated` flags drive the activity query); `weekActivities` query's `sportType` filter is now `Array.from(runningActivityTypes)` (derived from `STRAVA_SPORT_MAP` reverse-lookup + running-related sport names) instead of the hardcoded `["Run","TrailRun","VirtualRun"]`.
- `components/planner/WorkoutBuilder.tsx`: "Add new sport" panel gained the same "Related to running" checkbox, posted as `isRunningRelated`.
- Data backfill: `Running` and `Orienteering` marked `isRunningRelated: true` for the existing user via `/api/planner/backfill-running-sports` (idempotent `POST`, ownership-checked), triggered automatically on next `/planner` page load via a `planner_running_sports_backfilled_v1` localStorage-gated `useEffect` — runs identically in production, no manual DB step needed.

**Default workout-type zone (`defaultZone`) wiring:**
- `prisma/schema.prisma`: `WorkoutType.defaultZone Int?` (1–5).
- `components/planner/WorkoutBuilder.tsx`: initial section and `syncDefaultSection()` now use `type?.defaultZone ?? typeToZone(typeName)` — `defaultZone` (set in Settings) overrides the name-based heuristic when present.

**Session 2026-06-12b — Fix: non-admin users saw only a collapsed "Connected" Strava card:**
- Bug: for non-admin users whose Strava account was connected, the Settings page showed only the outer integration card with a "Connected" badge — none of Step 3's content (sync button, historical/weather backfill, auto-sync mode picker, webhook controls) rendered.
- Root cause: `app/(dashboard)/settings/strava-connect.tsx` gated the entire Step 3 block (including the already-connected management UI) on `(isAdmin ? credentialsSet : hasClientId)`. For a connected non-admin user this credentials-availability check is both redundant (OAuth already succeeded) and could evaluate falsy depending on the `getCredentials()` fallback-chain result for that user, hiding all of Step 3.
- Fix: gating condition is now `((isAdmin ? credentialsSet : hasClientId) || connected)` — an already-connected account always shows its management UI regardless of the credentials check; the credentials check still controls whether the pre-connection "Connect with Strava" link is shown.
- No DB/schema change required — pure client-component conditional-rendering fix, picked up automatically by the next `deployment/deploy.sh` run.

**Session 2026-06-13 — Settings restructured into tabs, template placement mode, mobile pass on BlockEditorModal/Training Types, future-week running km:**

**Settings restructured into tabbed sub-pages (`/settings` had become a dumping ground; `/settings/sports` — the workout-type editor from 2026-06-12 — had zero inbound links and was unreachable):**
- New `components/settings/settings-nav.tsx`: client component, tab bar — Integrations (`/settings`), Profile (`/settings/profile`), Training Types (`/settings/sports`), Account (`/settings/account`). Highlights the active tab via `usePathname()`.
- New `app/(dashboard)/settings/layout.tsx`: shared layout — renders the "Settings" heading + `<SettingsNav>` once, wraps all tab pages.
- `app/(dashboard)/settings/page.tsx` rewritten: now only the **Integrations** tab — Strava, Garmin, AI Coach cards (`IntegrationCard` helper retained locally). Removed the profile/appearance/password/account/admin sections and the page's own heading (now in the shared layout).
- New `app/(dashboard)/settings/profile/page.tsx`: **Profile** tab — Athlete Profile form, Appearance settings, Change password (moved verbatim from the old `/settings/page.tsx`).
- New `app/(dashboard)/settings/account/page.tsx`: **Account** tab — Users admin section (admins only) + Account actions (moved verbatim).
- `app/(dashboard)/settings/sports/page.tsx`: restyled its outer wrapper from a standalone page (`<h1>` + max-w-2xl div) to a card section (`<section className="rounded-2xl bg-surface border ...">` with `<h2>`) matching the other tabs — this is now the **Training Types** tab, making the 2026-06-12 type/zone/color/order editor reachable from Settings.
- No schema or route changes; all `/settings` links (dashboard, sidebar, coach chat) continue to point at the Integrations tab unchanged.

**"Save as reusable template" now defaults off:**
- `components/planner/WorkoutBuilder.tsx`: `saveAsTemplate` initial state changed from `!isEditing && !initialDate` (on by default when creating a workout with no date) to always `false`. User opts in explicitly every time.

**Mobile template placement mode (replaces the 2026-06-12 `forceCreateMode` approach):**
- `app/(dashboard)/planner/planner-client.tsx`: removed `mobileTemplatePrefill`/`forceCreateMode` state entirely. New `placingTemplate: WorkoutTemplate | null` state + `handlePlaceTemplate(date)`. `handleMobileTemplateSelect` now just closes the mobile template-library overlay and sets `placingTemplate` — no builder is opened. `handlePlaceTemplate` calls the existing `handleAddTemplateToDate(placingTemplate.id, date)` directly, creating the planned workout with `templateId` set and no form shown.
- `components/planner/PlannerCalendar.tsx`: new props `placingTemplate`, `onPlaceTemplate`, `onCancelPlaceTemplate`. New banner (reusing the existing "move mode" visual pattern): `Placing "<name>" — tap a day to add it here`, with a cancel (×) button. Day-cell click handler and highlight styling extended with an `isPlaceMode` branch (checked before move/paste modes); day-number row shows a `+` icon while placing.
- `components/planner/WorkoutBuilder.tsx`: removed the now-dead `forceCreateMode` prop and its branch in the footer button label.

**Future weeks now show total running distance alongside total time in `WeekSummaryStrip.tsx`:**
- `runningSportNames` (sports where `isRunningRelated`) is now computed once for all weeks, not just the current week.
- New `plannedRunKm`: for weeks starting after today, sums `targetDistance` (→ km) across all planned workouts whose sport is running-related.
- `displayRunKm = predictedRunKm ?? plannedRunKm` — current week keeps showing the blended actual+planned prediction; future weeks show the pure planned total. Tooltip text (`runKmTitle`) switches between "Predicted weekly run distance" and "Planned running distance this week" accordingly. Both compact (sidebar) and row render modes updated.

**Mobile pass — `BlockEditorModal.tsx` (training-block builder, primary target of this session's mobile review):**
- Block-type picker (6 buttons): `grid-cols-5` → `grid-cols-3 sm:grid-cols-5` (was cramped to 5 narrow columns on phones).
- Start/end date inputs: `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` (stacks on phones, matching the existing WorkoutBuilder date-field pattern).
- Footer: `flex items-center gap-2` → `flex flex-wrap items-center gap-2`; the delete-confirmation button pair gets `w-full sm:w-auto` so "Cancel/Confirm deletion" wraps onto its own row instead of squeezing in alongside the main Cancel/Save buttons.

**Mobile pass — `app/(dashboard)/settings/sports/sports-manager.tsx` (Training Types tab, newly reachable this session):**
- Sport header row: sport name gets `min-w-0 truncate` (was unbounded, could push the "Running"/type-count/delete/chevron controls off narrow screens); "Running" badge gets `shrink-0`; the "N types" count label is hidden below `sm:` (least essential info, freed up space for the badge + action icons).
- "Color:" row for a new workout type's color: added `flex-wrap` so the 10 swatches + preview wrap onto a second line instead of overflowing on narrow screens.
- "Add new sport" row: `flex gap-3 items-end` → `flex flex-col sm:flex-row gap-3 sm:items-end`, and its fixed `w-40` color-swatch box → `w-full sm:w-40` — stacks the name input above the color swatches on mobile instead of squeezing both into one row.

**Reviewed, no changes needed:** `OutcomeModal.tsx` (already mobile-friendly — stacked full-width buttons, sensible grid). `ZoneBar.tsx` and `BlockBanner.tsx` (display-only, no form inputs; `BlockBanner`'s horizontal timeline already scrolls on overflow).

**Build fix:** removed a leftover `setMobileTemplatePrefill(null)` call in `handleBuilderSave` (planner-client.tsx) — dead reference to the state removed above, caught by `pnpm build --no-lint`.

**Session 2026-06-13b — Shared "Race" workout type across all sports, sport name/color editing, planner race picker in block builder:**

User reported "Race" should always exist as a type for every sport and be the same color — previously only sports created after a prior commit got an auto-generated "Race" `WorkoutType`, each an independent row with its own color, so older sports had no "Race" type at all and edits to one sport's "Race" didn't affect the others.

**Shared "Race" type (`isShared` flag, additive schema change):**
- `prisma/schema.prisma`: added `isShared Boolean @default(false)` to `WorkoutType`.
- `lib/planner/types.ts`: `WorkoutType` interface gains `isShared: boolean`. Added missing `race: "#FBBF24"` entry to `BLOCK_TYPE_COLORS` — new "Race"-type training blocks were inheriting "base" blue via `BlockEditorModal.handleTypeChange` because no default color was registered for `"race"`.
- `app/api/sports/route.ts`:
  - `POST kind:"sport"`: the new sport's "Race" `WorkoutType` now copies `name`/`color`/`defaultZone` from any existing `isShared: true` row (falls back to `Race` / `#FBBF24` / zone 5 if none exist), created with `isShared: true`.
  - `PATCH kind:"type"`: if the updated row is `isShared`, propagates `name`/`color`/`defaultZone` (excluding `order`, which is per-sport list position) to every other `isShared: true` row for the user via `updateMany`.
  - `PATCH kind:"sport"` (new, via new `sportUpdateSchema`): updates a sport's `name`/`color`.
  - `DELETE kind:"type"`: returns 400 `cannot_delete_shared_type` if the target row is `isShared` — "Race" can no longer be deleted.
- `app/api/planner/backfill-shared-race-type/route.ts` (new): one-time POST — finds canonical `name`/`color`/`defaultZone` from any existing "Race" type for the user (defaults to `Race`/`#FBBF24`/zone 5 if none), then for every sport either updates its existing "Race" type to `isShared: true` + canonical values, or creates one with `order: 999`. Returns `{ sportsFixed }`.
- `app/(dashboard)/planner/planner-client.tsx`: new one-time `useEffect` (localStorage flag `planner_shared_race_type_backfilled_v1`) calls the backfill endpoint and `router.refresh()`s if `sportsFixed > 0`.
- `components/planner/WorkoutBuilder.tsx`: removed the `RACE_ID = "__race__"` synthetic-type hack added in the 2026-06-06 bug-audit session — every sport now has a real "Race" `WorkoutType` row, so it appears naturally in the type `<select>`. `effectiveTypeName` and the save payload no longer special-case `RACE_ID`.

**Sport name/color editing (Settings → Training Types):**
- `app/(dashboard)/settings/sports/sports-manager.tsx`: `WorkoutType` interface gains `isShared: boolean`. `updateType()` now also propagates `name`/`color`/`defaultZone` (not `order`) to every other `isShared` type across the local `sports` state, so cross-sport sync shows immediately without a refresh. Sport color dot is now a button opening a `PRESET_COLORS` swatch row (new `editingSportColorFor` state, row rendered between the header and the expanded types section regardless of expand state); sport name is now an editable `<input>` (`onBlur` saves via new `updateSport()`, `PATCH kind:"sport"`). Any `isShared` type (i.e. "Race") shows a "Shared" badge (title explains cross-sport editing) and has no delete button.
- `app/(dashboard)/settings/sports/page.tsx`: added `isShared: t.isShared` to the `workoutTypes` mapping passed to `SportsManager` — was missing, so the client never saw the flag.

**Block builder race picker:**
- `components/planner/BlockEditorModal.tsx`: new optional prop `racePlannedWorkouts: { id; name; date }[]`. When `blockType === "race"`, a new "Pick from planner (optional)" `<select>` lists planner workouts of type "Race"; selecting one sets `name`, `startDate`, and new `targetRaceId` state, included in `onSave`'s payload. Also fixed a pre-existing bug that prevented saving any *new* race-type block: `handleSave`'s guard and the Save button's `disabled` check used raw `endDate` (always `""` for new blocks since the End-date input is hidden for `blockType === "race"`) — both now use `effectiveEndDate` (`= isRaceType ? startDate : endDate`), which is `startDate` for races.
- `app/(dashboard)/planner/planner-client.tsx`: new `racePlannedWorkouts` memo — `workouts` filtered to `type?.name === "Race"`, mapped to `{id, name, date}`, sorted by date — passed to `BlockEditorModal`. `targetRaceId` already round-trips through `app/api/planner/blocks/route.ts` and `[id]/route.ts` (existing zod field, spread into Prisma create/update) — no API changes needed there.

**Verification:** `pnpm exec prisma db push` applied the additive `isShared` column locally. Ran the backfill logic directly against the dev DB — all 6 existing sports got a "Race" type with `isShared: true`, `#FBBF24`, zone 5. `pnpm build --no-lint` passes. No browser available in this session — the sport name/color editing and the race picker have not been clicked through in the UI yet.

**Session 2026-06-13c — WorkoutBuilder: section totals auto-grow Total time/distance, drag-and-drop section reorder:**

User reported that after entering Total time/distance and then adding sections whose combined total exceeds those values, the top-level fields stayed at the originally-typed (now too-small) numbers. Also requested drag-and-drop reordering of sections.

- `components/planner/WorkoutBuilder.tsx`:
  - New `useEffect` (runs on `est.totalSec`/`est.totalM`/`sectionsCustomized` changes): if the sum of section durations (minutes, rounded) exceeds `totalDurMin`, raises `totalDurMin` to match; same for section distances (km, 1 decimal) vs `totalDistKm`. One-way ratchet — totals grow to cover the sections but never auto-shrink if sections are later reduced, since the field still represents "at least this much." Gated on `sectionsCustomized` — for the single auto-synced default section, `estimated()` derives a pace-based time estimate (360 sec/km fallback) for distance-type sections, which would otherwise overwrite `totalDurMin` with a meaningless guess for non-running sports when only Total distance was entered.
  - Drag-and-drop section reorder: new `draggedKey`/`dragOverKey` state and `moveSection(fromKey, toKey)` helper (splices the dragged section to the drop target's position, renumbers `order` 0..n, sets `sectionsCustomized = true`). Implemented with native HTML5 DnD (`draggable`/`onDragStart`/`onDragOver`/`onDragLeave`/`onDrop`/`onDragEnd`) on each `SectionRow`'s header bar — same pattern as `TemplateCard.tsx`'s drag source. `SectionRow` gained `isDragging`/`isDragOver` props for opacity/border feedback; the `GripVertical` icon is now the visual drag handle (`cursor-grab`), hidden below the `sm` breakpoint since native DnD doesn't work on touch.
  - Up/down reorder buttons (touch-friendly fallback for DnD): new `moveSectionStep(key, "up" | "down")` helper finds the adjacent section by index and calls `moveSection`. `SectionRow` gained `canMoveUp`/`canMoveDown`/`onMoveUp`/`onMoveDown` props; a `ChevronUp`/`ChevronDown` button stack in the header (same style as `sports-manager.tsx`'s `moveType` reorder buttons, `disabled` + `opacity-25` at list boundaries, `e.stopPropagation()` to avoid toggling the row's expand/collapse).

**Verification:** `pnpm build --no-lint` passes. No browser available in this session — not clicked through in the UI yet.

**Session 2026-06-13d — WorkoutPill: remove redundant check/cross icon, keep status dot:**

User reported the planner week grid's workout cards showed both a check/cross icon next to the name and a colored status dot in the corner — redundant.

- `components/planner/WorkoutPill.tsx`: removed the `Check`/`X` icons rendered next to the workout name for past workouts (`isCompleted`/`isMissed`); the colored status dot (top-right corner, green/red) remains as the sole completion indicator. The `opacity-55` shading for missed workouts and `line-through` on the name are unchanged. Removed now-unused `Check`/`X` imports from `lucide-react`.

**Verification:** `pnpm build --no-lint` passes. No browser available in this session — not clicked through in the UI yet.

**Session 2026-06-13e — Strava description sync bug, activity map rendering fix, webhook sync coordination:**

User reported descriptions no longer importing correctly from Strava, the activity map still rendering broken (fragmented/dark tiles, despite the earlier "double init" fix), and asked for webhook syncs to take priority over an in-progress backfill plus a 3-day resync on every webhook event.

**Description-wipe bug in `syncActivities` (re-sync of existing activities):**
- Confirmed via a live Strava API call that the `/athlete/activities` list endpoint (SummaryActivity) has no `description`/`perceived_exertion` fields — only the per-activity `/activities/{id}` endpoint (DetailedActivity) does.
- `lib/strava/sync.ts` `syncActivities()`: for activities that already `exist` in the DB, the per-activity `update` previously included `description`/`perceivedExertion` unconditionally, sourced from `mapActivity(fullRaw, ...)` where `fullRaw` is the list-summary (no detail fetch) — both were always `null`, silently wiping any previously-imported description on every re-sync pass. Fix: `description`/`perceivedExertion` are now only included in `update` when `detailFetched` is true (i.e. for genuinely new activities, where a full `/activities/{id}` fetch was made).

**Activity map rendering — root cause was a CSP-blocked stylesheet, not tile timing:**
- The earlier fix addressed a double-init issue (React Strict Mode), but the CartoDB tiles still rendered as fragments with large dark gaps. Root cause: `app/layout.tsx` loaded Leaflet's CSS from `cdnjs.cloudflare.com`, but `next.config.ts`'s CSP `style-src 'self' 'unsafe-inline'` does not allow that origin — the browser silently blocks the stylesheet. Without `.leaflet-tile-pane`/`.leaflet-tile` positioning rules, tile `<img>`s render in normal document flow instead of an absolutely-positioned grid, producing exactly the fragmented/dark-gap layout from the screenshot.
- Fix: removed the CDN `<link rel="stylesheet">` from `app/layout.tsx`; `app/(dashboard)/activities/[id]/activity-map.tsx` now does `import "leaflet/dist/leaflet.css"` (self-hosted via the existing `leaflet` npm dependency, same-origin, no CSP change needed). Also removed the dead `L.Icon.Default.mergeOptions(...)`/`_getIconUrl` CDN-marker-icon hack — the component only uses `L.circleMarker()` (canvas-drawn), never `L.marker()` with the default icon.

**Webhook sync coordination:**
- `app/api/strava/webhook/route.ts` `handleEvent()`: on `create`/`update`, now calls `backfillRunner.pause(userId)` before syncing and `backfillRunner.resume(userId)` in a `finally` — an in-progress historical backfill (`lib/strava/backfill-runner.ts`) is paused while the webhook's Strava API calls run, so it doesn't consume the 15-min rate-limit budget the webhook needs. Both calls are no-ops if no backfill is running for that user.
- After `syncSingleActivity`, also calls `resyncRecentActivities(userId, 3)` — Strava doesn't send webhooks for description-only edits to older activities, so every webhook sync now re-checks the last 3 days for such edits (per user's diagnosis of the description bug above).

**Verification:** `pnpm build --no-lint` passes. No browser available in this session — the map fix has not been visually verified; check on `training.helgars.se` after deploy (CartoDB tiles + Leaflet zoom control should render as a proper grid with no dark gaps).

**Session 2026-06-17 — Garmin unofficial sidecar sync:**

Official Garmin Developer Program requires a business application and is not accessible for personal projects. Alternative: Python sidecar that uses the unofficial `garminconnect` library (same SSO OAuth as the Garmin mobile app) — no developer credentials required.

**New files:**
- `scripts/garmin_sync.py`: authenticates via `garminconnect` (token-based, ~6-month lifetime, MFA-aware on first run), fetches all available wellness data not in Strava, upserts into `GarminDailySummary`. CLI flags: `--date YYYY-MM-DD`, `--backfill N`. Intended as a daily cron job at 08:15. Run once interactively to authenticate.
- `scripts/requirements-garmin.txt`: `garminconnect>=0.2.14`, `psycopg2-binary>=2.9`.

**Data fetched per day** (all unavailable from Strava):
- `get_user_summary(d)`: `restingHR`, `bodyBattery` (daily peak), `respirationRate`, `stressAvg`, `steps`
- `get_sleep_data(d)`: `sleepDuration`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`, `sleepScore`
- `get_hrv_data(d)`: `hrvNightly` (RMSSD ms), `hrvBalance` (Balanced/Low/Unbalanced)
- `get_training_readiness(d)`: `trainingReadiness` (0–100, Garmin's proprietary daily readiness score)
- `get_spo2_data(d)`: `spo2Avg` (% avg blood oxygen)

**`prisma/schema.prisma`** — `GarminDailySummary` gains 4 new fields: `stressAvg Int?`, `trainingReadiness Int?`, `spo2Avg Float?`, `steps Int?`.

**`app/(dashboard)/dashboard/page.tsx`:**
- `latestGarmin` select extended to include all new fields.
- Dashboard wellness row now shows: Sleep score, sleep hours, HRV, Body Battery, Garmin Readiness, Stress, SpO₂ (SpO₂ always shown, not just when low — user can see it's normal).
- `computeReadiness()`: Garmin's `trainingReadiness` (0–100) is blended in at 40% weight when available. High stress (`stressAvg > 60`) applies a penalty. Type signature updated.

**`lib/ai/context-builder.ts`:** Health log extended with Garmin Readiness score, yesterday's stress level (⚠ flagged if > 70), and SpO₂ (⚠ flagged if < 95).

**Setup on server:**
```bash
pip install garminconnect psycopg2-binary
# Create /var/www/traininglab/.env.garmin with GARMIN_EMAIL, GARMIN_PASSWORD, DATABASE_URL, TRAININGLAB_USER_ID
source /var/www/traininglab/.env.garmin
python3 /var/www/traininglab/scripts/garmin_sync.py   # first run — handles MFA
# Then add to crontab:
# 15 8 * * * source /var/www/traininglab/.env.garmin && python3 /var/www/traininglab/scripts/garmin_sync.py >> /var/log/garmin_sync.log 2>&1
```

**Session 2026-06-16e — i18n: full site translation Swedish → English:**

Translated every user-visible Swedish string across 16 files. Regex patterns in workout-type classification code (WorkoutBuilder, PlannerCalendar, sports-manager) intentionally kept bi-lingual — they match user-entered workout names which may be Swedish. AI chat language toggle also intentionally untouched.

Files changed:
- `app/(dashboard)/activities/[id]/page.tsx` — Pa:HR section labels + explanation text
- `app/(dashboard)/activities/[id]/splits-chart.tsx` — "tid"/"distans" → "Time"/"Distance"; "Snittempo" → "Avg pace"
- `app/(dashboard)/activities/[id]/splits-table.tsx` — "Pace variabilitet" → "Pace variability"
- `app/(dashboard)/activities/activity-list.tsx` — sort labels; "Tävlingar" → "Races"
- `app/(dashboard)/dashboard/page.tsx` — "Planerat idag", "Sömn", "Träningsdagbok", "Alla idrotter", "Mål", "Redigera" etc. → English
- `app/(dashboard)/dashboard/sync-button.tsx` — "aktiviteter"→"activities", "Uppdaterat"→"Up to date", "Syncar…"→"Syncing…"
- `app/(dashboard)/history/history-client.tsx` — weekday headers Mån–Sön → Mon–Sun; "sammanfattad"→"no laps"; title tooltip → English
- `app/(dashboard)/races/page.tsx` — subtitle text
- `app/(dashboard)/settings/athlete-profile.tsx` — field labels
- `app/(dashboard)/settings/goals/goals-manager.tsx` — "Vecka/Månad/År"→"Week/Month/Year"; "Distans/Tid"→"Distance/Time"; "Alla idrotter"→"All sports"; all buttons/labels
- `app/(dashboard)/stats/stats-client.tsx` — card titles ("Träningsmonotoni"→"Training Monotony", "Kadens & steglängd"→"Cadence & Stride", "Efficiency Factor — aerob effektivitet"→"Efficiency Factor", "Personlig återhämtningstid"→"Recovery time"); "tempopass"→"tempo runs"; recovery description text
- `app/(dashboard)/stats/volume/volume-client.tsx` — km/time toggle capitalization standardized: "Km"→"km", "Time"→"time" (matches stats-client.tsx)
- `app/api/coach/calibrate/route.ts` — `aiInsights` error strings from Swedish to English
- `components/charts/LTPaceTrendChart.tsx` — "(prognos)"→"(projected)"; "3-månadersprognos"→"3-month projection"; "Rullande 90-dagarsfönster"→"Rolling 90-day window"; "För lite data"→"Not enough data"; "Ingen data"→"No data"
- `components/coach/ChatInterface.tsx` — tool menu, presets, empty state, long-conversation banner; `"Sammanfattning:"` → `"Summary:"` for banner detection
- `components/stats/fitness-metrics.tsx` — ACWR label + safe zone description

**Session 2026-06-16f — Bug fixes + new features (prior session undocumented items):**

Features and fixes from the session preceding the translation pass that were not yet in the plan:

**`lib/utils.ts` — `formatPace` "3:60" fix:**
- Round total seconds *before* computing minutes/seconds: `const totalSec = Math.round(1000 / metersPerSec)`. Previously, seconds were derived after flooring minutes, causing the remainder to display as "60" when rounding pushed it over 59.

**`app/(dashboard)/activities/[id]/page.tsx` — Pa:HR sign-aware labels:**
- `drift = r2/r1 - 1`: negative drift = HR dropped relative to pace (negative split / good aerobic coupling). Label now correctly says "negative drift" for well-coupled efforts instead of showing a misleading direction.

**`app/(dashboard)/stats/page.tsx` — Monotony fast path fix:**
- Monotony card was always null/hidden on the fast path because `trainingLoad ?? 0` used Strava-provided TSS which is frequently null → all 7 days = 0 → stddev = 0 → null. Fixed: fast path now builds per-day TSS from `curveTSSMap` (same HR-derived TSS used for ATL/CTL), consistent with the slow path.

**`app/(dashboard)/stats/stats-client.tsx` — EF delta comparison fix:**
- `slice(0, 4)` was comparing recent 4 weeks to the *oldest 4 weeks ever*, not to 4–8 weeks ago. Fixed to `slice(-8, -4)` with an `efByWeek.length >= 8` guard. Label updated from "vs 4-8 veckor sen" to "vs prior 4 weeks".

**`app/(dashboard)/stats/stats-client.tsx` — Cadence & EF chart styling:**
- Both charts now use `CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}`, styled `XAxis`/`YAxis` with `var(--text-primary)` fill, and formatted tooltip values — matching the styling of all other recharts in the app.

**`app/(dashboard)/stats/stats-client.tsx` — Recovery card description:**
- Recovery time card now includes a brief explanation: "< 5 days = fast recovery; > 8 days = slow; check stress sources" — gives context without requiring the user to know TSB conventions.

**`prisma/schema.prisma` + `/api/settings/goals` + `/settings/goals` — Training Goals CRUD:**
- New `TrainingGoal` model: `id`, `userId`, `sport String @default("")` ("" = all sports), `metric` ("distance"|"time"), `period` ("week"|"month"|"year"), `target Float` (km or minutes). `@@unique([userId, sport, metric, period])`. `sport @default("")` (not nullable) so Prisma upsert on the unique constraint works (PostgreSQL `NULL != NULL` breaks upsert with nullable unique fields).
- `app/api/settings/goals/route.ts`: GET (all goals for user), POST (upsert by unique key), DELETE (by `?id=`).
- `app/(dashboard)/settings/goals/page.tsx`: server component, fetches goals + sports list.
- `app/(dashboard)/settings/goals/goals-manager.tsx`: client component — add/edit/delete goals per sport per period per metric. All periods (Week/Month/Year) and metrics (Distance/Time) editable per sport or "All sports".
- `components/settings/settings-nav.tsx`: "Goals" tab added between Training Types and Account.

**`app/(dashboard)/dashboard/page.tsx` — Goals progress widget:**
- Fetches active `TrainingGoal` rows in parallel with other dashboard data. Computes `goalProgress` per goal: sums matching activities by sport and period (current week/month/year), returns `{ target, actual, unit, label }`. Progress bars rendered in a "Training Goals" widget below the planning widget.

**`prisma/schema.prisma` + `/api/settings/profile` — `paceUnitBySport` field:**
- `AthleteProfile.paceUnitBySport Json?` — per-sport pace unit override `{ "Run": "min_per_km", "Ride": "km_h" }`, separate from the global `paceUnit`. Zod schema updated to accept `z.record(z.string(), z.enum([...]))`.

**`components/coach/ChatInterface.tsx` — Tool picker inserts `/toolname` only:**
- `selectTool(name)` now inserts only `/${name} ` (with trailing space) instead of the full preset template. User builds the prompt themselves after picking a tool. Slash-command preset section renamed to plain command names.

**Planner — week detail panel reverted (5B):**
- The inline week detail bottom sheet added in Session 2026-06-16d (5B) was removed after review: `selectedWeek` state, `handleWeekClick`, `selectedWeekStats` useMemo, `onWeekClick` prop, and the panel JSX were all removed from `planner-client.tsx` and `PlannerCalendar.tsx`. `WeekSummaryStrip` click now navigates to `/planner/week` (the dedicated week-detail page) as before. The `startOfWeek` import removed from planner-client.tsx (no longer used after this removal).

**Session 2026-06-16c — Stats: cadence/stride trend, EF trend, training monotony/strain, recovery speed:**

Four new fitness metric sections added to the Stats page:

- `app/(dashboard)/stats/page.tsx`:
  - `type A` gains `startDateLocal: Date`, `averageCadence: number | null`, `trainingLoad: number | null` to support the new computations.
  - **Slow path query** (`activities findMany select`): added `startDateLocal`, `averageCadence`, `trainingLoad` to the select clause.
  - **Fast path query** (`recentForCurve findMany select`): added `startDateLocal`, `averageCadence`, `trainingLoad` to the select clause. New `CurveActExt` type alias used for the extended cast.
  - **Cadence & stride trend (1A)** — computed in both slow and fast paths. Loops running activities with `averageCadence >= 50` and `averageSpeed >= 1`; computes `spm = averageCadence * 2` (Strava stores one-foot cadence) and `strideM = averageSpeed / (spm / 60)`; aggregates by ISO week key (`startDateLocal`). Last 26 weeks returned as `cadenceByWeek: { week, spm, strideM }[]`.
  - **Efficiency Factor trend (2A)** — easy runs only (avgHR < lt1HR derived from `fitnessCache.decouplingLt1HR` or `0.76 * maxHR`), minimum 3 km. EF = speed(m/min) / avgHR. Sanity filter 0.5–5. Last 16 weeks as `efByWeek: { week, ef }[]`.
  - **Training Monotony + Strain (2C)** — uses `trainingLoad` field (Strava-provided TSS) to build a per-day map for the current week. `monotony = weekMean / weekStddev`; `strain = weekTSS * monotony`. Both `null` if stddev is zero (uniform week or no data).
  - **Recovery speed (2F)** — scans the already-computed `loadCurve` (730-day ATL/CTL/TSB array) for TSB troughs (< −15) to recovery (≥ 0) sequences; records day-count for each. `avgRecoveryDays` = mean across all sequences, `null` if fewer than 2 sequences found.
  - `renderStats()` signature gains 6 new optional params: `cadenceByWeek`, `efByWeek`, `monotony`, `strain`, `avgRecoveryDays`, `recoveryDaysCount`. Both call sites pass these values.
  - `StatsClient` JSX gains the same 6 props with `?? []`/`?? null`/`?? 0` defaults.

- `app/(dashboard)/stats/stats-client.tsx`:
  - New recharts imports: `LineChart`, `Line`, `ComposedChart`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer` (recharts ^2.13 already in package.json).
  - `Props` interface gains: `cadenceByWeek`, `efByWeek`, `monotony`, `strain`, `avgRecoveryDays`, `recoveryDaysCount`.
  - Destructured in `StatsClient` body.
  - **Load tab**: two new cards added below the `TrainingLoadChart`:
    - "Träningsmonotoni (vecka)" — shows `monotony` (2 decimals, color-coded: accent < 1.5, warning 1.5–2.0, error > 2.0) and `strain` (integer) in a 2-column grid. Rendered only when `monotony !== null`.
    - "Personlig återhämtningstid" — shows `avgRecoveryDays` with contextual text (< 5 = fast, > 8 = slow, else normal) and count of recovery sequences. Rendered only when `avgRecoveryDays !== null`.
  - **Fitness tab**: two new `SectionCard`s added after the "Aerobic pace trend" card:
    - "Kadens & steglängd" — dual-axis `ComposedChart`: left Y = spm (green `#6EE7B7`), right Y = strideM (blue `#60A5FA`), 160px height, legend below. Rendered when `cadenceByWeek.length > 0`.
    - "Efficiency Factor (EF) — aerob effektivitet" — single `LineChart` (120px), plus a 4-week recent vs. first-4-week comparison summary line. Rendered when `efByWeek.length > 4`.

**Session 2026-06-16d — Planner features 5A (touch DnD), 5B (week detail panel), 5D (taper marker):**

**5A — Touch drag-and-drop for workout pills:**
- `components/planner/PlannerCalendar.tsx`: Added `@dnd-kit/core` integration alongside the existing native HTML5 drag-and-drop (which remains for desktop). Imported `DndContext`, `DragOverlay`, `PointerSensor`, `TouchSensor`, `useSensor`, `useSensors`, `useDroppable`, `useDraggable`, `DragEndEvent`, `DragStartEvent`, `DragOverEvent`. Added `dndActiveWorkout` and `dndOverDate` state; `handleDndDragStart` (captures the dragging workout for the overlay), `handleDndDragOver` (updates `dndOverDate`), `handleDndDragEnd` (validates target is a date string, calls `onWorkoutMove`, no-ops on same-day drop). New `DroppableDay` component wraps each day cell with `useDroppable({ id: dateStr })` using `display: contents` so no extra DOM box is introduced. New `DraggableWorkout` component wraps each WorkoutPill with `useDraggable({ id: workout.id })`, adds `touch-none` class so touch events are handed to dnd-kit. `DragOverlay` renders a ghost pill during drag. Sensors use `PointerSensor` (distance: 8px activation — preserves click behaviour) and `TouchSensor` (500ms delay, 5px tolerance). `isDragOver` for visual highlight now ORs both HTML5 `dragOverDate` and dnd-kit `dndOverDate`. The existing `onWorkoutMove` prop and `handleMoveWorkout` in planner-client are unchanged.

**5B — Inline week detail panel:**
- `app/(dashboard)/planner/planner-client.tsx`: Added `format`, `startOfWeek` imports from `date-fns` and `X as XIcon` from lucide-react. New `selectedWeek` state stores `{ weekStart, workouts }`. `handleWeekClick(weekStart, weekWorkouts)` toggles the selected week (re-clicking same week closes the panel). `selectedWeekStats` useMemo computes `planned`, `completed`, `missed`, `tssHours`, `weekLabel` from the selected week's workouts. Panel rendered as `fixed inset-x-0 bottom-0 z-40` on mobile (bottom sheet) and `static md:border md:rounded-xl md:mt-4` on desktop (inline below the calendar). Shows 4 stat cells: Planned sessions, Completed sessions, Planned hours, Completion %. Close button (×) clears `selectedWeek`. `onWeekClick` prop wired to `PlannerCalendar`.
- `components/planner/PlannerCalendar.tsx`: Added `onWeekClick?: (weekStart: Date, weekWorkouts: PlannedWorkout[]) => void` to Props. Both `WeekSummaryStrip` instances (row mode and compact/sidebar mode) receive `onClick` → `() => onWeekClick(weekStart, weekWorkouts)`. WeekSummaryStrip's existing `onClick` prop (previously only used to navigate to `/planner/week`) is now used to call the inline panel instead.

**5D — Taper start marker in calendar:**
- `components/planner/PlannerCalendar.tsx`: `taperWeeks(raceName, targetDuration)` helper maps race name/duration to taper length (marathon→3w, half→2w, 10k→1w, long race >1h→2w, else 1w). `taperDates` useMemo iterates future workouts where `type.name === "Race"` or name matches `/race|tävling/i`; for each, computes taper-start date = `race date − N×7 days`; stores in a `Set<string>`. Day cells check `taperDates.has(key)` and render `⚡ Taper start` in `text-[9px] font-semibold text-warning/70` below the date number when matched.

**Phase checklist updates:**
- [x] `components/planner/PlannerCalendar.tsx` — touch DnD via dnd-kit (5A), taper marker (5D), onWeekClick prop (5B)
- [x] `app/(dashboard)/planner/planner-client.tsx` — week detail bottom panel (5B)

**Notes:**
- Native HTML5 DnD kept for desktop (already worked); dnd-kit adds touch support on top
- The `/planner/week` detail page (full-page week breakdown) still exists and is navigated to by default when `onWeekClick` is not provided — the inline panel replaces that navigation in the planner view
- `taperWeeks` is defined as a plain function inside the component body (not a hook) so it's available to the `taperDates` useMemo without being a dependency

**Session 2026-06-16b — Infrastructure: token-refresh dedup, backfill prioritization, stream caching, PWA manifest:**

- `lib/strava/client.ts`: added module-level `refreshingTokens: Map<string, Promise<string>>` — deduplicates concurrent Strava token-refresh calls for the same userId. If two parallel requests both see an expired token, only one network call goes to Strava; the second awaits the same Promise. Map entry is removed in `.finally()` so next real expiry creates a fresh refresh. `refreshStravaToken` now has an explicit `Promise<string>` return type.
- `lib/strava/backfill.ts` `runHistoricalBackfill()`: added 90-day prioritization sort after the `findMany` call. Activities from the last 90 days are sorted to the front of the queue (still newest-first within that window); older activities come after. Ensures recent data is backfilled first during long initial syncs. `startDate` added to the Prisma `select` to support the sort; the field was unused by the loop body so no downstream change.
- `app/api/activities/[id]/streams/route.ts`: rewrote to add DB caching. Checks `activity.stream` (the `ActivityStream` relation) before calling Strava — returns the cached stream immediately when present, reconstructing the Strava-shaped response object (`velocity_smooth` ↔ `velocity` field rename). On a live Strava fetch, computes HRR60 (heart-rate drop over 60 s after peak HR) and fires `prisma.activityStream.create` + optional `prisma.activity.update({ hrrSeconds })` fire-and-forget after returning the response. Streams are now fetched from Strava at most once per activity. `activity-charts.tsx` already fetches from `/api/activities/${activityId}/streams` — no change needed there.
- `package.json`: added `"next-pwa": "^5.6.0"` to dependencies (install will happen on next prod deploy via `pnpm install`).
- `public/manifest.json`: created PWA web app manifest — name, display: standalone, theme color `#6EE7B7`, background `#0F1117`, two icon entries (192px, 512px).
- `app/layout.tsx`: added `manifest: "/manifest.json"` to the `metadata` export so Next.js injects the `<link rel="manifest">` tag.

**Session 2026-06-16 — AI Coach: extended slash-command presets (7D) + /summarize command (7E):**

- `components/coach/ChatInterface.tsx`: added `handleSummarize()` function — pre-fills the textarea with a Swedish summarize prompt ("Sammanfatta de viktigaste insikterna…") and focuses the textarea. Does NOT auto-send; user reviews and hits Enter.
- `components/coach/ChatInterface.tsx`: added 5 preset prompt entries in the slash-command menu (below existing tools, above Language toggle), separated by a "Snabbkommandon" section header. Each preset pre-fills a Swedish template the user completes: `/plan`, `/taper`, `/analyze`, `/week`, `/compare`. Rendered via the existing `selectTool()` flow.
- `components/coach/ChatInterface.tsx`: added `/summarize` as a 5th quick-start button in the empty-state suggestion row. Clicking it calls `handleSummarize()` rather than `setInput`.
- `components/coach/ChatInterface.tsx`: added long-conversation banner — shown above the input when `messages.length >= 20` AND no message contains `"Sammanfattning:"`. The banner has a clickable "sammanfatta den" link that calls `handleSummarize()`.
- `app/api/coach/summarize/route.ts` (new): POST endpoint that verifies session ownership and returns `{ messages: count }` for a given `conversationId`. Actual summarization flows through the normal chat endpoint after the user sends the pre-filled prompt.

**Verification:** TypeScript check required — run `pnpm exec tsc --noEmit` to confirm no type errors before deploy.

**Session 2026-06-16c — Activity list sort + filter (9F), Settings pace unit + annual goals (9H + 1E):**

**Activity list sort and filter (9F):**
- `app/(dashboard)/activities/page.tsx`: `searchParams` now accepts `sort`, `minKm`, `maxKm`, `racesOnly`. `sort` defaults to `"date_desc"`; `minKm`/`maxKm` are parsed from km to meters before being used in the Prisma `where` clause. `racesOnly` maps `"1"` → `{ isRace: true }`. `orderBy` is derived from `sort`: `dist_desc`/`dist_asc` sort by `distance`, `pace_asc`/`pace_desc` sort by `averageSpeed` (inverted — faster pace = higher speed), `date_desc` is the default. All new values passed as props to `ActivityList`.
- `app/(dashboard)/activities/activity-list.tsx`: `Props` interface gains `sort: string` and `racesOnly: boolean`. New sort/filter row rendered above the sport chips: a `<select>` dropdown with 5 sort options (date, distance long→short, distance short→long, pace fastest, pace slowest) on the left; a "Tävlingar / 🏆 Tävlingar" toggle button on the right using `bg-warning/10` highlight when active. Both controls push to `/activities?...` via `useSearchParams()` + `router.push()`, clearing `page` param on change. On mobile the row stacks naturally via `flex-wrap`.

**Settings — pace unit (9H):**
- `app/(dashboard)/settings/athlete-profile.tsx`: `Profile` interface gains `paceUnit?: string | null`. A radio group with three options (`min/km`, `min/mi`, `km/h`) is rendered inside a `Field` spanning `sm:col-span-2`. Selection updates `form.paceUnit` directly. Included in the `fetch("/api/settings/profile")` POST body.
- `app/api/settings/profile/route.ts`: `paceUnit` added to Zod schema as `z.enum(["min_per_km", "min_per_mi", "km_h"]).optional()`. Persisted via the existing `profileData` spread in the `AthleteProfile` upsert.

**Settings — annual goals (1E):**
- `app/(dashboard)/settings/athlete-profile.tsx`: `Profile` interface gains `annualGoals?: Record<string, Record<string, number>> | null`. `setGoal(sport, value)` helper updates `form.annualGoals[currentYear][sport]` and removes the key when the field is cleared. Rendered below pace unit as one number input per sport (from `sports` prop). Stored as `{ "2026": { "Run": 2000, "Ride": 3000 } }`.
- `app/(dashboard)/settings/profile/page.tsx`: added `prisma.sportCategory.findMany` to the parallel query. Passes `paceUnit`, `annualGoals`, and `sports` to `AthleteProfileForm`. `annualGoals` cast from Prisma `JsonValue` to `Record<string, Record<string, number>> | null`.
- `app/api/settings/profile/route.ts`: `annualGoals` added to Zod schema as a nested `Record<year-string, Record<sport-name, km-number>>` shape. Persisted as-is via the `profileData` spread (`Json?` column).

**Session 2026-06-13f — Smoothed-pace display option, light-mode map tiles:**

User requested a "slightly smoothed" pace display option on the activity performance chart, and a light-mode tile theme for the activity map (previously always dark).

**Smoothed pace toggle:**
- `app/(dashboard)/activities/[id]/activity-charts.tsx`: new `movingAverage()` helper — centered moving average over a configurable window, ignoring `null`s. `StreamPoint` gains `paceSmoothSecKm`; computed by smoothing the raw `velocity_smooth` stream over a 21-sample window *before* converting to pace (averaging velocity rather than pace directly, since pace = 1/v is nonlinear and skews under direct averaging).
- New `paceMode` state (`"raw" | "smoothed"`, default `"raw"`) with a "Raw pace / Smoothed" toggle next to the series buttons, shown only when the pace series is active. The pace `<Line>`'s `dataKey` switches between `paceSecKm` and `paceSmoothSecKm`; `CustomTooltip` formats both as `m:ss/km`.

**Light-mode activity map:**
- `app/(dashboard)/activities/[id]/activity-map.tsx`: now reads `resolvedTheme` via `useTheme()` (next-themes) and picks the CartoDB tile set accordingly — `light_all` in light mode, `dark_all` otherwise (unchanged default). `resolvedTheme` added to the map-init effect's dependency array, so the map re-creates with the correct tile layer if the user toggles theme while viewing an activity. Container's loading-state background changed from a hardcoded dark `#1a1d27` to `var(--surface-2)` so it matches whichever theme/color-scheme is active before tiles load.

**Verification:** `pnpm build --no-lint` passes. No browser available in this session — neither the pace-smoothing toggle nor the light-mode map tiles have been visually verified; check both on `training.helgars.se` after deploy.

**Session 2026-06-06 — Planner: copy-paste, drag past sessions, sport normalization, template mobile fix:**

**Copy-paste workouts (Ctrl+C/V + right-click + long-press):**
- `components/planner/WorkoutPill.tsx`: `onContextMenu` prop for right-click; 500ms long-press (`onTouchStart` timer) calls `onCopyRequest` with haptic feedback; `didLongPress` ref prevents click from firing after long-press; all workouts now draggable (removed `canDrag = workout.date >= today` guard).
- `components/planner/PlannerCalendar.tsx`: new `CopiedWorkout` export type; `FloatingMenu` inline component for context menus. Right-click workout → "Copy (Ctrl+C)" menu item; right-click day → "Paste / Add workout" menu items. Day cells: paste mode changes click behavior (paste instead of builder), shows accent border + `ClipboardPaste` icon as visual affordance. Keyboard listener on `window`: Ctrl/Cmd+C copies last right-clicked workout (tracked via `lastContextWorkout` ref), Ctrl/Cmd+V pastes to hovered day (`hoveredDateRef`), Escape clears copy mode; refs avoid stale closure issues. Also removed `if (key < today) return` from `onDragOver`/`onDrop` so past days accept drops.
- `app/(dashboard)/planner/planner-client.tsx`: `copiedWorkout: CopiedWorkout | null` state; `handleCopyWorkout`, `handlePasteWorkout` (calls `createWorkout` with copied data). Copy-mode banner between BlockBanner and calendar: shows workout name, "right-click a day / tap a day to paste" hint, Cancel button. Props wired to PlannerCalendar.

**Sport type normalization (Run vs Running):**
- `normalizeSportType(type, sports)` utility in PlannerClient: exact match → case-insensitive match → Strava alias map (`Run→Running`, `Ride→Cycling`, `NordicSki→Skiing`, `RollerSki→Roller Skiing`, `WeightTraining→Strength`). Applied on initial `workouts` state (lazy initializer) and after `createWorkout` API response. Eliminates duplicate sport rows in WeekSummaryStrip.

**Drag past workouts:** Removed date restriction in WorkoutPill (`canDrag = true` always) and in PlannerCalendar drop handlers — any day (past or future) accepts drops.

**Template mobile "Add" button fix:** Added `onMobileSelectTemplate?: (templateId: string) => void` prop to TemplateLibrary. When `mobileOpen`, TemplateCard's "+" button calls this instead of `onAddToDate`. `handleMobileTemplateSelect` in PlannerClient closes overlay, sets `mobileTemplatePrefill`, and opens builder atomically — no ambiguous `mobileLibOpen` closure check needed.

**Session 2026-06-05 — Mobile polish round 2 (hamburger, tooltips, Swedish→English, templates, sport filter):**

**Hamburger button overlap (Coach + Planner):** Both full-bleed pages used `-my-6` which extended 24px up into the fixed hamburger button's area (hamburger occupies top 56px, but `-my-6` = 24px reduced the gap to 32px). Fixed by switching to `-mx-4 -mb-4 md:-m-6 h-[calc(100vh-56px)] md:h-screen` on mobile — preserves the full 56px (`pt-14`) gap above content while still removing side/bottom padding.

**Stats tab navigation vertical scroll:** `overflow-x-auto` on the nav element was allowing touch events to scroll the nav vertically, intercepting page scroll. Fixed by adding `overflow-y-hidden` and `shrink-0` to each tab button (both `stats-client.tsx` and `volume-client.tsx`).

**Sport filter overflow (Weekly volume card):** `SectionCard` header was a single flex row — the title + sport pills + toggle overflowed on mobile. Fixed by changing to `flex-wrap justify-between` so the controls group wraps below the title on narrow screens.

**MetricTooltip — mobile unusable:** Old implementation used `onMouseEnter/Leave` only (no touch support), tooltip was `pointer-events-none` (couldn't interact or close), and positioned poorly near viewport edges. Rewrote `components/stats/metric-tooltip.tsx`:
  - Click toggles visibility (touch-friendly)
  - Transparent backdrop `div` (same z-layer minus 1) closes tooltip on tap-away
  - Positioning: attempts right of button, flips left if off-screen; attempts below, flips above if would overflow viewport bottom
  - `pointer-events-auto` on tooltip so users can read/scroll content

**Mobile template access in Planner:** Drag-and-drop doesn't work on touch. Fixed:
  - `components/planner/TemplateCard.tsx`: action buttons always visible on mobile (`opacity-100 md:opacity-0 md:group-hover:opacity-100`)
  - `app/(dashboard)/planner/planner-client.tsx`: added `mobileTemplatePrefill` state; when `onAddToDate` is called while `mobileLibOpen=true` (mobile overlay), instead of creating a workout immediately, closes the overlay and opens `WorkoutBuilder` pre-filled with the template — user picks a date in the builder
  - Calendar header "Templates" button changed from icon-only to labeled button with text

**Swedish → English (full app):** Translated 70+ user-facing strings across 10 files:
  - `components/planner/OutcomeModal.tsx`: fully rewritten — miss reasons (Illness/Injury/Fatigue/Other), all labels, confirmations, date locale `"sv"→"en"`
  - `components/planner/BlockEditorModal.tsx`: "Avbryt"→"Cancel", "Bekräfta radering"→"Confirm deletion"
  - `components/planner/PlannerCalendar.tsx`: weekday headers Mon–Sun, rolling labels (Last/This/Next week, In 2 weeks), "Löpande"→"Rolling", "Mallar"→"Templates", title attributes
  - `components/planner/TemplateLibrary.tsx`: close button aria-label
  - `components/coach/ChatInterface.tsx`: approve/reject confirmations, budget/API-key error messages, quick prompts, tool menu hint text, empty state, delete chat title
  - `app/(dashboard)/races/races-client.tsx`: all modal field labels (Distance, Time, Date, Race/Event, Notes), action buttons (Add result, Link activities, Cancel, Save changes), table headers (Date, Race/Event), empty state, link/unlink tooltips, race name fallback
  - `app/(dashboard)/settings/ai-settings.tsx`: "Registrerad"→"Registered", placeholder "Redan sparad…"→"Already saved — paste new key to replace"
  - `app/(dashboard)/settings/sports/sports-manager.tsx`: "Avbryt"→"Cancel", "Radera"→"Delete"
  - `app/api/coach/chat/route.ts`: AI context messages — `[Inväntar godkännande]`→`[Awaiting approval]`, `[Verktyg utfört]`→`[Tool executed]`, analysis prompt, tool-failure fallback prompt, `describeAction()` return values
  - `lib/ai/tools.ts`: all tool result `message` fields shown in the chat UI — dates, "Lade till"→"Added", "Raderade"→"Deleted", "Inga PBs"→"No PBs", "Träningsblock"→"Training blocks", cost warning, activity counts, history analysis label, error messages

**Session 2026-06-05 — Mobile responsiveness rework (Planner, Statistics, PB page):**

**Root causes fixed:** Several components had fixed widths or CSS grids that forced the entire page to scroll horizontally on mobile viewports (375px).

- `app/(dashboard)/layout.tsx`: Added `overflow-x-hidden` to `<main>` as a safety net — prevents any child component from causing page-level horizontal scroll.
- `app/(dashboard)/stats/stats-client.tsx`: Tab nav (`flex gap-1 border-b`) → added `overflow-x-auto` so 5 tabs scroll within the nav bar on mobile instead of overflowing the page. ZoneCalibration method-selector buttons → added `flex-wrap` so the 3 long-text buttons reflow onto multiple lines on narrow screens.
- `app/(dashboard)/stats/volume/volume-client.tsx`: View mode tab row → added `overflow-x-auto` (same fix as stats tab nav; 5 modes with long labels: "Year vs Year", "Cumulative", etc.).
- `app/(dashboard)/races/races-client.tsx`: `grid grid-cols-[200px_1fr]` → `flex flex-col gap-6 sm:grid sm:grid-cols-[200px_1fr]` — stacks on mobile, two-column on `sm+`. Distance sidebar: horizontal pill row on mobile (`flex gap-2 overflow-x-auto`), vertical list on desktop (`sm:flex-col`). History table: "Lopp/Händelse" and "vs PB" columns hidden on mobile (`hidden sm:table-cell`); date uses shorter `d MMM yy` format on mobile via `sm:hidden`/`hidden sm:inline`; actions column hidden on mobile (replaced by row click → opens edit modal). `e.stopPropagation()` added to all button clicks inside table rows to prevent unwanted modal trigger on desktop.
- `components/planner/TemplateLibrary.tsx`: Added `mobileOpen?: boolean` + `onMobileClose?: () => void` props. On mobile the sidebar is `hidden md:flex` by default; when `mobileOpen=true` it becomes `fixed inset-0 z-50 w-full` (full-screen overlay). Added close button (`X` icon) in the header that's visible only when `mobileOpen` on mobile.
- `components/planner/PlannerCalendar.tsx`: Added `onOpenTemplates?: () => void` prop + `LayoutTemplate` import. Mobile-only button appears in calendar header to open template overlay. Layout toggle button (sidebar/row mode) hidden on mobile (`hidden md:inline-flex`) since sidebar mode requires the 256px library to be visible. Weekday header and week row grids: always `grid-cols-7` on mobile; sidebar 8-column grid only on `md+` via `md:grid-cols-[120px_1fr...]`. Sidebar WeekSummaryStrip column: `hidden md:flex` so it doesn't consume space on mobile. Day cell: `min-h-[70px] md:min-h-[88px]` and `p-1 md:p-1.5` for smaller but usable cells on mobile.
- `app/(dashboard)/planner/planner-client.tsx`: Added `mobileLibOpen` state; passes `mobileOpen`/`onMobileClose` to `TemplateLibrary` and `onOpenTemplates` to `PlannerCalendar`. Calendar padding reduced to `p-3 md:p-4` on mobile.

**Session 2026-06-05 — Production deployment + data migration:**

**Deployment (training.helgars.se):**
- nginx: self-signed cert replaced with wildcard `*.helgars.se` cert (provided by network admin). Both `training.helgars.se` and `theodal.helgars.se` use this cert.
- PM2 ecosystem: fixed `script` from `node_modules/.bin/next` (shell script) to `node_modules/next/dist/bin/next` (JS entry point) — PM2 was trying to run a shell script with Node.
- `AUTH_TRUST_HOST=true` added to `.env.local` — required by NextAuth v5 to trust the production domain.
- Fixed 500 after login: `app/(dashboard)/page.tsx` was conflicting with `app/page.tsx` for the `/` route; Next.js resolved to the route group page which had no `page_client-reference-manifest.js`. Deleted `app/(dashboard)/page.tsx` — `app/page.tsx` handles the redirect correctly.
- `middleware.ts`: added `api/strava/webhook` and `api/cron` to matcher exclusions — Strava's webhook validation server makes unauthenticated GET requests; middleware was redirecting them to `/login`, causing webhook registration to fail with Bad Request.

**Data migration (dev → production):**
- Exported 9 tables from local Docker PostgreSQL (`Activity`, `AthleteProfile`, `RaceRecord`, `PlannedWorkout`, `WorkoutTemplate`, `WorkoutSection`, `SportCategory`, `WorkoutType`, `TrainingBlock`) using `pg_dump --data-only`.
- Remapped `userId` from local (`cmpcfsjn80000ru2wao5zjl4j`) to production (`cmpzodwvd0000u48ojwoqb71q`) via string replace.
- Imported on production with `session_replication_role = replica` (FK constraint bypass — note: DB user lacks superuser, so this line was ignored; FK ordering in the dump was correct regardless).
- Result: 2826 activities, 15 race records, 271 planned workouts, 16 templates, 1 athlete profile migrated successfully.
- Not migrated: `StravaAccount`, `AppConfig`, `AISettings` (encrypted with local key — user re-entered credentials via Settings UI).

**Sport categories as defaults for new users:**
- `app/api/admin/users/[id]/route.ts`: when admin approves a user, admin's `SportCategory` and `WorkoutType` records are copied to the new user. Sport ID mapping preserved so `WorkoutType → SportCategory` FK stays correct.

**Session 2026-06-04 — Multi-user support (registration, admin approval, data isolation):**

**Schema:**
- `UserStatus` enum (`pending` / `active` / `rejected`) added to `prisma/schema.prisma`.
- `User.status: UserStatus @default(pending)` — new users start pending.
- `User.isAdmin: Boolean` already existed; existing user set to `active + isAdmin = true` via one-time SQL.

**Auth (`auth.ts`):**
- Credentials provider now gates login on `status === "active"`. Throws `"pending"` / `"rejected"` errors for other statuses.
- JWT callback stores `status` and `isAdmin`; session callback exposes them as `session.user.status` / `session.user.isAdmin`.

**Middleware (`middleware.ts`):**
- Rewrote from `export { auth as middleware }` to a full handler: non-logged-in → `/login`, logged-in but non-active → `/pending`, active on login/register page → `/dashboard`.

**Registration flow:**
- `app/(auth)/register/page.tsx` — name + email + password × 2 form; calls `/api/auth/register`.
- `app/api/auth/register/route.ts` — validates input, rate-limits (5/hr/IP), hashes password, creates user with `status: pending`. Returns same response whether email exists or not (email enumeration prevention).
- `app/(auth)/pending/page.tsx` — "Awaiting approval" page for pending users.
- `app/(auth)/login/page.tsx` — updated with "Request access" link and human-readable pending/rejected error messages.

**Admin UI:**
- `app/(dashboard)/settings/users-admin.tsx` (client component) — shows pending requests (with Approve/Reject), active users (with Revoke), and rejected users (with Approve). Visible only in Settings when `session.user.isAdmin === true`.
- `app/(dashboard)/settings/page.tsx` — imports `UsersAdminSection`, renders it inside a "Users" section gate on `isAdmin`.
- `app/api/admin/users/route.ts` — `GET` returns all users sorted by status then date (admin only).
- `app/api/admin/users/[id]/route.ts` — `POST { action: "approve" | "reject" | "revoke" }` sets status (admin only, cannot modify self).

**Security:**
- Admin status can only be set directly in the DB — no UI or API endpoint can grant it.
- Rate limit on `/api/auth/register`: 5 attempts / hour / IP.
- Email enumeration prevented on register.
- `lib/config.ts`: fixed per-user credential cache (was a module-level singleton that stored one user at a time; changed to `Map<userId, {creds, at}>` so multiple concurrent users work correctly).

**Strava/Garmin architecture:**
- `lib/config.ts` already implemented the right pattern: (1) user's own AppConfig, (2) admin's AppConfig, (3) env vars. Admin sets Strava/Garmin client_id/secret once in Settings; all users use these app-level credentials to connect their personal accounts via OAuth. Each user's access/refresh tokens are stored separately and encrypted.
- AI API keys are fully per-user — stored in `AISettings` table, never shared.

**Deployment files updated:**
- `deployment/README.md` — full rewrite: adds multi-user onboarding flow, Strava/API isolation table, updated first-run checklist, admin account creation instructions.
- `deployment/deploy.sh` — changed `prisma migrate deploy` → `prisma db push --skip-generate` (project uses db-push workflow, not migration files).
- `deployment/env.example` — added `ENCRYPTION_KEY`, clarified Strava/Garmin as optional (can be set in UI), clarified AI keys as per-user.

**Plan archived:**
- `docs/planning/multi-user-plan.md` — remains in planning folder (partially implemented: no email notifications, no GDPR tooling, no password reset UI — per plan scope).

**Session 2026-06-17 — AI Coach deep overhaul: agentic loop, 30 tools, write approval + undo, language persistence, Tavily web search:**

**Motivation:** Coach only made one tool call then answered. Tool descriptions were prescriptive (triggered unconditionally). Language reset to English on every session. No write operations. Only 12 tools covering partial data.

**Core architecture — agentic loop (`app/api/coach/chat/route.ts`):**
- Claude runs in a loop (up to 6 iterations) where each iteration: emits tool_use blocks → all executed in parallel via `Promise.all` → results fed back as `tool_result` blocks → continues until `stop_reason !== "tool_use"` or max iterations.
- Write tools pause the loop before execution and emit a `pending` SSE event; no write runs without user approval. Approval is sent via a separate request; the loop resumes with the approved tool result.
- `WRITE_TOOLS` set: `create_workout`, `update_workout`, `delete_workout`, `create_training_block`, `update_training_block`, `log_race_result`, `delete_race_result`, `update_activity_notes`, `update_profile`.
- Anthropic SDK type incompatibility worked around with `(anthropic.messages.create as any)` and `(response.content as Block[])` casts.

**Tools (`lib/ai/tools.ts` — full rewrite, was 12 tools → now 30):**
- All DB tables covered: activities, planned workouts, training blocks, race records, training goals, Garmin wellness, fitness metrics, athlete profile, sport categories, workout types.
- All tool descriptions are purely descriptive (what they return), never prescriptive — prevents spurious triggering on unrelated questions.
- Three external tools: `web_search` (Tavily), `get_weather_forecast` (Open-Meteo, free), `search_pubmed` (PubMed Entrez API, free).
- All write operations capture `previousStateJson` before mutating and create a `CoachEdit` record; the undo endpoint can restore from it.
- `executeCoachTool(toolName, input, userId, conversationId)` executes any tool by name; returns `ToolResult { success, message, data, editId? }`.

**Undo (`app/api/coach/undo/[editId]/route.ts` — new):**
- POST endpoint: auth-checks ownership, 409 if already undone, calls `applyRestore()` to revert the entity to `previousStateJson`, marks `CoachEdit.undoneAt`.
- Chat UI locks undo buttons when the next message is sent (undo only until next turn).

**Language persistence:**
- `AISettings.coachLanguage String @default("sv")` — stored in DB.
- `app/(dashboard)/coach/page.tsx` reads it server-side and passes as `initialLanguage` prop.
- `ChatInterface.tsx` initializes `useState(initialLanguage)` (was hardcoded `"en"`).
- Language toggle PATCHes `/api/settings/ai` immediately so it persists across sessions.

**Tool UI (`components/coach/ChatInterface.tsx`):**
- `Message.toolActions?: ToolAction[]` (plural, was single) — each message accumulates all tool calls from the agentic loop as separate cards.
- `TOOL_LABELS` map: 29 Swedish labels for tool names (consistent UI labels regardless of internal tool names).
- `ToolActionCard` with "Ångra" undo button (calls `POST /api/coach/undo/[editId]`); locked after next message sent.
- `lockedEditIds` and `undoneEditIds` Sets track per-message undo state.

**Prompts (`lib/ai/prompts.ts`):**
- Tool-use section rewritten — describes the agentic loop, instructs to make multiple parallel tool calls when needed, never use tools on irrelevant questions.
- Language instruction strengthened — always respond in `coachLanguage`, no exceptions.
- `CoachContext` gains `recentSessions?: string` and `weeklyVolume?: string`.

**Context builder (`lib/ai/context-builder.ts`):**
- Added `recentFive` query: 5 most recent activities with key metrics.
- Builds `recentSessions` (last 5 sessions summary) and `weeklyVolume` (current week's sport totals) fields on returned `CoachContext`.

**Tavily web search — key stored in DB (not .env):**
- `prisma/schema.prisma`: `AISettings.tavilyApiKey String?` — AES-256-GCM encrypted.
- `app/api/settings/ai/route.ts`: `tavilyApiKey` in zod schema; `encryptIfNeeded()` on write.
- `app/(dashboard)/settings/page.tsx`: `hasTavilyKey={!!aiSettings?.tavilyApiKey}` prop.
- `app/(dashboard)/settings/ai-settings.tsx`: Tavily section with password input + show/hide, link to tavily.com.
- `lib/ai/tools.ts` `web_search` case: reads from `prisma.aISettings.findUnique` → `safeDecrypt`, falls back to `process.env.TAVILY_API_KEY`.

**Schema changes (require `prisma db push` on prod):**
- `AISettings`: added `tavilyApiKey String?`, `coachLanguage String @default("sv")`.
- `CoachEdit`: new model (from prior session) — `id, userId, conversationId, toolName, description, previousStateJson, newStateJson, entityId, entityType, status, appliedAt, undoneAt`.

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

- **Polar integration** — alternative/additional source for raw physiological data (Garmin itself is done — HRV/sleep/resting HR via unofficial SSO, see `docs/integrations/strava.md`)
- **Strava webhook activation** — backend done (`/api/strava/webhook` + Settings UI); whether the subscription is actually registered with Strava on the live `training.helgars.se` domain is unverified
- **Export** — PDF training report, CSV data export
- **Notifications** — daily training summary email, recovery alerts
- **React Native** — PWA wrapper is done (11B); native app still a future idea

**Carried forward from `docs/planning/archive/IMPLEMENTATION_PLAN_FEATURES_2026.md` (archived 2026-06-22 — ~95% of that plan shipped in the sessions below; these items are what's left):**
- **Period A/B comparison (1F)** — volume/TSS/sessions delta table is done (`stats/volume/volume-client.tsx`); CTL and VO2max trend comparison between periods is not implemented
- **Planner detail panel (5B)** — the originally-designed slide-in panel with separate Week/Block/Plan tabs was never built; an inline week panel was implemented then reverted (see "Session 2026-06-16 — Bug fixes" below) because it broke `WeekSummaryStrip`'s navigation. Clicking a week currently navigates to `/planner/week` instead
- **Mobile-first checklist** — touch targets ≥44px, long-press DnD, bottom-sheet modals, horizontal chart scroll, etc. — listed as a checklist in the archived plan but never explicitly verified against the live app

**Session 2026-06-16 — Dashboard Today Panel, Readiness Score, Annual Goal Widget, Volume Period Delta Table:**

**Feature 4A+4B — Dashboard Today Panel + Readiness Score:**
- `app/(dashboard)/dashboard/page.tsx`: extended `Promise.all` with 4 new parallel queries: `todayPlanned` (planned workouts for today's date), `latestGarmin` (most recent `GarminDailySummary` with HRV/sleep/battery fields), `garmin7d` (last 8 Garmin summaries for 7-day HRV baseline), `athleteProfile` (for annual goals). `todayStr` and `currentYear` computed before the query. After the existing load derivations, added `hrv7dValues` filter (non-null `hrvNightly`), `showReadiness` flag (true when fitness cache or Garmin data is available), and `readiness` computed via `computeReadiness()`.
- `computeReadiness(tsb, latestGarmin, hrv7d)` pure function added below `ACWRCard`: 50-point base + TSB contribution (+-8-20 pts) + HRV trend vs. 7-day baseline (+-8-25 pts) + sleep score contribution (`(score-60)/5` pts); clamped 0-100. Color: green >= 70, amber >= 45, red below. Label: "Redo" / "Moderat" / "Aterhämta".
- Today panel JSX added above `DashboardCards`: shows only when `todayPlanned.length > 0 || latestGarmin`. Header row shows formatted date + readiness badge (colored dot + score/label). If planned workouts exist, shows "Planerat idag" list with sport, duration (min), distance (km), and Planner link per workout. Garmin row shows sleep score/duration, HRV, and Body Battery. When no Garmin data, shows connect-Garmin prompt.

**Feature 1E — Annual Goal Widget:**
- `app/(dashboard)/dashboard/page.tsx`: after the nav shortcuts section, added annual goal widget. `annualGoalsRaw` cast from `athleteProfile.annualGoals` JSON. `goalsThisYear` extracted for the current year. If goals exist, fetches all YTD activities to build `ytdBySport: Record<string, number>` (distance in meters per sport type). Widget shows per-sport progress bars: ytdKm / goalKm with %, on-track status (projected km >= 95% of goal based on `dayOfYear` pace), and "prognos Xkm" forecast when off-track. Links to `/settings/profile` for editing.

**Feature 1F — Volume Period Comparison Delta Table:**
- `app/(dashboard)/stats/volume/volume-client.tsx`: `periodSummaries` useMemo extended. Each summary object now carries `km` (raw km independent of metric toggle), `sessions` (record count for the period), and `tss: 0` fields alongside existing `total`/`color`/`label`. After the existing A/B summary cards, a new delta comparison table renders (when `a.km > 0 || b.km > 0`): columns Metric / Period A / Period B / Delta A vs B. Rows: Distans (km) and Pass (sessions). The `delta()` helper shows "--" when ref is 0, otherwise `+X.X%` in accent or warning color.

---

**Session 2026-06-16 (part 2) — Mega feature session: activity matching, activity page enhancements, stats analytics, planner DnD + week panel, stream caching, coach commands, PWA, color palettes:**

**1C — Activity→Plan auto-matching:**
- `lib/fitness/activity-matching.ts` (new): intent classification into 8 categories (easy/aerobic/threshold/vo2max/long/race/strength/other) using HR fraction, sport, name keywords, zone distribution. Score = 40 (sport) + 35 (intent compat) + 15 (distance ±20%) + 10 (duration ±25%). Threshold: ≥55 confidence.
- `lib/strava/sync.ts`: `tryMatchActivity(userId, activityId)` — called fire-and-forget at end of `syncSingleActivity()`. Queries PlannedWorkouts ±1 day, runs intent matcher, writes `Activity.matchedPlannedId` if confident.

**3E/3C/3F/1B/2B — Activity page enhancements (all in `app/(dashboard)/activities/[id]/page.tsx`):**
- **GAP**: Grade Adjusted Pace shown in stats grid for runs with ≥20m/km elevation gain using existing `gradeAdjustedPace()`.
- **PB banner**: compares `bestEfforts` against `raceRecord` table by rounded distance; shows Trophy pills for any effort faster than known PB (or no existing PB).
- **Prev/Next nav**: two parallel Prisma queries for adjacent activities by `startDate`; links shown in header row.
- **Pa:HR decoupling**: `computeDrift` and `SplitWithHR` exported from `lib/fitness/decoupling.ts`; decoupling card shown for runs ≥6 splits and ≥40 min. Color-coded: <5% green, <10% amber, ≥10% red.
- **PVI**: Pace Variability Index computed from splits (std/mean × 100); shown in `SplitsTable` footer with label (Utmärkt/OK/Variabelt). `pvi` prop added to `SplitsTable`.

**Stats analytics (all in `app/(dashboard)/stats/page.tsx` + `stats-client.tsx`):**
- **Cadence trend** (1A): 26-week running cadence series (spm + stride length in m). Filters: `averageCadence > 50`, runs only. Both fast (from `recentForCurve`) and slow paths implemented. Dual-axis `ComposedChart` in stats-client.
- **EF trend** (2A): Efficiency Factor (speed m/min per bpm) for easy runs only (HR < LT1). 4-week rolling delta shown. Both fast and slow paths.
- **Monotony/Strain** (2C): current week's daily TSS array → mean/stddev → monotony (mean/stddev) → strain (total×monotony). Color-coded card.
- **Recovery days** (2F): scan load curve for TSB < -15 troughs to TSB ≥ 0 recovery, average length. Card shows avg recovery days.

**Coach (7D/7E) — `components/coach/ChatInterface.tsx` + `app/api/coach/summarize/route.ts`:**
- `/summarize` quick command: pre-fills textarea with Swedish summary prompt; does not auto-send.
- Quick commands section in tool picker: /plan, /taper, /analyze, /week, /compare — each pre-fills a structured prompt.
- Long-conversation banner at ≥20 messages (when no existing summary).
- POST `/api/coach/summarize` stub returns `{ messages: count }`.

**Activities page (9D/9F) — `app/(dashboard)/activities/page.tsx` + `activity-list.tsx`:**
- Sort dropdown: date_desc, dist_asc/desc, pace_asc/desc. Prisma `orderBy` driven by query param.
- Races-only toggle button (filters `isRace = true`). Distance range filter (`minKm`/`maxKm` params).

**Settings paceUnit + annualGoals (`app/(dashboard)/settings/athlete-profile.tsx` + `settings/profile/page.tsx` + `api/settings/profile/route.ts`):**
- `AthleteProfile.paceUnit` (`String @default("min_per_km")`): radio group (min/km, min/mi, km/h).
- `AthleteProfile.annualGoals` (`Json?`): per-sport distance goal inputs for current year. Schema: `Record<year, Record<sportName, km>>`.

**Planner DnD + week panel (`components/planner/PlannerCalendar.tsx` + `planner/planner-client.tsx`):**
- DnD: `DndContext` with `PointerSensor` (8px dist) + `TouchSensor` (500ms delay). `DraggableWorkout`/`DroppableDay` wrappers. `DragOverlay` ghost preview. `handleDndDragEnd` calls `onWorkoutMove(workoutId, targetDateStr)` which PATCHes `/api/planner/workouts/[id]` with `{ date }`.
- Week detail panel: `selectedWeek` state toggles bottom-sheet panel (mobile fixed, desktop static). Shows planned/completed counts, TSS, and completion%. `WeekSummaryStrip` receives `onClick` to toggle.
- Taper markers: scans future Race-type workouts → computes taper start (marathon: 3w, half: 2w, 10k: 1w) → shows "⚡ Taper start" chip on that calendar day.

**Stream caching + HRR (`app/api/activities/[id]/streams/route.ts`):**
- Cache-first: checks `activity.stream` relation (new `ActivityStream` DB model). Returns cached data immediately with `Cache-Control: private, max-age=604800`.
- On miss: fetches from Strava, computes HRR60 (HR drop from peak to 60 samples later), writes `ActivityStream` + `Activity.hrrSeconds` fire-and-forget.
- New schema: `ActivityStream { id, activityId @unique, fetchedAt, time/distance/altitude/heartrate/velocity/cadence/watts as Json }`.

**Infrastructure:**
- Strava token refresh race condition (`lib/strava/client.ts`): module-level `Map<string, Promise<string>>` deduplicates concurrent refresh calls.
- Backfill prioritization (`lib/strava/backfill.ts`): sorts activities recent-first within last 90 days, then older.
- PWA: `next-pwa ^5.6.0` added to dependencies; `public/manifest.json` created (name, standalone, theme, icons); manifest link in `app/layout.tsx` metadata.

**Color palettes expanded:**
- `app/(dashboard)/settings/sports/sports-manager.tsx`: `PRESET_COLORS` → 35 colors; `TYPE_COLOR_PALETTE` → 25 colors (full hue spectrum).
- `components/planner/WorkoutBuilder.tsx`: `COLOR_PALETTE` → ~32 colors by hue family.
- `components/planner/BlockEditorModal.tsx`: `PRESET_COLORS` → 30 colors.

**Prisma schema changes:** `ActivityStream` model, `Activity.hrrSeconds Int?`, `Activity.stream` relation, `AthleteProfile.annualGoals Json?`, `AthleteProfile.paceUnit String @default("min_per_km")`.

**Build:** `pnpm build --no-lint` passes clean. TypeScript fixes: explicit `r: { distanceM: number; time: number }` in raceRecords.map; `ex == null` instead of `!ex` for number comparison; explicit casts for large Promise.all tuple inference losses; `type CandidateRow` for sync.ts candidate mapping; `.catch((e: unknown) =>)` for stream caching.

---

### Session 2026-06-16 — Bug fixes, chart styling, goals page, coach tool insert

**Bug fixes:**

- **`lib/utils.ts` `formatPace`:** Round total seconds first (`Math.round(1000/speed)`) then `Math.floor/mod 60` — prevents "3:60" output when `secPerKm % 60 = 59.5` rounded up.
- **`app/(dashboard)/activities/[id]/page.tsx` Pa:HR decoupling labels:** Made sign-aware. Negative drift (second half more efficient) shows "Negativ split — bättre effektivitet i andra halvlek" (accent color) instead of "High drift" warning. Positive >10% = error, positive 5–10% = warning, negative < -10% = warning-yellow, else accent.
- **`app/(dashboard)/stats/page.tsx` training monotony fast path:** Was using `fpDailyTSSMap` (`act.trainingLoad ?? 0`), meaning null trainingLoad → 0 TSS all 7 days → stddev=0 → monotony=null → card hidden. Fixed: fast path now reads from `curveTSSMap` (built with `computeTSS` HR-based fallback) for the current week's daily TSS.
- **`app/(dashboard)/stats/stats-client.tsx` EF delta comparison:** Label said "vs 4–8 veckor sen" but code used `efByWeek.slice(0, 4)` (oldest 4 weeks). Fixed to `efByWeek.slice(-8, -4)`. Guard now requires `efByWeek.length >= 8`.
- **`app/(dashboard)/planner/planner-client.tsx` week panel:** Previous change added an inline week detail bottom-sheet panel and `onWeekClick` prop that overrode `WeekSummaryStrip`'s native navigation to `/planner/week`. Removed `selectedWeek` state, `handleWeekClick`, `selectedWeekStats`, `onWeekClick` prop, panel JSX, and unused `startOfWeek` import. Clicking a week strip now navigates to `/planner/week` again.
- **GAP threshold (`activities/[id]/page.tsx`):** Changed from `elevGainPerKm >= 20` to `elevGainPerKm >= 10` so GAP shows on more activities.
- **PB markers removed** from activity detail page: removed `raceRecords` query, `pbMap`, `newPBs` array, and PB banner JSX entirely. `Mountain` icon import also removed.

**Chart styling (`app/(dashboard)/stats/stats-client.tsx`):**
- Cadence chart (`ComposedChart`): added `CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}`, styled `XAxis`/`YAxis` ticks with `fill: var(--text-muted)`, `axisLine: false`, `tickLine: false`, formatted X labels as `MM-DD`, added styled `Tooltip` with surface background.
- EF chart (`LineChart`): same grid/axis/tooltip treatment. Both now match the style of volume/history charts.
- Added `CartesianGrid` to recharts import.

**Recovery days explanation (`app/(dashboard)/stats/stats-client.tsx`):** Added a second paragraph below the metric value explaining what "recovery days" means: TSB dropping below −15 = fatigue state, days to return to neutral = recovery profile.

**Coach tool picker (`components/coach/ChatInterface.tsx`):**
- `selectTool(name)` now inserts `/${primaryTool} ` (with trailing space) instead of the full hint template. Multi-tool names (e.g. `get_upcoming_plan + delete_workout`) take only the first tool.
- Tool button `onClick` changed from `selectTool(tool.hint)` to `selectTool(tool.name)`.
- Preset commands (/plan, /taper, /analyze, /week, /compare): renamed `name` fields from `preset_plan` etc. to `plan`/`taper`/`analyze`/`week`/`compare`; removed `hint` field; `onClick` now uses `tool.name`. Hint column in button row replaced with `/${tool.name}` display.

**New: Training Goals feature:**
- **`prisma/schema.prisma`:** Added `TrainingGoal` model (`userId`, `sport String @default("")` where `""` = all sports, `metric` distance/time, `period` week/month/year, `target Float`). Unique constraint on `(userId, sport, metric, period)`. Added `trainingGoals TrainingGoal[]` to `User`. Added `paceUnitBySport Json?` to `AthleteProfile` for per-sport pace unit overrides.
- **`app/api/settings/goals/route.ts`:** GET (list), POST (upsert by sport+metric+period), DELETE (by id with userId guard).
- **`app/(dashboard)/settings/goals/page.tsx` + `goals-manager.tsx`:** Client component with sport/metric/period/target selectors; shows existing goals grouped by period+metric; delete button per goal; add goal form.
- **`components/settings/settings-nav.tsx`:** Added "Goals" tab linking to `/settings/goals`.
- **`app/(dashboard)/dashboard/page.tsx`:** Fetches `trainingGoal` records; computes per-sport per-period km/min aggregates from activities since `weekStart` (includes all three periods); renders progress bars with 80% threshold for "on-track" (accent), 50–80% neutral (blue), <50% warning. Links to `/settings/goals`.
- **`app/api/settings/profile/route.ts`:** Added `paceUnitBySport` to schema (validates `Record<string, "min_per_km"|"min_per_mi"|"km_h">`).

**Schema changes:** `TrainingGoal` model added, `AthleteProfile.paceUnitBySport Json?` added. Requires `prisma db push` on production.

---

### Session 2026-06-17 — Garmin in-app integration (unofficial OAuth2 SSO) + security audit

**Replaced Python sidecar + official OAuth with full TypeScript in-app Garmin authentication.**

Design: Users enter their Garmin Connect email/password once in Settings → we authenticate via Garmin's unofficial SSO and store only the resulting OAuth2 Bearer tokens (encrypted). Email/password never persisted.

**`prisma/schema.prisma`:**
- `GarminAccount`: added `displayName String?` (Garmin username, needed as path param in Connect API URLs).
- `schema.prisma` touched → requires `prisma generate + prisma db push` on prod.

**`lib/garmin/auth.ts`** (new):
- `loginWithGarmin(email, password)` — full SSO → OAuth2 flow:
  1. GET `sso.garmin.com/sso/signin` → extract `_csrf` hidden field
  2. POST credentials → Garmin SSO redirects with `ticket=ST-...` in Location header
  3. GET `connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=...` with OAuth1-signed consumer auth → OAuth1 token pair
  4. POST `connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0` with OAuth1 token → OAuth2 `{access_token, refresh_token, expires_in}`
  5. GET `connectapi.garmin.com/userprofile-service/userprofile/personal-information` → `displayName`
- `refreshGarminTokens(refreshToken)` — refresh via Basic auth with consumer credentials; returns new `{accessToken, refreshToken, expiresAt}`.
- `fetchDisplayName(accessToken)` — exported helper; returns null on failure (non-fatal).
- Uses hardcoded Garmin Connect Mobile consumer key/secret (same as garth Python library; publicly embedded in Garmin's Android/iOS app; not our credentials).
- Throws `GARMIN_INVALID_CREDENTIALS` or `GARMIN_MFA_REQUIRED` (MFA not supported — user must disable 2FA in Garmin account).
- Cookie jar tracks SSO session across redirect chain. No external HTTP libraries.
- OAuth1 signing (HMAC-SHA1 per RFC 5849) implemented from scratch using Node.js `crypto`.

**`lib/garmin/client.ts`** (rewrote):
- Removed all official OAuth functions (`getGarminAuthUrl`, `exchangeGarminCode`, `garminFetch`).
- `getGarminToken(userId)` — reads GarminAccount, decrypts with `safeDecrypt`, returns valid token. If within 60 s of expiry, calls `refreshGarminTokens()` and stores new tokens (encrypted). Throws `GARMIN_NOT_CONNECTED` if no account.
- `garminConnectFetch(userId, path, params?)` — builds URL for `connectapi.garmin.com{path}`, fetches with Bearer token.

**`lib/garmin/sync.ts`** (rewrote):
- Uses `connectapi.garmin.com` endpoints (unofficial Connect API, not Wellness API):
  - `/usersummary-service/usersummary/daily/{dn}` → restingHR, bodyBattery, respirationRate, stressAvg, steps
  - `/wellness-service/wellness/dailySleepData/{dn}` → sleepScore, sleepDuration, sleepDeep, sleepLight, sleepRem, sleepAwake
  - `/hrv-service/hrv/{dn}` → hrvNightly (RMSSD ms), hrvBalance ("Balanced"/"Low"/"Unbalanced")
  - `/metrics-service/metrics/trainingreadiness` → trainingReadiness (0–100)
  - `/wellness-service/wellness/user/daily-wellness/spo2/details` → spo2Avg
- All 5 fetches wrapped in `Promise.all` with per-call error suppression (`safe()` wrapper) — partial data is better than no data.
- Sleep score field name varies across Garmin firmware → tries "sleepScores", "overallScore", "sleepScore" in order (matches Python sidecar logic).
- `syncGarminDaily(userId)` returns early if no account or no displayName.

**`app/api/garmin/connect/route.ts`** (new):
- `POST {email, password}` → calls `loginWithGarmin()` → stores encrypted tokens + displayName via `prisma.garminAccount.upsert()`.
- Rate-limited at 5 attempts / 10 min per userId (avoids triggering Garmin IP bans).
- Zod validation: email max 254, password max 256 chars.
- Returns `{ok: true, displayName}` on success; `{error: "invalid_credentials"|"mfa_required"|"too_many_attempts"|"auth_failed"}` on failure.
- Email/password never logged or stored.

**`app/api/garmin/disconnect/route.ts`** (new):
- `POST` → `prisma.garminAccount.deleteMany({where: {userId: session.user.id}})`. Requires valid session.

**`app/api/garmin/callback/route.ts`** (stripped):
- Old official OAuth callback. Now just redirects to `/settings`. Kept to avoid broken bookmarks.

**`app/(dashboard)/settings/garmin-connect.tsx`** (rewrote):
- Replaced OAuth button + admin-only credential form with an email/password form available to all users.
- Shows connected state with displayName + "Sync now" / "Disconnect" buttons.
- "Sync now" POSTs to `/api/garmin/sync`. 
- User-friendly error messages for invalid creds, MFA required, rate limit.
- Password is never echoed; show/hide toggle.
- Note displayed: "Your password is used only once to obtain a long-lived token and is never stored."

**`app/(dashboard)/settings/page.tsx`** (updated):
- Removed `getGarminAuthUrl` import and Garmin OAuth URL generation.
- GarminAccount query now only selects `displayName` (not tokens — never sent to client).
- Passes `{connected, displayName}` to `<GarminConnectSection>`.

**Security audit — 6 rounds:**
1. Credential logging: no email/password appears in any log/error message. Error messages are safe strings.
2. Authorization: all 3 new routes guard with `auth()` + `session?.user?.id` check before any DB access.
3. Encryption: all token writes use `encrypt()`, all reads use `safeDecrypt()`. DB never stores plaintext.
4. Cross-user isolation: all DB queries filter by `session.user.id`; no user-supplied userId accepted.
5. AES-256-GCM integrity: auth-tag mismatch on tampered ciphertext causes `safeDecrypt()` → null → explicit error.
6. No tokens in HTTP responses: Settings page selects only `displayName`; cron selects only `userId`.

**What still uses the Python sidecar:** Nothing — it's now obsolete. The `scripts/garmin_sync.py` file can be deleted or kept as a fallback for emergency backfill. The cron at 08:00 in `lib/cron.ts` already calls `syncGarminDaily()` (TypeScript).

**Deployment notes:** Schema changed — run the longer deploy command with `prisma generate + prisma db push`.

---

### Session 2026-06-17b — Garmin gap handling + double daily sync

**`lib/garmin/sync.ts`:**
- `upsert` update clause now uses COALESCE behavior: only updates fields with non-null values. A sync that returns null for a field (e.g. sleep not available because watch wasn't worn, or readiness not yet processed) no longer overwrites previously stored data for that day. `create` still stores all fields (including null) for new records.
- This handles the case where the user wears the watch only some nights — existing sleep/HRV data is preserved even when a subsequent sync for the same date can't fetch it.

**`lib/cron.ts`:**
- 08:00 cron now passes `yesterday` explicitly to `syncGarminDaily()`. Garmin processes overnight sleep/HRV data and makes it available by morning under the previous day's calendar date. Syncing `new Date()` at 08:00 was reading the wrong date.
- New 20:00 cron syncs TODAY (steps, body battery, stress, readiness accumulated during the day) AND yesterday again (training readiness and other fields can arrive late by several hours).

**`app/(dashboard)/dashboard/page.tsx`:**
- `garmin7d` query now bounded to a 14-day date window (`date >= now - 14d`) with `take: 10`, preventing HRV trend from using month-old values when the user skips wearing the watch for several days.
- `garminDateLabel(garminDate, now)` helper added — returns "Today" / "Yesterday" / "N days ago". Shown as a dim prefix on the Garmin metrics row so the user can see data age when nights are skipped.

### Session 2026-06-17c — Garmin SSO MFA false-positive fix

**`lib/garmin/auth.ts`:**
- MFA detection rewritten: now looks for actual OTP `<input>` fields (`name="mfaCode"`, `name="otpCode"`, `name="totpCode"`, or matching `id` attributes) rather than scanning page text for "MFA"/"two-factor". Garmin's normal login page contains "Two-Factor Authentication" as a UI menu option even when 2FA is disabled, causing false positives with the old regex.
- Added `BROWSER_HEADERS` constant with a realistic Chrome 131 `User-Agent`. Garmin's SSO bot-detection can return a non-standard page (e.g. a CAPTCHA or stripped login) when it sees a minimal UA — the browser headers prevent this.
- CSRF extraction now tries four attribute-order patterns (`name="_csrf" value=...`, `value=... name="_csrf"`, `<input ... name="_csrf" ... value=...>`, `<input ... value=... name="_csrf">`), because Garmin's HTML attribute ordering is not guaranteed to stay stable.
- `fetchSsoPage` updated to send `BROWSER_HEADERS` on the initial GET.
- `submitCredentials` updated to send `BROWSER_HEADERS` plus `Origin` and `Referer` on the credential POST, matching what a real browser submits.
- Server-side logging added for both failed-login (first 400 chars of SSO response body) and CSRF-not-found (first 500 chars of SSO page). No credentials appear in these logs.

**Bug note:** The "Garmin 2-factor authentication must be disabled" error was a false positive. The user's account had 2FA disabled. The old regex `/mfaCode|MFA|verificationCode|two-factor/i` matched the string "Two-Factor Authentication" that appears as a settings link on Garmin's standard login page HTML.

---

### Session 2026-06-17d — AI Coach full overhaul

Deep architectural overhaul of the AI coaching system. Full plan in `docs/planning/COACH_OVERHAUL_PLAN.md`.

**`prisma/schema.prisma`:**
- `AISettings.coachLanguage String @default("sv")` — persists the coach's language preference to DB (no more reset-on-refresh).
- New `CoachEdit` model with `previousStateJson`, `newStateJson`, `entityId`, `entityType`, `status`, `undoneAt` — enables undo of all write tool operations within the same message turn.
- `User.coachEdits CoachEdit[]` relation added.

**`app/api/settings/ai/route.ts`:**
- Added `PATCH` handler (same logic as `POST`) so the frontend can persist `coachLanguage` without overwriting all other settings.
- `coachLanguage: z.enum(["sv", "en"]).optional()` added to schema.
- All fields are now optional and only non-undefined fields are written to DB (safe partial update).

**`lib/ai/tools.ts`** — Full rewrite:
- **30 tools total** (was 12): 22 read + 8 write.
- New read tools: `get_activity_stream` (second-by-second analysis with HR drift, pace volatility), `get_wellness_history` (Garmin day-by-day for any date range), `get_volume_stats` (weekly km/h from cache, falls back to live query), `get_zone_distribution` (Z1–Z5 from cache + Seiler 3-zone), `get_workout_templates` (all templates with sections), `get_workout_types` (user-defined sports + types), `get_training_goals` (with real-time progress %), `get_athlete_profile`, `get_segment_history` (via Strava API with live token refresh), `web_search` (Tavily API, 1000 free/month), `weather_forecast` (Open-Meteo, free, no key), `search_training_research` (PubMed Entrez, free).
- New write tools: `update_workout`, `delete_workout`, `create_training_block`, `update_training_block`, `log_race_result`, `delete_race_result`, `update_activity_notes`, `update_profile`.
- All write tools: (1) guard by `userId` check before writing, (2) save a `CoachEdit` record with `previousStateJson` for undo.
- All tool result strings are English (model-facing).
- `WRITE_TOOLS` set updated with all 8 write tools.
- `ToolResult` interface gains `editId?: string`.
- `executeCoachTool` signature: `(toolName, input, userId, conversationId)`.
- `get_activities_in_range`: two-phase — first call with `confirmed=false` returns activity count + estimated cost; only fetches full data with `confirmed=true`. Hard cap at 500 activities.
- `get_fitness_summary`: now includes recent weekly volume (last 8 weeks) and polarization data.
- External tool executors: Tavily (web_search), Open-Meteo (weather_forecast), PubMed Entrez (search_training_research).

**`lib/ai/prompts.ts`:**
- `CoachContext` interface gains `recentSessions?: string` and `weeklyVolume?: string`.
- System prompt: new "Recent training sessions" and "Weekly volume" blocks populated from context.
- Tool use section completely rewritten: descriptive list of all 30 tools split into read/write, no prescriptive "NEVER use X" language, note about parallel multi-step tool calls.
- Language instruction strengthened: "regardless of the language of this prompt."
- Removed prescriptive coach instructions about JSON plan-action blocks (no longer used).

**`lib/ai/context-builder.ts`:**
- `buildCoachContext` now fetches 5 most recent activities and builds `recentSessions` text (date, name, sport, distance, time, HR, pace, description excerpt).
- `weeklyVolume` populated from `fitnessCache.weeklyVolumeJson` — last 8 weeks of km+hours.
- Both fields added to the returned `CoachContext` object.

**`app/api/coach/chat/route.ts`** — Agentic loop:
- Request schema: `approvedTool`/`approvedInput` instead of `approvedAction` (tool name + input for user-approved write); `approvedEditId` accepted but unused server-side.
- Language now read from `aiSettings.coachLanguage` (DB) as default, `language` param in request is still accepted as an override.
- **Claude provider: full agentic loop** — up to 6 iterations. Each iteration: call Claude with all 30 tools; extract all `tool_use` blocks; if any write tool appears → pause loop and emit `pending` event; otherwise execute all read tools in parallel via `Promise.all`; append `tool_result` blocks in one user message; continue. After loop: stream final answer with full conversation context.
- **Gemini/NVIDIA/Groq**: single tool call (unchanged architecture, improved payload handling).
- Multiple `toolCall` SSE events emitted (one per tool call in the agentic loop), not just one per message.
- Helper functions extracted: `saveAssistantMessage`, `updateSpend`, `describeAction`.
- `recentActivities` parameter removed from `aiClient.stream()` call for non-Claude providers (context now in system prompt via context-builder).

**`app/api/coach/undo/[editId]/route.ts`** — NEW:
- `POST /api/coach/undo/[editId]`: looks up `CoachEdit`, verifies `userId`, calls `applyRestore()`, marks as `undoneAt`.
- `applyRestore()` switches on `toolName`: create → delete restored entity; update/delete → upsert previous state; `update_activity_notes` → restore description; `update_profile` → upsert previous profile.
- Returns 409 if already undone.

**`app/(dashboard)/coach/page.tsx`:**
- Reads `aiSettings.coachLanguage` and passes as `initialLanguage` prop to `ChatInterface`.

**`components/coach/ChatInterface.tsx`:**
- `Message.toolAction` → `Message.toolActions?: ToolAction[]` (accumulates multiple tool calls per message from the agentic loop).
- `useState("en")` → `useState(initialLanguage)` — no longer resets to English on page load.
- Language toggle now calls `PATCH /api/settings/ai` with `coachLanguage` to persist to DB.
- `sendWithPayload` uses `approvedTool`/`approvedInput` fields matching new API schema.
- `ToolActionCard` updated: shows `TOOL_LABELS` Swedish label per tool name; write tool completed cards show "Ångra" button; undo calls `POST /api/coach/undo/[editId]`; undo locked when next user message is sent.
- `lockedEditIds: Set<string>` — populated on `sendWithPayload`; prevents undo after next turn.
- `undoneEditIds: Set<string>` — marks undone edits with visual strike-through + "ångrad" indicator.
- `TOOL_LABELS` map: 29 Swedish labels covering all tools.
- Tool picker: all 22 read + 8 write tools listed with Swedish labels and descriptions; language toggle row now says "Svarsspråk" and "Sparas i dina inställningar".
- Quick-prompts: language-aware — Swedish when `language === "sv"`, English otherwise.
- Comparison prompt added: "Jämför nu mot ett år sedan" / "Compare now vs a year ago".

**External APIs added:**
- `TAVILY_API_KEY` env var required for `web_search` (free tier: 1,000 searches/month at tavily.com).
- Open-Meteo: free, no key needed. Location derived from most recent activity with GPS coords.
- PubMed Entrez: free, no key needed. Rate limit: ~3 req/s.
- Strava segment history: uses existing OAuth tokens from `StravaAccount`, refreshes if expired.

**Security constraints maintained:**
- `userId` always from server session, never from AI input or tool input.
- All DB write guards check `existing.userId !== userId` before writing.
- No AI-facing tools expose `AppConfig`, `User.passwordHash`, `AISettings` API keys, or `Session`.
- Garmin email/password never stored; only encrypted OAuth2 tokens in `GarminAccount`.

---

### Session 2026-06-17e — Garmin auth: bot-detection fix + embed endpoint

**Context:** Server-side Garmin SSO POST was returning 403 despite correct credentials. Root cause confirmed via `/api/garmin/diagnose`: SSO page loads fine (200, CSRF found), but the credential POST is blocked by Garmin's bot-detection on datacenter IPs.

**Attempts and outcome:**

1. **Browser-redirect OAuth (tried, failed):** Built full OAuth redirect architecture — `getGarminAuthUrl(callbackUrl)` in `lib/garmin/auth.ts`, `app/api/garmin/callback/route.ts` rewritten to exchange service ticket → OAuth1 → OAuth2, `GarminConnectSection` rewritten with primary "Connect with Garmin" `<a>` link + collapsible manual fallback. Failed because Garmin's CAS SSO whitelist only allows `connect.garmin.com` as service URL — custom callback URLs are silently rejected (user stays on Garmin's login page with no error).

2. **`/sso/embed` + mobile UA (current approach):** The `garth` Python library (used by garminconnect 0.2.x) authenticates successfully from server IPs by using `/sso/embed` instead of `/sso/signin`, and `com.garmin.android.apps.connectmobile` as the User-Agent. Applied the same approach to TypeScript.

**`lib/garmin/auth.ts`:**
- `SSO_EMBED` constant: `${SSO_BASE}/embed`.
- `BROWSER_HEADERS["User-Agent"]` changed to `com.garmin.android.apps.connectmobile` (Garmin's Android app UA).
- Removed `Sec-Fetch-*` headers (not sent by mobile apps, would look suspicious with a mobile UA).
- `fetchSsoPage` GETs `SSO_EMBED` instead of `/sso/signin`; returns `{html, url}` (URL needed as Referer on POST).
- `submitCredentials(html, ssoPageUrl, email, password)` POSTs to `SSO_EMBED` with `ssoPageUrl` as Referer.
- `loginWithGarmin` passes the returned URL from `fetchSsoPage` into `submitCredentials`.
- 403 response from Garmin SSO credential POST now throws `GARMIN_BLOCKED` (not `GARMIN_INVALID_CREDENTIALS`).

**`app/api/garmin/connect/route.ts`:**
- `GARMIN_BLOCKED` → `server_blocked` error code in response.
- Settings UI maps `server_blocked` to: "Garmin blocked the server request (bot-detection). Try the OAuth button above instead."

**`app/api/garmin/diagnose/route.ts`** (new):
- `GET` → calls `diagnoseSsoPage()` (exported from `lib/garmin/auth.ts`) → returns JSON with `ssoReachable`, `ssoStatus`, `csrfFound`, `loginFormFound`, `mfaChallengeFound`. Diagnostic tool for SSO connectivity issues.

**`app/(dashboard)/settings/garmin-connect.tsx`:**
- Props now include `garminAuthUrl: string` (primary "Connect with Garmin" `<a>` link prepared for OAuth redirect; collapsible "Connect manually instead" form is the actual working path).
- Handles `?garmin=connected`, `?garmin=error`, `?garmin=no_ticket` URL params from callback redirect.
- Sync time updated to 20:00 in connected state description. All text in English.

**`app/(dashboard)/settings/page.tsx`:**
- Imports `getGarminAuthUrl` from `lib/garmin/auth`, constructs `garminAuthUrl`, passes as prop.

**`app/api/garmin/callback/route.ts`:**
- Full service-ticket exchange implementation: reads `?ticket=ST-...`, calls `ticketToOAuth1` → `oauth1ToOAuth2`, stores encrypted tokens, redirects to `/settings?garmin=connected`. Ready for if/when Garmin whitelist allows our callback URL.

**`app/(dashboard)/settings/ai-settings.tsx`:**
- `hasTavilyKeyLocal` state: badge "✓ Registered" shows immediately after save (no page refresh needed).
- Tavily section text changed from Swedish to English.

---

### Session 2026-06-17f — Garmin auth complete rework: iframe SSO + mobile JSON API

**Root cause of all previous failures:** garth library was deprecated March 27, 2026 (matin/garth v0.8.0). Garmin changed their SSO flow; the `/sso/embed` HTML form flow no longer creates new logins. Our TypeScript implementation copied garth's approach, which is why all server-side attempts fail regardless of endpoint parameters.

**New architecture (two-strategy cascade):**

**Strategy 1 — Browser iframe SSO (primary, guaranteed to bypass bot-detection):**
- Settings page hosts `https://sso.garmin.com/sso/embed?embedWidget=true&service=https://training.helgars.se/api/garmin/ticket-receiver&...` in an `<iframe>`.
- User logs in inside the iframe — from their home IP, with genuine browser TLS fingerprint, real cookies. Cloudflare/Garmin bot-detection cannot trigger.
- After login, Garmin redirects the iframe to `https://training.helgars.se/api/garmin/ticket-receiver?ticket=ST-...`.
- Ticket-receiver returns minimal HTML: `<script>window.parent.postMessage({garminTicket: "ST-..."}, "*")</script>`.
- Parent Settings page receives the postMessage and POSTs the ticket to `/api/garmin/exchange-ticket`.
- Server exchanges ticket → OAuth1 → OAuth2 (pure API call, different detection rules, not bot-blocked).
- Tokens stored encrypted; page shows "✓ Connected as [name]".

**Strategy 2 — Mobile JSON API (server-side fallback):**
- If iframe is blocked or unavailable: `GET sso.garmin.com/mobile/sso/en/sign-in` (session cookies) → 2–5 s anti-WAF delay → `POST sso.garmin.com/mobile/api/login?clientId=GCM_ANDROID_DARK&...` with JSON body.
- Returns `{serviceTicketId: "ST-...", responseStatus: {type: "SUCCESSFUL"}}`.
- iPhone UA (`Mozilla/5.0 (iPhone; CPU iPhone OS 18_7...)`) on both requests.
- Falls back further to old `/sso/embed` HTML form if mobile API also fails.
- All three server-side paths propagate `GARMIN_INVALID_CREDENTIALS` and `GARMIN_MFA_REQUIRED` immediately without trying fallbacks.

**`app/api/garmin/ticket-receiver/route.ts`** (new):
- `GET ?ticket=ST-...` → returns HTML that postMessages `{garminTicket}` to parent.
- `GET ?error=...` → postMessages `{garminError}` to parent.
- Sets `X-Frame-Options: ALLOWALL` + `Content-Security-Policy: frame-ancestors *` so it can load inside an iframe served by our domain.

**`app/api/garmin/exchange-ticket/route.ts`** (new):
- `POST {ticket: "ST-..."}` (requires valid session; userId always from server session).
- Calls `ticketToOAuth1` → `oauth1ToOAuth2` → `fetchDisplayName` → `prisma.garminAccount.upsert` with encrypted tokens.
- Returns `{ok: true, displayName}`.

**`lib/garmin/auth.ts`:**
- `loginWithMobileApi(email, password)` — new function. GETs sign-in page, delays 2–5 s, POSTs JSON credentials, parses `serviceTicketId` from response. Returns ticket string.
- `loginWithGarmin(email, password)` — now calls `loginWithMobileApi` first; on non-credential failure falls back to `/sso/embed` HTML form (old strategy).
- `sleep()` helper added for anti-WAF delays.

**`app/(dashboard)/settings/garmin-connect.tsx`** (rewritten):
- Props: `{ connected, displayName, garminAuthUrl, origin }`. `origin` used to build iframe embed URL.
- Primary button: "Connect with Garmin" → shows iframe with Garmin SSO embed.
- `useEffect` listens for `message` events; on `{garminTicket}` calls `exchangeTicket()` which POSTs to `/api/garmin/exchange-ticket`.
- Collapsible manual form remains as ultimate fallback (calls `/api/garmin/connect`).
- `loading` state shown over connected UI while ticket exchange is in progress.

**`app/(dashboard)/settings/page.tsx`:**
- Passes `origin` prop to `GarminConnectSection`.

**`docs/integrations/strava.md`:**
- Garmin section rewritten to reflect new two-strategy auth, sync schedule, and that garth is deprecated.

**Plan document:** `docs/planning/GARMIN_AUTH_REWORK_PLAN.md` created with full research findings and architecture rationale.

---

### Session 2026-06-17h — Garmin SSO: fixed `consumeServiceTicket` so the iframe actually redirects to `ticket-receiver`

**Symptom:** After logging in inside the iframe, the user saw the raw `{serviceUrl, serviceTicket}` object rendered as plain text on `sso.garmin.com/sso/embed?ticket=ST-...` instead of the page completing the connection.

**Root cause:** `buildEmbedUrl()` in `garmin-connect.tsx` set `consumeServiceTicket: "false"` since the iframe-SSO rework was first written (Session 2026-06-17f) — never revisited. This CAS-widget param controls whether the embed widget redirects the iframe to the `service` URL with the ticket appended (consuming it) versus just displaying the ticket as text for the host to grab some other way. `"false"` meant Garmin never redirected to our `/api/garmin/ticket-receiver`, so that route's (correct, same-origin) `postMessage` never had a chance to fire — explaining the prior session's debug finding that "postMessage never reaches our listener."

**Fix:** `app/(dashboard)/settings/garmin-connect.tsx` — `consumeServiceTicket: "false"` → `"true"`. This did **not** fix the symptom (see next session) but is left in place since it's the semantically-correct value.

---

### Session 2026-06-17i — Garmin SSO: confirmed iframe/postMessage hand-off is dead, replaced with manual ticket paste

**Confirmed root cause (the real one):** the `consumeServiceTicket` fix had zero effect — same symptom, different ticket value. Asked the user to check two things: (1) does the whole browser tab navigate away from training.helgars.se, or does the text stay contained inside the iframe box, and (2) does the small DEBUG postMessage line ever render. Answers: the **whole tab navigates away** to `sso.garmin.com`, and the DEBUG line never appears because the page is destroyed before React can render it.

This means Garmin's `/sso/embed` widget does not honor our `service`/`redirectAfterAccountLoginUrl` params at all (likely whitelist-rejected — only `connect.garmin.com`-style URLs are accepted, exactly the risk flagged in `GARMIN_AUTH_REWORK_PLAN.md`'s "Unknowns" section back in Session 2026-06-17f). Instead it consumes the ticket against **itself** (`serviceUrl: 'https://sso.garmin.com/sso/embed'`) and the whole page escapes any iframe/popup framing to show the result — so `/api/garmin/ticket-receiver` is never reached and no `postMessage` ever arrives at our listener, regardless of iframe vs. popup vs. `consumeServiceTicket` value. No client-side param can fix a server-side whitelist we don't control.

Also tried the manual email+password fallback as a quicker alternative — failed with `auth_failed` ("Server-side authentication failed"), so the mobile-JSON-API/HTML-form server-side cascade in `lib/garmin/auth.ts` is currently not working either (not investigated further this session; PM2 logs would be needed, which requires the user to SSH in themselves).

**Fix — manual ticket paste, since the ticket itself is valid and the exchange endpoint works:**
- `app/(dashboard)/settings/garmin-connect.tsx` rewritten:
  - Removed the `useEffect` postMessage listener, `showIframe`/`iframeLoaded`/`debugMsg` state, and the `<iframe>` block entirely — all dead code now that the hand-off is confirmed unreachable.
  - "Connect with Garmin" now shows: a link that opens the same `embedUrl` in a real new tab (`target="_blank"`) instead of an iframe, plus a text input + "Connect" button. User logs in on Garmin's own page, copies the `ST-...` value Garmin displays, pastes it in, and we POST it to the already-working `/api/garmin/exchange-ticket`.
  - `exchangeTicket()` unchanged (still calls the same endpoint); on success now also resets the ticket form state.

**Now likely dead code (not removed, low risk to leave):** `app/api/garmin/ticket-receiver/route.ts` is no longer reachable from the new flow since Garmin never redirects there. Left in place in case Garmin's whitelist behavior changes or it's useful again later — but if revisiting this area, this route can likely be deleted.

---

### Session 2026-06-18a — Garmin SSO: found and fixed the real exchange bugs, first confirmed working connection

User reported the ticket-paste flow still failed with "Token exchange failed" using a real, freshly-pasted ticket. Investigated `lib/garmin/auth.ts`'s `ticketToOAuth1`/`oauth1ToOAuth2` (the part of the chain shared by *every* Garmin auth strategy this project has tried — manual email/password, mobile JSON API, and the new ticket-paste flow all funnel through these two functions) and found two real bugs, both present since the very first Garmin auth commit:

1. **`ticketToOAuth1`'s `login-url` param** was `` `${SSO_BASE}/sso/login` `` = `https://sso.garmin.com/sso/sso/login` — a literal 404 (duplicated `/sso/` segment; `SSO_BASE` already ends in `/sso`). Confirmed via web research against two independent, currently-working community implementations (a Playwright-based Garmin OAuth gist and the `garmin-givemydata` project) that the correct value is `https://sso.garmin.com/sso/embed` (the actual SSO embed URL the ticket was issued against).
2. **`oauth1ToOAuth2`'s POST** to `/oauth-service/oauth/exchange/user/2.0` sent no `Content-Type` header at all when there was no `mfa_token` to forward (which is always, for this non-MFA account) — Garmin's server returns `415 Unsupported Media Type` for that. It requires `Content-Type: application/x-www-form-urlencoded` even with an empty body.

**Verification:** rather than guessing and redeploying repeatedly, tested both fixes directly from the dev machine against the real Garmin API, using a fresh ticket the user pasted into chat (tickets are short-lived/low-sensitivity, unlike credentials). First attempt (only the `login-url` fix) got past step 1 but hit the `415` on step 2; added the `Content-Type` fix and retested using the same OAuth1 token (confirmed it isn't single-use within the test window) — got a real `access_token`/`refresh_token` and successfully called Garmin's `userprofile-service` with it, returning the account's actual profile (email, VO2max, etc.). This is the first confirmed successful Garmin token exchange across this entire multi-day debugging saga.

**Fix:** `lib/garmin/auth.ts` — `login-url` now uses the existing `SSO_EMBED` constant; `oauth1ToOAuth2` always sets `Content-Type: application/x-www-form-urlencoded` (previously only when forwarding `mfa_token`). Also added: `ticketToOAuth1` now returns and forwards an optional `mfa_token` from the preauthorized response (matches the verified reference implementations; not exercised by this account since 2FA is disabled, but needed for protocol correctness) — propagated through `oauth1ToOAuth2`, `/api/garmin/exchange-ticket/route.ts`, `/api/garmin/callback/route.ts`, and `loginWithGarmin()`. Also added the `BROWSER_HEADERS` (Android UA) to both requests, matching what the verified-working reference implementations send.

**Alternatives researched and rejected this session** (full detail in `GARMIN_AUTH_REWORK_PLAN.md`): official Garmin Health API (business/commercial-only, no individual tier), exist.io (webhook-only, no HRV), Spike API / Open Wearables (B2B-priced wearable data aggregators). Documented server-side browser automation (Playwright/SeleniumBase, as used by the community `garmin-givemydata` project) as a Plan B if the SSO embed widget itself ever stops working — not implemented since the direct fix above already works.

**Not yet done:** the fix has only been verified via a standalone Node script hitting Garmin's real API directly from the dev machine, bypassing the app/DB entirely (proves the Garmin-side protocol is now correct). It has **not yet been verified through the actual deployed `/api/garmin/exchange-ticket` route and Prisma `GarminAccount` upsert** — needs a real deploy + one more live ticket-paste attempt to confirm end-to-end.

---

### Session 2026-06-18b — New Stats "Recovery" tab: HRV, sleep, resting HR and Garmin wellness trend charts

With the Garmin exchange finally working (previous session), `GarminDailySummary` data was only ever displayed as a single "today" snapshot row on the Dashboard — no historical trend anywhere, even though the original master spec (this file, "Recovery & Health" section) called for HRV/sleep/resting-HR trend charts from the start. `app/(dashboard)/stats/page.tsx` already queried 30 days of `garminRecent` but only used it for one fallback value (`restingHR` for HR-zone calc) — the rest was unused.

**Added — new "Recovery" tab on the Stats page** (`app/(dashboard)/stats/stats-client.tsx`, between "Load" and "Zones"), with 4 cards, all 16-week views (widened the existing `garminRecent` query in `stats/page.tsx` from 30 to 112 days):
- **Sleep stages & score** (`components/charts/SleepTrendChart.tsx`) — stacked area of deep/light/REM/awake hours with sleep score overlaid on a secondary 0–100 axis.
- **HRV trend** (`components/charts/HrvTrendChart.tsx`) — nightly HRV line, dots colored by Garmin's own `hrvBalance` field (Balanced/Low/Unbalanced) rather than a recomputed baseline, since Garmin already provides that classification.
- **Resting heart rate trend** (`components/charts/RestingHRTrendChart.tsx`) — line chart with a dashed reference line at the period average.
- **Body Battery, stress & readiness** (`components/charts/GarminWellnessChart.tsx`) — 3-line 0–100 chart combining fields that didn't exist when the original spec was written.

Each card shows a "No … data yet" / "Connect Garmin in Settings" message when `garminWellness` is empty, instead of an empty chart.

**Data plumbing:** new exported `GarminWellnessPoint` type in `stats/page.tsx` (date string + the relevant `GarminDailySummary` fields, sleep stage seconds converted to hours); computed once from the widened `garminRecent` query and threaded through `renderStats(...)` (added as a new final parameter at both call sites — fast-cache-path and slow-path — since they were already positional) down to `<StatsClient>`.

**New tooltips** in `lib/fitness/tooltips.ts`: `hrvTrend`, `sleepTrend`, `restingHRTrend`, `garminWellness` (reused the existing spec's tooltip copy for the first three; wrote new copy for the Body Battery/stress/readiness one, which wasn't in the original spec).

**Verification:** `pnpm build --no-lint` passes (had to add an explicit parameter type to the `garminRecent.map()` callback — TS couldn't infer it through the mixed `Promise.all` destructuring). **Not visually verified in a browser** — per this project's CLAUDE.md, the dev server is only started when explicitly requested, and the dev DB has no real Garmin rows to render anyway (the only real data is in production, from the previous session's fix). User should check the new Recovery tab after deploying.

---

### Session 2026-06-18c — Bug: "Aerobic pace trend" chart missing the OL (orienteering) filter that every other pace-based chart has

User noticed the "Aerobic Pace Trend" chart (`EasyPaceTrendChart`, Stats → Overview) didn't exclude orienteering sessions — visible as illogical jumps in the trend (OL pace at a given HR is much slower than road/trail pace at the same HR, due to technical terrain and navigation stops).

Confirmed real: `computeEasyPaceTrend()` in `stats/page.tsx` had no orienteering exclusion at all, while two other pace-based analyses in the same file already did — `computeWeatherStats()`'s local `isOL()` (excludes orienteering, indoor/virtual runs, and warmup/cooldown segments) and the inline OL filter inside the `terrainFactor` computation. Three near-duplicate regex implementations existed; `computeEasyPaceTrend` simply never got one when it was added.

**Fix:** extracted `computeWeatherStats`'s `isOL()` to a module-level function (same regex, now shared) and added `if (isOL(a)) continue;` to `computeEasyPaceTrend`'s filter loop. Added the `name` field to `EasyPaceAct` (needed by the check) and to the fast-path `recentForCurve` Prisma `select` (the slow-path `activities` query already selected `name`). The `terrainFactor` computation's separate inline filter was left as-is — it intentionally *selects* OL runs rather than excluding them, so reusing the shared predicate there is a smaller, separate cleanup, not part of this fix.

**Caveat:** the fast path can read `easyPaceTrend` straight from `FitnessCache.extraVizJson` (1-hour TTL) instead of recomputing — existing cached values from before this fix won't reflect the OL exclusion until the cache naturally expires or the next slow-path recompute runs. Not a new issue, just how this cache already behaves for any computation change.

**Verification:** `pnpm build --no-lint` passes.

---

### Session 2026-06-18 — Coach chat "stuck with no feedback" fix, large-screen layout, planner desktop drag-and-drop regression

**Bug 1 — AI coach: long silent waits, no "thinking" indicator, occasional total hang.**

Root cause (`app/api/coach/chat/route.ts`): the entire agentic tool loop (up to 6 non-streaming Claude round-trips) and the non-Claude single tool-check call ran to completion *before* the `ReadableStream`/`Response` was even constructed. The client's `fetch` couldn't resolve, and zero bytes reached the browser, until all of that finished — for several seconds to over a minute depending on tool count, with nothing for the user to see but a bare spinner.

**Fix:**
- Moved all of it — pre-approved write-tool execution, the Claude agentic loop, the non-Claude tool check, and final text generation — inside the stream's `start(controller)`. The HTTP response now opens immediately after the (fast, DB-only) setup work; everything slow happens with the connection already live.
- Added a `status` SSE event (`{"status":"thinking"}` before/between model calls, `{"status":"tool","tool":"<name>"}` right before a tool executes) so the client can show what's actually happening, not just a static spinner. Existing `toolCall` completion events are now delivered live as each tool finishes instead of batched after the whole loop.
- `components/coach/ChatInterface.tsx`: new `Message.statusLabel` field, set to "Tänker…"/"Thinking…" the instant a message is sent (before any server event arrives) and updated from the `status` events; rendered next to the loading spinner; cleared once text or a tool-call card arrives.
- `docs/api/coach.md` updated with the new event shape.

**Bug 2 — same coach bug, secondary cause:** `lib/ai/tools.ts` — 6 outbound `fetch` calls (Strava token refresh + segment fetch, Tavily web search, Open-Meteo, PubMed esearch/efetch) had no timeout. A slow/hung third-party API could block the whole chat turn indefinitely with no way to ever recover (this ran *before* the streaming fix too, so it was a second independent cause of "no response at all"). Added a `fetchWithTimeout()` wrapper (12s, `AbortSignal.timeout`) used by all 6 call sites; failures are already caught by `executeCoachTool`'s top-level `try/catch` and surfaced as a normal failed-tool result.

**Bug 3 — large screens: every dashboard page boxed into a centered 1280px column.**

Root cause: `app/(dashboard)/layout.tsx` wrapped all page content in `max-w-7xl mx-auto`, applied globally regardless of page content. The Coach page's own full-bleed trick (`-mx-4 -m-6` to cancel padding) only canceled padding, not this parent max-width, so it was still boxed too.

**Fix:** Removed `max-w-7xl mx-auto` from the layout — pages now use the full width next to the sidebar. Audited all dashboard pages first (dashboard home, stats, races, planner, history): their grids use fixed/sensible column counts or flexible `1fr` panels, none rely on the parent cap to avoid stretching badly, so no per-page column changes were needed. Settings and activity-detail pages keep their own narrower `max-w-2xl`/`max-w-3xl` (not centered within the parent, so they're unaffected — just flush-left under the sidebar with more right-margin than before, which is correct). The Coach chat itself needed one more fix: with the cap gone, its `max-w-[80%]` message bubbles would stretch unreadably wide, so the message list and input bar are now each wrapped in `max-w-3xl mx-auto` while the header/sidebar/background stay full width.

**Bug 4 — planner: drag-and-drop of workouts between days stopped working with a mouse on desktop (touch/mobile still worked).**

Two stacked causes, found in two passes:

1. `components/planner/PlannerCalendar.tsx`'s dnd-kit `sensors` only registered `TouchSensor`. `PointerSensor` (desktop mouse input) was present when DnD was first built (commit `b780714`) but silently dropped in a later, unrelated commit (`bcae130` — "bug fixes, chart styling, goals settings page, coach tool insert", which doesn't mention planner DnD at all). Confirmed via `git show` on both commits. Fixed by restoring `useSensor(PointerSensor, { activationConstraint: { distance: 8 } })` alongside `TouchSensor`.
2. That alone didn't fix it — user reported it was still broken. The real remaining cause: `components/planner/WorkoutPill.tsx` still had the **pre-dnd-kit native HTML5 drag implementation** on the pill's `<button>` (`draggable`, `onDragStart` writing to `dataTransfer`, `onDragEnd`), left over from before commit `b780714` wrapped the same pill in dnd-kit's `useDraggable`. With both systems attached to the same element, the browser's native drag (triggered by `draggable="true"`) takes over the mousedown-and-move gesture and stops the `pointermove` stream dnd-kit's `PointerSensor` needs to detect a drag — so dnd-kit's drag state never activated on desktop, regardless of which sensors were registered. This also explains why a Playwright mouse-drag simulation against this page hung mid-gesture during verification — not a test-tooling quirk, the actual bug.

**Fix:** removed `draggable`/`onDragStart`/`onDragEnd` and the now-unused `dragging` state from `WorkoutPill.tsx`, so dnd-kit fully owns pointer + touch dragging for workout pills. Removed the matching dead `workoutId` branch from the day cell's `onDrop` in `PlannerCalendar.tsx` (the `templateId` branch stays — `TemplateCard.tsx` still legitimately uses native HTML5 drag for dragging templates in from the sidebar, which never had this conflict since templates aren't wrapped in dnd-kit).

**Verification:** `pnpm build --no-lint` passes after both passes. Manually verified in a real browser (local dev DB, throwaway test user, cleaned up afterward) that dashboard/planner/coach pages correctly use full window width at 1920px. User is verifying the actual drag gesture manually.

**Bug 5 — activity detail: Laps/Splits chart broken on the latest activity — every bar squashed to the floor, and the avg-pace dashed line rendered straight through the x-axis label text.**

Two independent bugs in `app/(dashboard)/activities/[id]/splits-chart.tsx`, both visible at once on this activity:

1. Bar height and the avg-pace line were scaled against the *raw* min/max lap pace. A single outlier lap (GPS glitch, or a real lap recorded across a pause) sets `minPace`/`maxPace` far outside the rest of the laps, which stretches the whole scale and crushes every normal lap down to the `0.04` height floor. Worse, a lap slower than the (skewed) max produced a negative `normalizedSpeed`, and `Math.pow(negative, 2.8)` is `NaN` — an unclamped case that could render a bar with no height at all. The alpha/shading already used a P10–P90 percentile reference for exactly this reason ("fills the full alpha range even for steady-paced runs") but the height scale and avg-line position didn't share it. **Fix:** unified everything — bar height, shading, the avg-pace line, and the pace-scale labels — onto the same P10–P90-clamped scale (`scaleFastPace`/`scaleSlowPace`/`paceRange`), with `normalizedSpeed` clamped to `[0,1]` so an outlier renders at the floor/ceiling instead of skewing or NaN-ing everyone else.
2. Independent of the above: the avg-pace dashed line's inline style used `bottom: 7 + chartHeight * avgLineFrac`, but the bars/baseline use the Tailwind class `bottom-7`, which is the *spacing-scale token* 7 (`1.75rem` = **28px**), not 7 literal pixels. The line's coordinate space was therefore offset 21px low versus the bars it's supposed to align with — for any `avgLineFrac` below ~0.18 (common — it only takes the average pace being closer to the slow end of the lap range) the line rendered inside the x-axis label row instead of among the bars, which is the literal "text over the line" symptom. **Fix:** changed the base offset to `28` to match.

**Bug 6 — planner: rolling 4-week view always showed exactly 4 weeks regardless of screen size, wasting vertical space on large monitors.**

`components/planner/PlannerCalendar.tsx`'s rolling mode hardcoded `start = startOfWeek(subWeeks(now,1))` → `end = endOfWeek(addWeeks(now,2))`, always exactly 4 weeks. **Fix:** added `rollingWeeksCount` state (default 4) driving the date range, plus a `ResizeObserver`-free measurement effect (window resize listener) that measures one rendered week's actual height (`weeksListRef.current.scrollHeight / weeks.length`, which naturally includes the per-week `WeekSummaryStrip` in row layout) against the remaining viewport height below the calendar, and grows the count to fill it (clamped to 4–16 weeks). Also fixed `rollingWeekLabel` ("Last week"/"This week"/"Next week"/…), which previously only had branches for those three cases and fell through to a hardcoded `"In 2 weeks"` for every week beyond that — now computes the actual week offset and shows `"In N weeks"`.

**Verification:** `pnpm build --no-lint` passes.

**Bug 7 — planner: drag-and-drop *still* didn't move workouts between days after Bug 4's two fixes (PointerSensor restore + native-drag removal).**

User reported the drag still failed after both prior fixes were deployed. Root cause, found by actually instrumenting and running the drag end-to-end this time (Playwright, with network/console logging) instead of reasoning from the diff alone: `DroppableDay` in `components/planner/PlannerCalendar.tsx` registered its dnd-kit drop zone (`useDroppable`) on a wrapper `<div style={{ display: "contents" }}>`. Verified empirically (`getBoundingClientRect()` in current Chromium) that a `display:contents` element always reports an all-zero bounding rect — its own box doesn't exist, only its children's do. dnd-kit's collision detection measures exactly that rect to decide what the dragged item is "over." With a permanently zero-sized, zero-positioned rect, no day cell could ever register as a valid drop target — `onDragEnd`'s `event.over` was always `null`, so `onWorkoutMove` never fired. The drag *looked* correct the whole time (the `DragOverlay` ghost pill follows the cursor regardless, and the day cell highlight on hover happened to come from a separate `dndOverDate` check that — confusingly — also depends on the same broken collision detection, so even that almost never lit up either), which is why this layer of the bug was easy to miss from code review alone.

**Fix:** removed `display:contents` from the wrapper (now just a plain `<div className="h-full">`), and added `h-full` to the actual day cell `<div>` so it still fills the wrapper now that the wrapper is a real grid item that must be explicitly told to stretch its child (previously the day `<div>` *was* the grid item directly, since `display:contents` promoted it up into the grid in the wrapper's place).

**Verification — actually executed this time, not just reasoned about:** local dev DB + throwaway test user, ran 3 separate scripted Playwright drags (mouse down → move past the 8px activation distance → move to a cell 5 days later → mouse up), each one logging the live network request. All 3 fired `PATCH /api/planner/workouts/[id]` with the correct target date and returned 200, and the workout pill's DOM position moved to the target cell. (One earlier attempt during the same session, on a page that had just cold-compiled, didn't move anything — Next dev's first-compile hiccup, not reproducible on a warm page; flagged here in case it recurs.) Test user and seeded data deleted afterward; dev server and headless Chromium processes stopped; this session's unrelated in-progress local changes (stats/charts files) were left untouched.

**Bug 8 — Stats page: "Statistical threshold estimation" card silently drifted away from the applied/calibrated HR zones, showing wrong (much slower) LT1/LT2 pace and bpm. User confirmed the "Apply zones" calibration itself was correct — only this card's *display* was wrong.**

Three displays were involved, and untangling which ones were supposed to track what was the actual debugging work:
- **Bottom "HR zones — intervals & thresholds" table** (`ltBoundaries(hrZones)`, where `hrZones` comes from `fitnessCache.zones`): correct, by design — `fitnessCache.zones` is written *only* by `updateHRZones()` (the "Apply zones" / calibration button). Per the function's own header comment: *"HR zones should only change when explicitly recalibrated."*
- **"Statistical threshold estimation" card** (`statZonesLaps` prop, `lib/fitness/zones.ts`'s `estimateZonesFromStatisticalAnalysis()` over lap-level pace/HR buckets): *supposed* to be the same kind of calibration-only snapshot — `lib/fitness/cache.ts` has an explicit comment confirming this: *"statZonesJson / statZonesLapsJson intentionally omitted [from the auto-sync path] — zone estimation results are only written by updateHRZones (calibration button). Auto-sync must not [write them]."*
- **"LT/AT pace development" trend chart** (`ltPaceTrend`, also in `cache.ts`): intentionally *does* auto-update — historical months are locked in permanently once computed, but the *current* month is always recomputed on every sync. User confirmed this one should keep auto-updating.

**Root cause:** `app/(dashboard)/stats/page.tsx`'s own slow path (independent of `lib/fitness/cache.ts`, which correctly followed the calibration-only rule) computed a **live** `estimateZonesFromStatisticalAnalysis()` result on every stale-cache page render and — via a "fire-and-forget" cache-save fully separate from `updateHRZones()` — wrote it straight into `fitnessCache.statZonesJson`/`statZonesLapsJson`, the exact fields the comment in `cache.ts` says only calibration may touch. Page loads don't need new activity data to trigger this: the statistical estimator uses a 90-day recency-weighted window, which drifts on its own as today's date moves forward — a hard race effort that was 88 days old a week ago is 95 days old now and may fall out of the window, shifting the breakpoint detection even with zero new activities. Every time this happened on a stale-cache load, the live (and gradually drifting) result silently overwrote the calibration snapshot, so the next "fast path" read (`fitnessCache.statZonesLapsJson`) served the corrupted value instead of what the user last calibrated.

**Fix:** removed the live `estimateZonesFromStatisticalAnalysis()` calls from the slow path entirely (`statActRuns`/`statLapRuns`/`statZones`/`statZonesLaps` — none had any other use), and removed `statZonesJson`/`statZonesLapsJson` from the slow path's cache-save call. Both the fast and slow paths now read the same `statZonesLapsCached = fitnessCache?.statZonesLapsJson ?? null` directly — a true calibration-only snapshot that can only change via "Apply zones," exactly matching the bottom table and exactly matching what the user described as correct.

**Also verified (no bug found):** the user asked to confirm manually-entered resting HR always overrides Garmin's auto-synced value for HR-zone purposes. Checked all 4 resolution sites (`stats/page.tsx`, `api/stats/route.ts`, and both `updateVO2maxAndPaces`/`updateHRZones` in `cache.ts`) — all consistently use `profile?.restingHeartRate ?? garminRecent.at(-1)?.restingHR ?? ...`, manual-first. Already correct, no change made.

**Checked, no bug found:** the "HR zone distribution (last 12 weeks)" donut's zone-source toggle ("Auto (statistical + race PBs) / % of max HR / AI-assisted") only picks the method for the *next* "Apply zones" press — the donut's data (`zoneSeconds`) already sources from the currently-applied/calibrated zones in both code paths, confirmed by reading `computedHrZones`/`fitnessCache.zones` through to the classification loop. No change made.

**Verification:** `pnpm build --no-lint` passes.

**Bug 9 — same area, follow-up after Bug 8 shipped: user reported the "LT/AT pace development" historical trend chart was now also showing implausibly slow LT1/LT2 (paces ~30s/km slower than a documented, validated baseline from days earlier), despite Bug 8 not touching that chart's code path at all (`ltPaceTrend`, computed exclusively in `updateVO2maxAndPaces`/cache.ts, run on every Strava sync).**

Cross-checked against `docs/fitness/hr-zone-statistical-estimation.md` (status: "Implemented and live", last updated 2026-05-31) — its validated-results table records "LIVE 5yr window: LT1 153bpm @ 4:35/km, LT2 162bpm @ 3:52/km, R² 0.99," matching what the user said was correct a few days prior, and the doc independently confirms the same calibration-only rule already enforced in Bug 8 ("`updateVO2maxAndPaces()` does NOT run zone calibration... only written by `updateHRZones()`"). So the *intended* design was already understood correctly; the question was why the *live* current-month estimate (which legitimately auto-updates) had drifted so far from that baseline.

Found a second, real, verifiable cliff-edge in `estimateZonesFromStatisticalAnalysis()` (`lib/fitness/zones.ts`): the recency-weighting half-life switched between a hard `recentCount >= 40 ? 90 : 180` days. Crossing that exact threshold — which can happen from nothing more than a single activity aging out of (or into) the 90-day window as the calendar date advances, with zero new or unusual data required — reweights *every* pace bucket in the regression simultaneously, capable of producing a large, discontinuous jump in the detected breakpoint. This is consistent with the user's own account ("a normal sync, no backfill, worked fine a couple of days ago"). **Fix:** smoothed the halfLife linearly across a 30–50 run band instead of flipping at exactly 40.

Separately, `smoothLTTrend()`'s rate-limiting (added in commit `ee4cb76`, "LT trend stabilization") only capped month-over-month *improvement* at 20s/km — degradation had no cap at all, and the trailing/current-month point can never be caught by the spike-removal pass either (it has no "next" neighbor to compare against). So even a transient bad current-month estimate from the cliff-edge above would show through completely raw. **Fix:** made the 20s/km cap symmetric (limits change in *either* direction).

**Verification:** `pnpm build --no-lint` passes. Could not reproduce the exact historical magnitude without production data access, but both fixes address verified, real discontinuities consistent with the reported symptom and timeline.

**Bug 10 — user reported the "HR zone distribution" donut undercounts Z4 (Threshold) time ("I know I have more Z4 time than this shows" — chart showed ~0% / 18 minutes over 12 weeks).**

Root cause (not a regression — confirmed via `git log -p` across the full history of both files that this has never worked differently): `zoneSecondsJson`/polarisation in **three** separate places (`updateVO2maxAndPaces`, `updateHRZones` in `lib/fitness/cache.ts`, and the slow path in `stats/page.tsx`) all classified each activity into a single zone using its **whole-activity average heart rate**. Any mixed-effort session — warmup + hard interval/threshold work + cooldown, the exact shape of "Z4 training" — gets its *entire* duration bucketed wherever the blended average HR lands (typically Z2/Z3), since the average is pulled toward the middle. Real time spent at Z4/Z5 effort within that session, and real time at Z1 during the warmup/cooldown, both disappear into the average.

**Fix:** added `computeZoneTime()` to `lib/fitness/zones.ts` — a shared helper that uses **lap-level** HR when an activity has laps (splitting its time across the zones actually experienced lap-by-lap), falling back to whole-activity average only when no laps exist. Replaced all three duplicated average-HR loops (a fourth, near-identical polarisation-only loop in `stats/page.tsx` was merged into the same call) with this one function, so all three paths can no longer drift apart from each other the way Bug 8 found them doing.

**Verification:** `pnpm build --no-lint` passes.

**Bug 11 — after Bugs 8-10 deployed, user proved with the "Apply zones" result banner that the discrepancy was real and *not* a caching artifact: calibration computed LT1 151bpm/LT2 162bpm (correct, matches the documented baseline) but the "Statistical threshold estimation" card still showed LT1 143bpm/LT2 159bpm right after.**

Root cause: `updateHRZones()` computes **two different things** from two different input sets, by original design:
- `statResult` = `estimateZonesFromStatisticalAnalysis(statRuns + statLapRunsZones, ...)` — whole activities *and* laps combined. This is what actually determines the applied zones (`fitnessCache.zones`) when the statistical method wins, and what the "Apply zones" banner's LT1/LT2 reflects.
- `statLapOnlyResult` = the same function over **laps-only** data. Stored as `statZonesLapsJson` and — per Bug 8's fix — that's exactly what the "Statistical threshold estimation" card read.

These can legitimately disagree: any race or hard effort recorded as a single lap-less Strava block contributes to `statResult` but is invisible to `statLapOnlyResult`. The user's working theory ("some data that shouldn't be used is being used") may well be correct for *why* the laps-only subset specifically degraded — most likely new/changed lap data — but rather than chase that data forensically without DB access, the more direct fix is to stop displaying the laps-only number where it can mislead: the card should show the number that's actually in effect.

**Fix:** `stats/page.tsx`'s `statZonesLapsCached` now reads `fitnessCache?.statZonesJson` (combined) instead of `statZonesLapsJson` (laps-only) — the card now always matches what "Apply zones" just applied. `statZonesLapsJson` is left in place, still computed and stored, in case the laps-only diagnostic is useful again later.

Also fixed, found while reading the surrounding code: `updateHRZones()`'s `fitnessCache.upsert()` only included `statZonesJson`/`statZonesLapsJson` in its `update:` branch, not `create:` — so the very first calibration ever (or the first one after a cleared cache row, as happened here) wrote nothing to either field, leaving the card with no data until a second calibration. Both branches now share a `statZonesFields` object.

**Verification:** `pnpm build --no-lint` passes.

**Also investigated this round (Garmin/Recovery-tab confusion, no code change needed):**
- Confirmed `lib/garmin/sync.ts` (`syncGarminDaily`) only ever writes to `GarminDailySummary` — never touches `Activity` rows. There is no overlap with Strava activity data to deduplicate; the only field Garmin can supply that Strava conceptually could too is `restingHR`, and the resting-HR resolution already prioritizes the user's manual profile value everywhere (verified in Bug 8).
- The new "Recovery" tab's "Connect Garmin in Settings..." message (from the unrelated parallel `feat: Garmin recovery stats` work) is driven by `garminWellness.length === 0`, i.e. zero `GarminDailySummary` rows in the last 112 days — this means *no Garmin daily sync has run yet*, not that the account connection itself is broken. `syncGarminDaily` is currently only triggered by a manual `POST /api/garmin/sync` call (confirmed no cron wiring) — connecting the account alone doesn't populate any wellness rows.
- The empty "LT/AT pace development" chart (`No data — requires sufficient laps per monthly period`) is the direct, expected consequence of the user's own `DELETE FROM "FitnessCache"` deploy step: that history (`extraVizJson.ltPaceTrend`) is only ever rebuilt by `updateVO2maxAndPaces()`, which runs on an actual Strava sync — not on viewing the page, and not on "Apply zones" (`updateHRZones()`, a different function). It will repopulate (most of it in one pass, since the rebuild loop covers ~30 months per run) the next time a sync runs; triggering one manually (Dashboard → Sync) rather than waiting for the nightly cron will restore it immediately.

**Bug 12 — user reported the Zones tab's info-icon tooltips don't display correctly.**

Tested directly in a browser (local dev DB, throwaway test user + seeded activities with lap data) rather than guessing: `components/stats/metric-tooltip.tsx`'s `MetricTooltip` renders and positions correctly — screenshot confirms a properly-placed, fully-readable tooltip box next to the info icon on the "HR zone distribution" card.

What *is* a real, confirmed bug, found while investigating: two **different** components on the same Zones tab both hardcoded the identical title "HR zone distribution (last 12 weeks)" — the donut-chart `SectionCard` (`stats-client.tsx:326`) and the separate horizontal-bar `PolarisationCard` (`stats-client.tsx:1026`, which also shows a "Seiler score" and the Seiler 80/20 structure). Both appear stacked on the page showing overlapping 5-zone data under the same name, which is a believable source of the "doesn't look right" impression even though neither one's tooltip is actually broken. **Fix:** renamed `PolarisationCard`'s title to "Training intensity distribution (Seiler 80/20)" to disambiguate.

Pointed the user at `scripts/year-estimate-test.ts` (a standalone, frozen copy of the estimator used for experimenting against read-only production data without affecting `zones.ts`) as a way to get detailed bucket-level diagnostics directly against real data if Bug 9-11's fixes turn out to be insufficient — not run this session (no production DB access).

**Verification:** `pnpm build --no-lint` passes.

---

**Session 2026-06-18 — Security audit: session-token storage, client-side admin checks, rate limiting, password leakage:**

Four read-only audits run in parallel. Three came back clean (no findings requiring changes): session/OAuth tokens never touch `localStorage`/`sessionStorage` or the client-visible NextAuth session object; the single `User.isAdmin` role is re-checked server-side in every `/api/admin/*` route handler (client-side `isAdmin` checks are cosmetic only); no password hash or OAuth token is ever logged or serialized into an API response (bcrypt cost 12 throughout, explicit Prisma `select` allowlists everywhere user/account records are returned).

Rate limiting (`lib/rate-limit.ts`, in-memory, single-instance — sufficient for this single-user deployment) existed on only 4 of ~36 routes. Fixed the two highest-priority gaps plus one minor logging issue:

- `app/api/coach/calibrate/route.ts`: added `checkRateLimit('calibrate:${userId}', 5, 600)` — this endpoint can trigger an LLM call (mode=ai) and had no limiter at all.
- `app/api/coach/summarize/route.ts`: added `checkRateLimit('summarize:${userId}', 20, 60)`. Note: verified this route does **not** actually call an LLM — it's the documented stub from session 2026-06-16 (`{ messages: count }` only); real summarization goes through `/api/coach/chat`, which was already rate-limited. No client code calls this endpoint at all currently (`handleSummarize()` in `ChatInterface.tsx` only pre-fills the textarea). Limiter added anyway as defense-in-depth since the route is still directly reachable over HTTP.
- `app/api/strava/webhook/route.ts`: Strava does not sign POST event payloads (no Stripe/GitHub-style HMAC header), so the POST handler previously processed any inbound JSON with zero authentication. Added a shared-secret check: the POST handler now reads a `?secret=` query param and compares it against the same `stravaWebhookToken`/`STRAVA_WEBHOOK_VERIFY_TOKEN` already used for the GET handshake. This only works if the Strava push-subscription `callback_url` is registered (or re-registered) **with the secret baked into the URL**, e.g. `.../api/strava/webhook?secret=STRAVA_WEBHOOK_VERIFY_TOKEN` — Strava preserves the registered query string on every event delivery, not just the GET handshake. **Action required from the user:** re-register the Strava push subscription with the updated `callback_url` (delete the old subscription via the Strava API, create a new one with the secret in the URL) — this is a production-side change against Strava's API, not something reachable from this dev machine.
- `scripts/seed-user.ts`: removed the plaintext password from the `console.log` line after user creation (it's already known to whoever set `SEED_PASSWORD`; logging it again only risked it persisting in shell/CI history).
- `app/api/strava/webhook-subscription/route.ts` (follow-up fix): the secret check above is useless unless Strava's registered `callback_url` actually carries `?secret=`. Rather than asking the user to hand-craft `curl` calls against Strava's API, the POST handler here now builds `secureCallbackUrl` itself (`callbackUrl + "?secret=" + verifyToken`, generated server-side right alongside the verify token) and registers *that* with Strava instead of the raw client-supplied `callbackUrl`. The existing Settings UI "Unregister" / "Register with Strava" buttons (`strava-connect.tsx`) now transparently produce a secured subscription with no manual steps — re-registering through that UI on the live site is the only action needed after deploy.

Not fixed (lower priority, left for a future session): no rate limiting on `garmin/sync`, `strava/sync`, `strava/backfill-*`, `weather/backfill`; `middleware.ts` excludes `/api/admin/*` from its matcher (currently safe only because both admin routes do their own in-handler check — no defense-in-depth layer if a future admin route forgets it).

**Verification:** `pnpm build --no-lint` passes.

**Bug — Settings → AI Coach: switching provider away from Groq appeared to do nothing.**

Tested live against the actual `/api/settings/ai` endpoint (real session, real DB, all 4 providers) rather than guessing: the save → DB → read → dispatch chain was already 100% correct — switching to each provider and sending a chat message correctly hit that provider's real API (confirmed via each provider's distinct error format when given a fake key: Anthropic's `invalid x-api-key`, Google's `API_KEY_INVALID`, NVIDIA NIM's 404). Root cause was UX, not a backend bug: clicking a provider button only updates local React state — the separate "Save settings" button (shared with API keys/budgets) has to be clicked too for it to persist. User confirmed they never clicked Save for this field and don't want to have to.

**Fix:** `app/(dashboard)/settings/ai-settings.tsx` — provider buttons now self-save immediately via `PATCH /api/settings/ai` (`selectProvider()`), mirroring the existing pattern in `strava-connect.tsx`'s `handleSyncMode()`. Optimistic UI update with rollback + inline error message if the PATCH fails. The shared "Save settings" button still also sends `provider` (harmless redundancy) for the API-key/budget fields that still require it.

**Bug — Garmin "Sync now" reports success but Recovery tab in Stats stays empty.**

Investigated without DB/production access, using `docs/planning/archive/GARMIN_AUTH_REWORK_PLAN.md`'s own changelog: the Garmin auth flow had its **first-ever successful connection** today (2026-06-18), so there was essentially zero historical wellness data to show regardless. Two compounding issues found while reading `lib/garmin/sync.ts`: (1) `syncGarminDaily()` only ever syncs a single day (defaults to `new Date()`) — there was no way to backfill history, unlike Strava's dedicated backfill routes; (2) `safe()` swallows every Garmin API fetch failure silently with no return signal, so "Sync now" reported a green checkmark even on a run that fetched zero real fields (e.g. an expired/broken Garmin session).

**Fix:**

- `lib/garmin/sync.ts`: `syncGarminDaily()` now returns `Promise<boolean>` (`true` if at least one real field was fetched for that date) instead of `Promise<void>`, computed from whether `updateRecord` ended up non-empty.
- `app/api/garmin/sync/route.ts`: returns `{ ok: true, gotData }`; `garmin-connect.tsx`'s "Sync now" button now shows a distinct "⚠ no data yet" state (amber) instead of a plain ✓ when the sync ran but found nothing — no more false-positive success signal.
- `app/api/garmin/backfill/route.ts` (new): loops `syncGarminDaily()` backward over the last N days (default 90, capped at 365) sequentially with a 300ms pacing delay between days — Garmin's unofficial API is bot-detection-sensitive per the auth rework doc, so this avoids bursting it. Rate-limited to 3 calls/hour per user (`lib/rate-limit.ts`). Returns `{ synced, empty, failed }` day counts.
- `garmin-connect.tsx`: added a "Backfill last 90 days" button next to "Sync now", reporting the synced/empty/failed breakdown back to the user instead of a single ambiguous checkmark.

Verified live end-to-end against the real dev server (real NextAuth session via curl, throwaway test users cleaned up after): provider round-trip confirmed across all 4 providers; backfill endpoint confirmed to loop the correct day count, count synced/empty/failed correctly, and rate-limit at 3 calls/hour.

**Verification:** `pnpm build --no-lint` passes. `pnpm exec tsc --noEmit` clean.

**Bug 13 — Stats page info-icon tooltips flickered open/closed continuously on hover, with a completely stationary cursor.**

Verified hands-on in a browser with DOM-event instrumentation (not guessed): `mouseenter`/`mouseleave` fired in a tight ~50ms loop on the trigger button for as long as the mouse stayed over it. Root cause: `components/stats/metric-tooltip.tsx`'s `MetricTooltip` renders a full-viewport `<div className="fixed inset-0 z-[9998]" onClick={hide} />` backdrop (added to support tap-to-close on mobile) *every time* the tooltip is shown — including when shown by hover. That backdrop sits on top of the trigger button itself, stealing the hover target away from it: `mouseleave` fires → `hide()` → backdrop removed → button re-exposed under the still-stationary cursor → `mouseenter` fires → `show()` → backdrop reappears → repeat indefinitely. A high-frequency `requestAnimationFrame` position sample confirmed the icon itself never moved a single pixel — ruling out a layout/position-instability explanation.

**Fix:** added a `pinned` flag, set only when the tooltip is opened by click/tap (not hover). The backdrop now only renders when `pinned` is true, so hover-opened tooltips never get covered by anything and dismiss normally via `onMouseLeave`. Verified the fix with the same instrumentation — zero flicker across 3 viewport widths over 900ms+ windows.

Also fixed, found while investigating (real but separate from the flicker): two different components on the Zones tab — `SectionCard`'s donut chart and the separate `PolarisationCard` — both rendered the title "HR zone distribution (last 12 weeks)" stacked on the same page. Renamed `PolarisationCard`'s title to "Training intensity distribution (Seiler 80/20)". Also regrouped `SectionCard`'s title+tip-icons together, separate from the (possibly multi-row) `action` slot, since they were sharing one `flex-wrap` row and could land in an inconsistent spot at narrower widths — a real layout bug, just not the cause of the flicker.

**Bug 14 — after Bug 9-11 shipped and the user triggered an actual sync (repopulating `ltPaceTrend`), the "LT/AT pace development" chart's current/last point still showed the old, wrong values (LT2 4:15/km · LT1 5:02/km — i.e. 159/143bpm) instead of matching the now-corrected "Statistical threshold estimation" card (151/162bpm).**

User's framing was exactly right: *"this should just be exactly that algorithm, run on a smaller time interval, repeated."* It wasn't. `updateVO2maxAndPaces()`'s per-window trend computation (`lib/fitness/cache.ts`) built its `result` from `buildTrendLaps()` alone — laps-only data, structurally identical to the `statLapOnlyResult` input that Bug 11 already identified as the less-reliable of the two datasets `updateHRZones()` computes. The trend chart's current point was never wired to mirror `statResult` (whole-activities + laps combined, what's actually applied) — it always used the narrower, laps-only equivalent.

**Fix:** added `buildTrendActs()` (mirrors `statRuns`/`statActRuns` exactly) and changed the per-window `result` to `estimateZonesFromStatisticalAnalysis([...windowActs, ...windowLaps], ...)` — combined data, matching `statResult`'s composition precisely. The bootstrap/OL-threshold step (`phase1Window`) intentionally stays laps-only, matching `updateHRZones()`'s own `phase1Result` pattern (it's never displayed, only used to derive the OL pace threshold).

**Important caveat for the user:** historical months are "computed once and stored — history never changes" by design. The history currently in `FitnessCache` (from the sync that ran before this fix) was built entirely with the old laps-only method. After deploying this fix, only the *current* month will use the corrected combined-data method on the next sync — older months won't retroactively improve unless `FitnessCache` is cleared again to force a full ~30-month rebuild with the new method. Recommended: repeat the `DELETE FROM "FitnessCache"` + sync cycle one more time after this deploy for full end-to-end consistency.

**Bug 15 — user's own hypothesis, investigated: "is the OL filter being missed?" Initial fix was WRONG — caught and reverted by empirical validation against real data.**

Found a real, structural gap in the orienteering exclusion logic, present in **both** `windowOlFilter` (`updateVO2maxAndPaces`) and `olRaceFilterLight` (`updateHRZones`): the pace-threshold check (excluding anything slower than the bootstrapped easy-training pace) only applied `if (a.isRace)`. First instinct: remove the `isRace` restriction so it applies to every activity, race or not.

**This first fix was deployed, then disproven.** Per CLAUDE.md's bug-audit practice (verify before trusting), the user asked to validate the rolling-trend fix against real data rather than just trusting it compiled. Rewrote `scripts/rolling-lt-test.ts` into a standalone reimplementation of the trend pipeline, seeded/ran it against the real local dev DB (a full Strava-synced copy, 2,826 activities back to 2016 — confirmed by the user as legitimate data to test against), and ran 3 isolated configs side by side (laps-only/race-gated, combined/race-gated, combined/all-activities). Result: the ungated config (`isRace` restriction removed) returned **null for 18 of 31 months** vs 2 nulls for the race-gated combined config, because the bootstrapped OL pace threshold (≈1.15× LT1 pace) is *routinely* slower than ordinary easy/recovery training pace — the fix was discarding large amounts of completely legitimate training data, not catching OL leaks. The original `isRace`-gated design was correct: a race that slow is a real anomaly (races are run near threshold effort), but a slow *training* run is just normal easy running, indistinguishable from OL by pace alone.

**Reverted:** the `isRace` gate is back in both places. The actual fix that mattered here was Bug 14 (combined activities+laps data) — validated separately by isolating the two changes: the combined-data config alone gave far better month-coverage (29 OK / 2 null vs OLD's far higher null rate) and equal-or-better R² than laps-only, with no need to touch the OL filter at all.

**Re-confirmed Garmin is not involved:** grepped every `prisma.activity.*` write across the codebase — all Strava sync/backfill/weather-backfill or planner-match routes; `lib/garmin/sync.ts` only ever writes `GarminDailySummary` rows.

**Bug 16 — architectural fix per user's request: unify the live calibration and rolling-trend algorithms so they can never diverge again.**

Bugs 11/14/15 all stemmed from the same root cause: `updateHRZones()` (live "Apply zones" calibration) and `updateVO2maxAndPaces()`'s per-window trend loop each had their own hand-maintained copy of "bootstrap OL threshold → build filtered dataset → estimate" — two parallel implementations that drifted apart in different ways instead of being structurally guaranteed to match.

**Fix:** extracted the shared pipeline into `estimateZonesFromActivities(activities, maxHR, restHR, asOf?)` in `lib/fitness/zones.ts` — the single source of truth for: name-only OL filter → phase-1 laps-only bootstrap → OL pace threshold (`isRace`-gated) → combined whole-activity + laps dataset → `estimateZonesFromStatisticalAnalysis()`. Both `updateHRZones()` and `updateVO2maxAndPaces()`'s window loop now call this one function — `updateHRZones()` with `asOf` defaulted to now, the trend loop with `asOf` anchored to each historical `windowEnd`. They literally cannot diverge anymore since it's the same function call, not two implementations that happen to agree.

Also removed `statLapOnlyResult`/laps-only-only computation from `updateHRZones()` — it fed `statZonesLapsJson`, which nothing reads anymore since Bug 12 fixed the card to read `statZonesJson`. The Prisma column is kept (no schema/migration churn for this) but is now always written `null`.

**Verified end-to-end against real local data** (not just `pnpm build`): ran the actual `updateHRZones()` and `updateVO2maxAndPaces()` production functions directly against the synced local copy of the user's real Strava history. `updateHRZones()` → LT1=152bpm/LT2=162bpm/R²=0.99 (matches the pre-existing, already-correct calibration). `updateVO2maxAndPaces()`'s trend's last point (2026-06) → lt1PaceSecPerKm=276, lt2PaceSecPerKm=232.59 — **byte-for-byte identical** to `updateHRZones()`'s own output, confirming the unification works exactly as intended.

**Important caveat for the user:** historical trend months are "computed once and stored — history never changes" by design (unaffected by this fix unless missing). Only newly-computed months (current month, or any month not yet in `extraVizJson.ltPaceTrend`) use the unified algorithm on the next sync. To get a fully consistent rebuild of the *entire* historical trend with the unified algorithm, clear `FitnessCache` and re-sync once more after this deploy — same as last time.

**Verification:** `pnpm build --no-lint` passes. `scripts/rolling-lt-test.ts` rewritten to match the validated/unified logic exactly (single config now, was a 3-way comparison during validation) — kept as a standalone frozen reimplementation (not importing from `zones.ts`) per the existing pattern in `scripts/year-estimate-test.ts`, so future algorithm experiments can't accidentally touch production.

---

**Bug 17 — user's own hypothesis, confirmed correct: the core breakpoint-detection heuristic (not the dataset construction) misplaces LT2 in sparse historical windows.**

After Bug 16 shipped, the user pointed out 2021-11 still showed LT2=4:45/km when they're confident it's never been worse than ~4:10/km since 2021. Root cause in `estimateZonesFromStatisticalAnalysis()` (`lib/fitness/zones.ts`): the LT2 breakpoint scan always **unconditionally skipped the fastest pace bucket** (started at `i=1`, never `i=0`) to guard against a sparse/noisy fast bucket dominating the result. In 2021-11's bucket curve there were two comparably steep transitions — one at the fastest bucket (genuine, well-supported: highest weight of any bucket that month) and one further down (a separate, unrelated kink) — and the blind skip rule always picked the second, wrong one.

**Extensive empirical investigation (`scripts/rolling-lt-test.ts` against the user's full real Strava history, 2,023 running activities back to 2017) ruled out several plausible-looking fixes before landing on the right one:**

- *Cross-time HR/pace anchoring* (use the live result as a prior to disambiguate historical breakpoints): discarded — HR alone can't distinguish the right answer from the wrong one (both candidates were within a few bpm of the live anchor), and a pace-drift-bound version incorrectly rejected genuinely well-supported, high-R² months (2025-03/04 at LT2=4:30/km) because the athlete's actual improvement rate wasn't linear/constant the way the bound assumed.
- *Widening the recency halfLife* (the user's own suggestion, tested properly across 4 configs against 3 reference points): made the ~1-year-ago point *worse*, not better, in every wider config tried.
- *Requiring extra bucket weight on the candidate breakpoint*: didn't discriminate — PAV merging additively combines weights from the buckets it merges, so a borderline-sparse bucket looks identical to a well-supported one after merging.
- *Massively expanding the orienteering name-filter* (discovered along the way: of 278 `isRace=true` activities, 270+ are Swedish orienteering competitions the original 7-keyword filter never matched — SM/DM/SL/SCC leagues, Jukola, 10Mila, O-ringen, etc.): tested and **reverted** — it regressed the already-validated live result from 3:53/km to 4:00/km. This athlete is a competitive orienteer; his hardest verifiable efforts mostly happen during races, so excluding OL races wholesale removes real high-intensity signal, not just noise. Documented as a known, accepted source of residual noise in sparser historical windows rather than something to filter away.

**The actual fix — two changes, both validated:**

1. **Breakpoint detection** (`lib/fitness/zones.ts`): the fastest bucket can now be selected as LT2, but only with a much stronger signal there specifically (slope > 60% of the curve's max, not 20%) — confirmed empirically that a moderate fastest-bucket slope (33–55% of max) is often a PAV-merge noise artifact giving a physiologically impossible (faster-than-live) result, while a genuine kink (like 2021-11's, at 78% of max) clears the higher bar easily. Also added an absolute floor (`slopeMax < 0.25` → null): a smooth/ambiguous curve with no real kink at all isn't reliable regardless of which bucket "wins" the old relative test.
2. **Smoothing pass** (`smoothLTTrend()` in `lib/fitness/cache.ts`): rewritten to compare each point against its nearest *available* neighbors rather than requiring an exact 1-month gap (some months now legitimately return null), using a median-filter-style rule — if the two nearest neighbors agree with each other but the point between them doesn't, the point is the more likely outlier. Caught a real case (2025-09's bogus 3:46/km, sandwiched between two 4:15/km months) that the old gap-strict version missed entirely (and, worse, "corrected" the *wrong*, fine neighboring month instead, since it happened to be exactly 1 month away).

**A bug introduced by fix #2 and caught before shipping:** checking lt1 and lt2 independently for spikes let one get corrected while the other didn't, decoupling them from the ~1.185 VT1/VT2 ratio the estimator itself assumes (one real case: lt2 corrected from 232s to 263s while lt1 stayed at 275s, giving an internally-inconsistent 1.046 ratio). Fixed by treating lt2 as the primary signal — when it's flagged and smoothed, lt1 is rescaled by its original ratio rather than checked independently.

**Verified end-to-end against real production code** (not just the standalone script): ran `updateHRZones()` and `updateVO2maxAndPaces()` directly against the synced local copy of the user's real data. Live result unchanged (LT1=152bpm/276s, LT2=162bpm/232.6s, R²=0.99 — byte-identical between both functions, confirming Bug 16's unification still holds). 2021-11 → LT2≈4:10/km (was 4:45/km), matching the user's stated memory. 2025-09's outlier correctly smoothed; 2024-12 now shows a ratio-consistent lt1/lt2 pair after the decoupling fix.

**Known, documented, accepted limitation:** some historical windows (mostly 2022–mid-2025) still show LT2 paces slower than the user's informally recalled "max ~10s/year slower" rule would predict, despite high R² and consistent multi-month support. Every fix attempted for this regressed something else that was already correct (see the ruled-out list above) — most likely explanation is that "as-if-live-then" computation can only use what was provable from actual hard efforts by that point in time, not hindsight, combined with this athlete's races (mostly orienteering) carrying more inherent pace/HR noise than road racing. Added a tooltip on both the live card and the trend chart explaining this directly to the user (see below) rather than silently presenting a precision the data doesn't fully support.

**UI: added confidence/reliability notices.** New tooltips in `lib/fitness/tooltips.ts`: `statZones` (on the "Statistical threshold estimation" card — explains it's the highest-confidence estimate since it uses the full history, not a single window) and `ltPaceTrend` (on the "LT/AT pace development" chart — explains the as-if-live-then computation, that ambiguous months show no point rather than a guess, and the orienteering-noise caveat for this athlete specifically). Wired into `app/(dashboard)/stats/stats-client.tsx` via `MetricTooltip`.

**Verification:** `pnpm build --no-lint` and `pnpm tsc --noEmit` pass.

---

**Session 2026-06-21 — Diagnostics for two production failures: Strava webhook registration "Bad Request", Garmin backfill 0/90 days with data.**

Both reported live from production (`training.helgars.se`), neither reproducible locally (no real Strava/Garmin production credentials available from this dev machine, and no SSH access to read PM2 logs or query the production DB directly — see CLAUDE.md). Added diagnostics rather than guessing a fix blind:

- **Strava webhook "Bad Request":** `app/api/strava/webhook-subscription/route.ts`'s POST handler already forwards Strava's full error body as `details` in its response, but `strava-connect.tsx`'s `handleRegisterWebhook()` only ever displayed the generic top-level `message` ("Bad Request"), discarding the field-level `errors` array (e.g. `{field: "callback_url", code: "not verifiable"}`) that would actually explain the failure. Fixed to render `field: code` pairs from `details.errors` alongside the message. Leading hypothesis (unconfirmed): the `?secret=` query param baked into `callback_url` (added in the 2026-06-18 webhook-secret fix) may not survive Strava's validation round-trip the way assumed — the next registration attempt's detailed error will confirm or rule this out.
- **Garmin backfill empty:** `lib/garmin/sync.ts`'s `safe()` wrapper swallowed every Garmin Connect API failure with zero logging — confirmed by the user's "Backfilled 90 days — 0 with data, 90 empty, 0 failed" result, which is consistent with every one of the 5 per-day Garmin fetches (summary/sleep/hrv/readiness/spo2) failing silently (most likely an expired/invalid token, but unconfirmed). `safe()` now takes a label and logs `[garmin] <label> fetch failed: <message>` on every failure — checking `pm2 logs traininglab` after the next "Sync now" will reveal the actual underlying error (e.g. `GARMIN_NOT_CONNECTED`, a decrypt failure, or a 401/403 from `connectapi.garmin.com`).

**Not yet fixed** — both require one more round-trip with the user (redeploy, retry, report back the new detailed error / log lines) before a confident, evidence-based fix can be made instead of a speculative one.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass.

---

**Session 2026-06-21b — Root-caused both diagnostics from the previous session using production log output the user pasted back:**

**Garmin — confirmed root cause:** PM2 logs showed `[garmin] No displayName for user ... — reconnect Garmin in Settings` on every sync attempt. Traced to `app/api/garmin/exchange-ticket/route.ts:25`: `fetchDisplayName(tokens.accessToken)` (`lib/garmin/auth.ts`) silently returned `null` on any non-200 response or thrown error, and the connect route stored that `null` into `GarminAccount.displayName` regardless — `{ok: true}` was still returned to the client, so the UI showed "Connected" even though the one-off displayName fetch had failed. `syncGarminDaily()` requires `displayName` to build every Garmin API path, so it bailed out every time without ever explaining why (until the previous session's logging fix made the symptom visible).

**Fix:**
- `lib/garmin/auth.ts`: `fetchDisplayName()` now logs the specific failure (HTTP status, or a response body with no `displayName`/`userName` field, or a thrown exception) instead of swallowing it silently.
- `lib/garmin/sync.ts`: `syncGarminDaily()` self-heals a missing `displayName` instead of just bailing — since the access/refresh tokens are still valid, it now retries `fetchDisplayName()` using the existing token and persists the result if it succeeds, before falling back to the old bail-out path. No disconnect/reconnect needed if the retry succeeds; the next "Sync now" click is the test.

**Strava webhook "Bad Request — callback url: GET to callback URL does not return 200":** Verified directly against the real `training.helgars.se` server (reachable over HTTPS from this dev machine even though SSH isn't) that the deployed app responds correctly and with valid headers/TLS to a malformed validation request (403, as expected for missing `hub.verify_token`) — ruled out SSL/reachability/nginx as the cause. Also verified locally that the GET handler's matching logic is correct both with and without the `?secret=` query param present, ruling out the leading hypothesis from the previous session (the secret param itself isn't the problem). What's left unverified: `getValidWebhookToken()` used `prisma.appConfig.findFirst()` with no `where` clause — correct only by accident if there's ever exactly one `AppConfig` row; if a second one exists (e.g. an invited/approved second user) it could return the wrong row's `stravaWebhookToken` and cause exactly this symptom.

**Fix:**
- `app/api/strava/webhook/route.ts`: `getValidWebhookToken()` now filters to `stravaWebhookToken: { not: null }` — picks the row that's actually holding the live token instead of an arbitrary first row.
- Added logging on both GET-validation failure branches (`unexpected hub.mode=...` / `token mismatch — received="..." expected="..."`) since there was previously zero visibility into *why* Strava's validation GET got a 403. If the next "Register with Strava" attempt still fails, these logs will show the literal received vs. expected token and settle it definitively.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. GET-handshake logic re-tested locally (curl against `pnpm dev`) before and after the `findFirst` change — still returns the correct `{"hub.challenge": ...}` for a valid request.

---

**Session 2026-06-21c — Both production bugs root-caused with hard evidence and fixed (not just diagnosed); iterated locally against the real Garmin API and the actual handshake logic until verified working.**

**Garmin — actual root cause confirmed via WebSearch + live test: Garmin has no OAuth2 `refresh_token` grant at all.** The 405 from `POST /oauth-service/oauth/token` wasn't a transient bug — that endpoint/grant type doesn't exist for Garmin's unofficial API. Per garth (the reference implementation every community Garmin integration is built on), an expired OAuth2 access token is renewed by **re-running the same OAuth1-signed exchange used at initial login** (`POST /oauth-service/oauth/exchange/user/2.0`), using the long-lived (~6mo) OAuth1 token/secret pair — not a refresh token. We had never stored that pair (`ticketToOAuth1()`'s `{token, secret}` were used once during connect, then discarded), so there was nothing to re-exchange with even if the logic had been right.

**Fix:**
- `prisma/schema.prisma`: added `GarminAccount.oauth1Token`/`oauth1Secret` (encrypted, optional — existing connections won't have them until they reconnect once more).
- `lib/garmin/auth.ts`: removed `refreshGarminTokens()` (the broken grant-based function) entirely; added `reexchangeOAuth2(oauth1Token, oauth1Secret)` which just calls the existing `oauth1ToOAuth2()` again with a fresh `CookieJar`. `loginWithGarmin()` now also returns `oauth1Token`/`oauth1Secret` instead of discarding them.
- `app/api/garmin/connect/route.ts` and `app/api/garmin/exchange-ticket/route.ts`: persist the encrypted OAuth1 pair on connect.
- `lib/garmin/client.ts`: `getGarminToken()` now calls `reexchangeOAuth2()` using the stored pair; throws a clear `GARMIN_REAUTH_REQUIRED` if it's missing (existing connections, until they reconnect once) instead of the old confusing 405.

**Verified locally against the throwaway-account pattern** (not just `tsc`): exercised all three branches of `getGarminToken()` directly — (1) expired token + no OAuth1 pair → `GARMIN_REAUTH_REQUIRED` exactly as expected for every currently-connected account; (2) expired token + OAuth1 pair present → code correctly reaches the **real** `connectapi.garmin.com` exchange endpoint and surfaces its real response (401 for a fake pair, proving the call path itself works, not just that errors get swallowed); (3) still-valid token → returns immediately, zero network calls, no regression. Full success with a *real* OAuth1 pair couldn't be tested from here (requires the user's one-time browser ticket login), but the mechanism itself is the same one garth uses against the live API today.

**Strava "Bad Request — callback url: GET to callback URL does not return 200" — root cause confirmed locally, not just theorized.** Reproduced exactly: `new URL("...?secret=X?hub.mode=subscribe...")` parses `hub.mode` as `null` (it gets absorbed into the `secret` value) because the second `?` is just a literal character, not a delimiter — only the *first* `?` starts a query string. If Strava's webhook delivery appends its own `hub.*` params with a literal `?` rather than checking for an existing query string (unconfirmed which, but irrelevant given the fix below), any callback_url that already has one breaks the handshake exactly like this, every time, deterministically — which matches the symptom (not flaky).

**Fix:** moved the secret out of the query string entirely. `app/api/strava/webhook/route.ts` deleted; replaced with `app/api/strava/webhook/[secret]/route.ts` — a dynamic path segment can never collide with Strava's appended `hub.*` query params regardless of how Strava builds that append. `app/api/strava/webhook-subscription/route.ts` now registers `callback_url={base}/{verifyToken}` instead of `{base}?secret={verifyToken}`. `docs/api/strava.md` updated to match.

**Verified locally (`pnpm dev` + curl):** full GET handshake with the new path-based secret (valid path + valid `hub.*` → 200 + correct `hub.challenge`; wrong path secret → 403; missing `hub.mode` → 403) and POST event delivery (valid secret → 200; wrong secret → 403) — all behave correctly. Also re-confirmed the original double-`?` failure mode is structurally impossible now: with no pre-existing query string on the registered URL, there's nothing for a misplaced `?` to collide with.

**Deploy note:** `prisma/schema.prisma` changed this session — use the longer deploy command (`pnpm install --frozen-lockfile --prod=false && pnpm exec prisma generate && ... && pnpm exec prisma db push --skip-generate && ...`), not the short one. After deploy: Garmin will need **one more** reconnect (captures the OAuth1 pair for the first time); Strava webhook needs **Unregister → Register with Strava** again (picks up the new path-based callback_url).

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. Both fixes exercised live (real Garmin API call, real local HTTP server) rather than only type-checked.

---

**Session 2026-06-21d — Both fixes from session 2026-06-21c got the user further but not all the way; root-caused the next layer from real PM2 logs and Strava error responses.**

**Garmin — the OAuth1 re-exchange fix actually worked.** PM2 logs (`pm2 logs traininglab`) confirmed `getGarminToken()` successfully reached Garmin's real API and got back real account data (real birthdate, email, vo2Max, etc. — proof the access token is valid). The remaining failure was purely in `fetchDisplayName()`: `/userprofile-service/userprofile/personal-information` returns `userInfo`/`biometricProfile` objects, with no `displayName` or `userName` field anywhere in it — that endpoint was simply the wrong one. Per python-garminconnect's reference behavior, the field actually lives at `/userprofile-service/socialProfile`. **Fix:** `fetchDisplayName()` now calls that endpoint instead.

**Strava — "Bad Request — subscription: already exists".** The path-based-secret fix from the previous session worked (no more "does not return 200"), surfacing the next real problem: Strava only allows one push subscription per `client_id`, and one already existed — most likely a leftover from an earlier registration attempt in this same debugging saga (possibly one that succeeded on Strava's side before this session's fixes, or one from the original bare `?secret=` callback_url scheme) that our DB never recorded. The Settings UI only shows an "Unregister" button when `webhookActive` is true, but our DB thought nothing was registered — there was no way to reach the stale subscription through the UI at all.

**Fix:** `app/api/strava/webhook-subscription/route.ts` no longer trusts only our own DB for subscription state — `fetchStravaSubscriptionId()` asks Strava directly (`GET /api/v3/push_subscriptions`) since only one can ever exist app-wide. `GET` now reconciles our DB against Strava's real answer; `DELETE` falls back to Strava's real id if ours is missing; `POST` self-heals — if Strava rejects with `code: "already exists"`, it deletes the stale one and retries once automatically, so the user doesn't need an "Unregister" button to appear at all. Verified the `already exists` detection logic against the literal error shape Strava returned (`{message: "Bad Request", errors: [{field: "subscription", code: "already exists"}]}`) — matches and triggers the retry path correctly.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. Garmin fix not re-verified live from here (needs the user's next sync); Strava self-heal logic verified by direct inspection against the real error shape, not a live Strava call (dev has no real Strava app credentials to test against).

---

**Session 2026-06-21e — Garmin hrv/readiness/spo2 404s root-caused against the reference implementation's actual source code; Strava self-heal hardened with retries + logging since it still failed once more.**

**Garmin — 3 of 5 daily wellness fields were 404ing even though the account connection itself now works** (PM2 logs showed `summary` and `sleep` succeeding, `hrv`/`readiness`/`spo2` all 404). Fetched `python-garminconnect`'s actual source (the reference implementation) rather than guessing again: all three use the date as a URL **path** segment, not a query param — and none of them put `displayName` in the path at all (unlike `summary`/`sleep`, which do use it). Our code had the date as a query param (`startDate`/`endDate`) on all three, and used `${dn}` in the URL for `hrv` where it doesn't belong. `spo2`'s base path was also just wrong (`/wellness-service/wellness/user/daily-wellness/spo2/details` → confirmed correct path is `/wellness-service/wellness/daily/spo2`).

**Fix (`lib/garmin/sync.ts`):**
- `hrv`: `/hrv-service/hrv/${dn}?startDate=&endDate=` → `/hrv-service/hrv/${dateStr}`
- `readiness`: `/metrics-service/metrics/trainingreadiness?startDate=` → `/metrics-service/metrics/trainingreadiness/${dateStr}`
- `spo2`: `/wellness-service/wellness/user/daily-wellness/spo2/details?startDate=&endDate=` → `/wellness-service/wellness/daily/spo2/${dateStr}`

Not re-verified live from here (needs the user's next sync) — confirmed only against the reference implementation's source, not a real response body, since dev has no real Garmin account connected.

**Strava — still "subscription: already exists" after the self-heal fix from the previous session.** Without a fresh error detail to go on, hardened the self-heal logic defensively rather than guessing a single new root cause: `app/api/strava/webhook-subscription/route.ts`'s POST now retries the delete-stale-then-recreate cycle up to 3 times with a 1.5 s delay between delete and retry (covers eventual-consistency lag on Strava's side if the previous single-shot retry fired before the delete had fully taken effect), and logs every step (`[strava/webhook-subscription] ...` — stale id found, delete result, retry status/body) so the *next* failure, if any, is diagnosable straight from `pm2 logs` without needing another screenshot round-trip.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. Neither fix re-verified against the real, live external API from here — Garmin needs the user's account (dev has none connected), Strava needs real app credentials (dev's are placeholder/invalid, confirmed earlier this saga via a direct 401 from Strava's API).

---

**Session 2026-06-22 — Confirmed the previous session's Garmin endpoint fixes actually worked (404s gone); fixed the next layer (empty-body JSON parse) and hardened Strava's delete-then-retry into a poll loop after live evidence showed it wasn't a one-shot timing issue.**

**Garmin:** PM2 logs after the path-segment fix deployed showed `readiness` and `spo2` succeeding with zero errors, and `hrv` failing only with `Unexpected end of JSON input` — i.e. the 404s are gone; this is `res.json()` choking on a 200 response with an **empty body**, which Garmin's `hrv-service` apparently returns for dates with no recorded HRV (plausible for a 90-day backfill spanning days before HRV tracking was active, or simply nights with no measurement). **Fix:** `lib/garmin/client.ts`'s `garminConnectFetch()` now reads the response as text first and only `JSON.parse`s it if non-empty, returning `null` otherwise — treated as "no data for this date," not an error.

**Strava:** the previous session's self-heal (delete stale subscription, fixed 1.5s delay, retry) was deployed and tested live — and failed identically 3 times in a row, with PM2 logs showing `deleteStravaSubscription()` reporting success but the very next `fetchStravaSubscriptionId()` call still finding the *same* subscription id every time. This rules out a one-shot race and confirms Strava's delete isn't immediately consistent with its own existence check. **Fix:** replaced the fixed delay with a poll loop — after a successful delete, `GET /push_subscriptions` is re-checked every 2s (up to 10×, ~20s) until it stops returning the deleted id, *then* the recreate POST fires. Reduced outer retry attempts 3→2 to keep the worst case (~40s) from running too long, since each attempt can now wait up to 20s on its own. Every step still logged.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. Garmin's `hrv` fix not yet re-verified live (needs the next sync); Strava's poll loop not yet re-verified live either (needs the next "Register with Strava" attempt) — both depend on the user's real accounts/credentials, unavailable from this dev machine.

---

**Session 2026-06-22b — Strava "already exists" finally root-caused for real: `deleteStravaSubscription()` sent credentials as a request body, which Strava's DELETE endpoint doesn't read — it silently no-ops and returns 404, which our own code then misread as "already gone, success."**

The 20s poll loop from the previous session proved this wasn't a timing/consistency issue (10 checks, 2s apart, same id every time). Found Strava's actual documented format: `DELETE /push_subscriptions/{id}?client_id=...&client_secret=...` — credentials as **query params**, not a body. Confirmed live via a one-off script run directly on the production server: the old body-based call returned `404` (not 204) on the real stale subscription (id 351763, created 2026-06-04 — predates this entire debugging session, likely from the very first manual registration before any secret mechanism existed), and after switching to query params it returned `204` and the subscription list immediately came back empty.

**Fix:** `deleteStravaSubscription()` and the standalone `DELETE` route handler (which had its own duplicate body-based call) both now build the URL with `client_id`/`client_secret` as query params. The `DELETE` handler was also simplified to just call `deleteStravaSubscription()` instead of duplicating the request inline. Shrunk the post-delete poll loop from 10×2s back to 5×1s now that delete actually works immediately in the normal case — kept as a small safety net, not removed.

The stale subscription (351763) was deleted directly against Strava's API as a one-time manual cleanup (not through the app, since this was diagnosed mid-fix) — confirmed empty via `GET /push_subscriptions` afterward. The user's own throwaway script (`scripts/check-strava-sub.ts`, created directly via SSH heredoc, never committed) should be deleted from the server now that it's served its purpose.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. The actual fix was validated against the real Strava API from the production server itself (not simulated) — this is the first of the Strava fixes in this saga with a live, confirmed-correct result rather than a plausible-but-unverified one.

---

**Session 2026-06-22c — Garmin backfill failing with zero log output: the request itself was too slow, not anything inside it.**

User reported the generic "Backfill failed — check console." message with no `[garmin]` log lines at all. The math explains it: 90 sequential days × (300ms pacing + real Garmin API latency for 5 parallel calls) lands around 70-90s, well past nginx's default `proxy_read_timeout` (~60s) — the proxy kills the connection mid-run, the browser's `fetch()` rejects with a generic network error (hence the fallback UI message), and nothing in our own code ever actually failed (hence zero log lines — success doesn't log anything in this code).

**Fix:** `app/api/garmin/backfill/route.ts` no longer runs the loop inside the request/response cycle. The POST handler now fires the loop in the background (`void runBackfill(...)`, not awaited — safe here since this is a persistent PM2/`next start` process, not a serverless function that gets frozen after responding) and returns `{ok: true, started: true}` immediately. `runBackfill()` logs progress every 10 days plus a final summary, all visible via `pm2 logs`. `garmin-connect.tsx` updated to show "started in the background, check back shortly" instead of waiting for a final synced/empty/failed count it will never receive.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass. Not yet re-verified live (needs the user's next backfill attempt + a `pm2 logs` check a few minutes later).

---

**Session 2026-06-22d — Garmin backfill: added a real progress bar (SSE-streamed, matching the existing Strava weather-backfill pattern) and extended the range from 90 days to 2 years.**

The previous session's fire-and-forget background job fixed the nginx-timeout problem but left the user with zero visibility into progress — exactly what was asked for here. Replaced it with the same SSE-streaming pattern already used by `app/api/strava/backfill-weather/route.ts`: the response stays open and pushes a `progress` event after every day, which both gives a live progress bar *and* properly fixes the original timeout issue (each chunk resets nginx's `proxy_read_timeout`, so the connection survives indefinitely as long as chunks keep flowing — no need to rely on a background job with no client feedback).

**Changes:**
- `app/api/garmin/backfill/route.ts`: rewritten as an SSE stream (`start` → `progress` per day → `done`), days cap raised from 365→730 (2 years), default raised from 90→730.
- `garmin-connect.tsx`: `backfillDays()` now consumes the SSE stream the same way `handleWeatherBackfill()` does; added a `backfillProgress` state and a progress bar (same markup/styling as the existing weather-backfill progress bar). Button relabeled "Backfill last 2 years", calls `backfillDays(730)`.

**Verified locally end-to-end** (not just typechecked): ran the actual SSE endpoint against a real authenticated session on `pnpm dev` — confirmed the exact event sequence (`start` → 10× `progress` → `done`) for a 10-day test run, and confirmed the existing 3/hour rate limit still triggers correctly (429 on the 4th call within the window). Real Garmin API behavior over a full 2-year range not verified from here (no real Garmin account in dev) — only the streaming/progress mechanics, which are independent of what Garmin's API actually returns per day.

**Verification:** `pnpm build --no-lint` and `pnpm exec tsc --noEmit` pass.

---

**Session 2026-06-22e — Garmin backfill's SSE progress bar appeared to hang on first deploy ("started but no log output") — root cause was the nginx config, not the app code.**

`deployment/README.md`'s nginx server block has an explicit regex `location` matching SSE-streaming endpoints to disable `proxy_buffering` and extend `proxy_read_timeout` to 3600s — without that, nginx buffers the *entire* response and only flushes it to the browser once the upstream connection closes (or the default ~60s `proxy_read_timeout` kills it first), which is indistinguishable from "hung" on the client. That regex only listed `coach/chat`, `strava/backfill-history`, and `strava/backfill-weather` — `garmin/backfill` didn't exist yet when it was written, so new requests fell through to the generic `location /` block with default buffering/timeout. Also found two more existing endpoints with the identical gap while auditing this (`strava/backfill-splits`, `strava/backfill-descriptions` — both stream `text/event-stream` but were never added to the regex either).

**Fix:** `deployment/README.md`'s regex now includes all five: `coach/chat|strava/backfill-history|strava/backfill-weather|strava/backfill-splits|strava/backfill-descriptions|garmin/backfill`. This is documentation only — the user's *live* `/etc/nginx/sites-available/traininglab.conf` needs the same regex edit applied manually and `nginx -t && systemctl reload nginx`, since nginx config isn't deployed via this repo.

Confirmed live by the user in the meantime that the Garmin backfill progress bar does eventually start and progress correctly (reached 167/730 in one observed run) even without the nginx fix — likely nginx's buffer filled and started flushing partway through rather than holding the whole response. The nginx fix is still correct and should be applied so this doesn't intermittently hang or get killed by the default timeout on a full 2-year run.

**Verification:** doc-only change, no build/typecheck needed.

---

**Session 2026-06-22f — Second user: HR-zone statistical estimator and LT1/LT2 pace trend find no data, even after a full Strava history backfill AND a manual "Apply zones" press.**

Two real gaps found and fixed, but neither is confirmed as *the* root cause for this specific user yet (no DB access to their data from this machine):

1. `runHistoricalBackfill()` (`lib/strava/backfill.ts`) writes laps/splits/best-efforts onto existing `Activity` rows, but `backfillRunner.start()` (`lib/strava/backfill-runner.ts`) never followed that up with any fitness-cache recompute. The LT/AT pace trend chart (`extraVizJson.ltPaceTrend`) is written by `updateVO2maxAndPaces()`, the AUTO path that normally runs after every regular sync — backfill never called it, so the trend stayed stuck at whatever was computed (often empty) before the backfill. **Fix:** `backfillRunner.ts` now fires `updateVO2maxAndPaces(userId)` on the backfill's `"done"` event (fire-and-forget, matching the cron/sync pattern). Deliberately does *not* call `updateHRZones()` — that one stays calibration-button-only by design (see existing comment in `lib/fitness/cache.ts`: auto-overwriting `statZonesJson` after a backfill would make the estimate drift unpredictably as laps trickle in).
2. `StatisticalZonesCard`'s empty state read "No lap data yet — run a Strava backfill first" for *any* reason `estimateZonesFromActivities()` returns null — not just missing laps. Misleading once backfill is done. **Fix:** copy now reads "...then click \"Apply zones\" above."

**Neither fix explains the user's full report** — they confirmed they *did* press "Apply zones" (the manual `updateHRZones()` path) after backfilling, and it still found insufficient data. `estimateZonesFromStatisticalAnalysis()` has several independent guards that all return `null` silently (point count <40, monotonic buckets <6, no detectable slope kink, R²<0.62, 6 different physiological sanity checks) — without DB access there's no way to tell which one is tripping for this user's actual data (e.g., a runner who never varies pace/effort enough to produce a detectable HR-vs-pace breakpoint would legitimately fail here — that's a data limitation, not a bug, but the UI doesn't distinguish it from "still need to backfill").

**Diagnostic instrumentation added** so this can actually be root-caused next time: `lib/fitness/zones.ts` — `estimateZonesFromStatisticalAnalysis()` and `estimateZonesFromActivities()` both take a `debug` param (default `false`) that `console.log`s the point/bucket counts and the exact guard that failed. `lib/fitness/cache.ts`'s `updateHRZones()` now always passes `debug=true` (this is the manual "Apply zones" call — infrequent, already rate-limited to 5/10min, so log volume is a non-issue). **Next step:** have the user press "Apply zones" again and check `pm2 logs traininglab` for the `[zones:debug]` lines immediately after — that output will show exactly which guard is rejecting their data and lets the actual fix (relax a threshold, fix a data-mapping bug, or confirm it's a genuine data limitation) be targeted correctly instead of guessed at.

Existing users who already ran a backfill before fix #1 still need one more "Apply zones" press to populate the statistical-zones card retroactively (the new auto-trigger only fires on *future* backfill completions, and only refreshes the auto path, not `statZonesJson`).

**Verification:** `pnpm build --no-lint` passes. Not yet root-caused against the live second user's actual data — awaiting their next "Apply zones" press + `pm2 logs` output.

---

---

**Session 2026-06-22g — External security recon (HTTPS-only, non-destructive GET/OPTIONS requests against the live `training.helgars.se`) found 3 issues; all fixed and verified locally.**

1. **CSP allowed `'unsafe-inline'` for `script-src`**, undermining most of its XSS protection. Fix: nonce-based CSP. `middleware.ts` now generates a per-request nonce (`crypto.randomUUID()` base64), forwards it via an `x-nonce` request header, and sets `Content-Security-Policy` on the response with `'nonce-...' 'strict-dynamic'` (prod) / `'nonce-...' 'unsafe-eval'` (dev) instead of `'unsafe-inline'`. The CSP header moved out of `next.config.ts`'s static `headers()` (can't vary per-request there) — the other security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy) stay there unchanged. Routes excluded from middleware's matcher (`api/auth`, `api/admin`, `api/strava/webhook`, `api/cron`) no longer get a CSP header at all — acceptable, they're JSON-only and never render HTML/scripts. `style-src` keeps `'unsafe-inline'`: Radix/shadcn rely on inline `style` attributes for popover/dropdown positioning, and removing it would need `'unsafe-hashes'` or component rewrites — not worth the regression risk here. Two real inline scripts needed the nonce explicitly: `app/api/garmin/ticket-receiver/route.ts` (reads `x-nonce` off the request), and `next-themes`'s flash-prevention script via its official `nonce` prop on `ThemeProvider`, wired through `app/layout.tsx` (now `async`, reads the nonce via `headers()`).
2. **`nginx` disclosed its exact version** (`Server: nginx/1.24.0 (Ubuntu)`). Fix: documented `server_tokens off;` in `deployment/README.md` §9, with a one-time manual SSH command to apply it to the already-deployed server (nginx config isn't tracked in git, so no `git pull` ever applies this).
3. **`HEAD` requests hung indefinitely when proxied through nginx** (confirmed: instant against the Next.js server directly on `localhost:3000`, hangs only through nginx). Root cause: the documented `location /` block sent `proxy_set_header Connection 'upgrade';` unconditionally — even for plain requests that never asked to upgrade — which is the textbook nginx misconfiguration behind exactly this symptom. Fix: added the standard `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` block and changed to `proxy_set_header Connection $connection_upgrade;`, documented in `deployment/README.md` §9 with its own one-time manual SSH apply command.

**Verification:** `pnpm build --no-lint` passes. The nonce CSP was verified against a real browser (Playwright driving headless Chromium against `pnpm dev`) on `/login`, `/register`, and `/pending` — zero CSP console violations after the `next-themes` fix (one `unsafe-inline` violation found and fixed first), pages render correctly and are interactive (screenshots checked). The two nginx fixes are documentation + a ready-to-run manual command only — not yet applied to the live server, since nginx config there can't be reached or updated from this machine; the user applies it over their own SSH session.

---

**Session 2026-06-22h — Correction to finding 3 in 2026-06-22g: the "HEAD requests hang through nginx" bug was a false positive caused by local tooling on the dev machine, not a real bug on the live server.**

While walking the user through applying the documented nginx fix live (which also surfaced that the real active config file is `/etc/nginx/sites-available/traininglab`, no `.conf` extension — a stale `traininglab.bak` in the same directory caused one wrong-file detour first), re-tested `HEAD` against the now-patched production server and it still hung. Isolated it by testing `HEAD` over HTTPS against `example.com` — a totally unrelated Cloudflare-hosted site with no connection to this app — from the same machine: identical hang (`curl` exit 28, even with `--no-keepalive`). `GET` over HTTPS to the same site returns instantly. The original recon's comparison (§2026-06-22g finding 3) tested `HEAD` against `localhost:3000` over plain HTTP (instant) vs. `HEAD` against `training.helgars.se` over HTTPS via nginx (hangs) — two variables changed at once (HTTP→HTTPS *and* direct→proxied), and only the HTTPS one actually mattered. This machine's curl/schannel build has a quirk completing `HEAD` responses over TLS that has nothing to do with this app, its nginx config, or the live server at all.

**The `map $http_upgrade $connection_upgrade` + `proxy_set_header Connection $connection_upgrade;` change already applied to the live config is still correct nginx hygiene** (hardcoding `Connection: upgrade` unconditionally is a real misconfiguration in general — it's just not the cause of this particular symptom) and is left in place; harmless either way. Findings 1 (CSP nonce) and 2 (`server_tokens off`) from 2026-06-22g are unaffected by this correction and remain valid.

**Lesson:** isolate one variable at a time before attributing a symptom to a specific layer (proxy vs. transport vs. app) — testing `HEAD` against an unrelated third-party HTTPS site first would have caught this before asking the user to chase it over SSH.

**Verification:** confirmed live, from the dev machine, against both `training.helgars.se` and `example.com`.

---

**Session 2026-06-22i — Full documentation audit: archived completed plans, fixed cross-doc inconsistencies, filled API doc gaps.**

User asked for a full review of all docs relevant to the AI or users, with stale content archived and everything made current and consistent. Found and fixed:

- **Stale "single-user" framing**: `CLAUDE.md`, `README.md`, and `docs/architecture/overview.md` all still described the app as single-user, but multi-user (registration + admin approval + per-user isolation) shipped in commit `037321d` and is fully documented in `deployment/README.md`. Updated all three to describe the actual multi-user model; added `/register` and `/pending` to the architecture doc's pages table and a `User.status`/`isAdmin` note to the schema table.
- **Stale "Apache" reverse-proxy references**: the project moved to nginx a while ago (`deployment/README.md`, `docs/api/strava.md`'s nginx SSE allowlist), but `README.md`, `docs/architecture/overview.md`, `docs/guides/workflows.md`, and `docs/guides/testing.md` still said Apache, including a non-existent `SetEnv proxy-sendchunked 1` directive. Fixed all four to nginx; pointed at `deployment/README.md`'s SSE `location` block instead of duplicating proxy config in four places.
- **Migration-based DB workflow that contradicts actual practice**: `README.md`, `docs/guides/workflows.md`, and `docs/guides/testing.md` all told developers to run `prisma migrate dev`/`migrate deploy` (`pnpm db:migrate`), but this project has no `prisma/migrations` directory and manages the schema exclusively via `prisma db push` (`deployment/README.md` §14, `deployment/deploy.sh`) — recommending migrations would have created a second, never-used schema-tracking mechanism. Replaced with `pnpm db:push` everywhere.
- **Broken/dead doc references**: `CLAUDE.md` pointed at `docs/planning/MASTER_PLAN.md`, which no longer exists (archived months ago) — repointed to `docs/planning/` generally, since dated plan docs come and go there. `docs/architecture/overview.md` and `docs/guides/workflows.md` referenced a `GlobalDoc/` folder that doesn't exist in this repo (`GlobalDoc/documentation-rules.md`, `GlobalDoc/architecture.md`) — replaced with the real `docs/` paths. `README.md` linked to `docs/guides/deployment.md` (never existed) and `docs/planning/FUTURE_PLANS.md` (archived) — repointed to `deployment/README.md` and `docs/planning/`. `docs/guides/documentation-rules.md`'s folder-structure diagram only listed `api/`, `schemas/`, `integrations/` despite `architecture/`, `fitness/`, `guides/`, `planning/`, and `security/` all existing and being in active use — added all of them.
- **Missing AI providers**: NVIDIA NIM and Groq (`lib/ai/nvidia.ts`, `lib/ai/groq.ts`, `AIClient.provider` in `lib/ai/client.ts`) were absent from `docs/integrations/strava.md`'s AI Provider Abstraction section, `CLAUDE.md`, `README.md`'s tech stack table, and `docs/guides/testing.md`'s test checklist — added to all four.
- **`docs/fitness/hr_zones_current.md` numeric drift vs. `lib/fitness/zones.ts`**: the "hard training pass" maxHR method said 70th percentile (code: 80th, `statisticalMax` in `lib/fitness/cache.ts:530`); the statistical R² gate said ≥0.72 (code: ≥0.62, `zones.ts:477` — `docs/fitness/hr-zone-statistical-estimation.md` already had this right, it was only the summary doc that had drifted); the Method-A regression-fallback and the general percentage-fallback both cited LT1=78-80% (code: 82-83% in both `estimateLTFromRaces()` and `buildHRZones()`). All corrected to match the actual code, with the specific call site and the data-volume gate (≥2 races / ≥5 hard-effort runs / ≥3 threshold sessions) noted for each method.
- **`docs/integrations/strava.md`**: weather backfill described as an undifferentiated "background batch job" — corrected to the actual 07:00 daily cron, 50 activities/user/run (`lib/cron.ts`). Strava sync section didn't mention the 00:30 UTC nightly historical-backfill resume.
- **`docs/integrations/ai-setup.md`**: pricing table header said "Gemini 2.0 Flash" while the rest of the doc set (correctly) says `gemini-2.5-flash` — aligned the model name; left the $ figures alone since current Gemini pricing wasn't independently re-verified.
- **API docs (`docs/api/`)**: an audit against every `app/api/**/route.ts` found ~25 endpoints with zero documentation and several drifted fields, despite `docs/guides/documentation-rules.md` mandating "no exceptions." Created `docs/api/garmin.md` (8 routes — the entire Garmin integration had no API doc), `docs/api/admin.md` (user approval/revoke + registration), `docs/api/stats.md`, `docs/api/weather.md`, and `docs/api/cron.md` (documents `lib/cron.ts`'s in-process scheduler as the primary mechanism, `/api/cron/sync` as the secondary externally-triggered path). Extended `docs/api/auth.md` with the undocumented `/api/settings/credentials|account|password|goals` routes. Fixed drift in `docs/api/activities.md` (wrong Gemini model name, missing `PATCH`/`streams` routes), `coach.md` (missing `calibrate`/`summarize`/`conversations`/`undo` routes), `planner.md` (missing `typeId`/`isRunningRelated` fields, missing `blocks` CRUD), `races.md` (`activities-near` said "max 10" vs. actual `take: 20`, missing `auto-link`), and `strava.md` (missing `resync` field, missing the three SSE backfill routes).
- **Archived `docs/planning/IMPLEMENTATION_PLAN_FEATURES_2026.md`** to `docs/planning/archive/` — cross-referencing its "Redan klart" table against the session log below confirmed essentially everything in it shipped across the 2026-06-16 through 2026-06-18 sessions. The few genuinely unfinished items (Period A/B CTL/VO2max trend, the planner detail panel's Week/Block/Plan tabs, the mobile-first checklist) were carried forward into §12 above instead of silently dropped. Also cleaned up §12 itself, which still listed multi-user, drag-and-drop planner, and activity-matching as open/deferred ideas despite all three being implemented later in this same document.

**Not changed:** `docs/fitness/interval-vo2max-research.md` (framed as general research, not an implementation-status doc — left as background). `docs/schemas/ai-context.md` (spot-checked against `lib/ai/context-builder.ts`/`prompts.ts`, already accurate). The readiness-score weighting in `docs/architecture/overview.md` (the real formula in `app/(dashboard)/dashboard/page.tsx`'s `computeReadiness()` is a point-based scale with a Garmin-readiness blend, not a clean percentage split, but the doc's summary is a fair approximation and a more in-depth Garmin/readiness rework is already being scoped separately — see `docs/planning/GARMIN_HRV_AND_VIZ_PLAN_2026_06_22.md`). No application code was touched — this was docs-only.

**Note:** a concurrent, unrelated session had uncommitted changes in `app/(dashboard)/stats/page.tsx`, `stats-client.tsx`, `app/api/cron/sync/route.ts`, `lib/garmin/sync.ts`, `lib/strava/backfill-runner.ts`, `scripts/garmin_sync.py`, plus a new `components/charts/WeatherPaceScatterChart.tsx` and the `GARMIN_HRV_AND_VIZ_PLAN_2026_06_22.md` plan doc itself, while this audit was in progress. None of those files were touched by this session; this session's commit is scoped to documentation only.

---

**Session 2026-06-22j — Garmin HRV bug fix, LT1/LT2-trend bug root-caused, temp/wind and cadence/stride chart redesigns, HRV-baseline overreaching detection + composite readiness score consolidation. Full research + plan written first in `docs/planning/GARMIN_HRV_AND_VIZ_PLAN_2026_06_22.md` (now archived).**

1. **HRV never showed any data, root cause found:** `lib/garmin/sync.ts` and `scripts/garmin_sync.py` read `hrvSummary.lastNight` from Garmin's `/hrv-service/hrv/{date}` response — the actual field (confirmed against three independent sources documenting that exact unofficial endpoint) is `lastNightAvg`. `hrvNightly` was therefore `null` on every sync, for every user, since the integration was built. One-line fix in both files. Could not verify against stored data (local dev DB has no `GarminAccount`/`GarminDailySummary` rows — Garmin sync needs real OAuth tokens only present in production); will need a production sync to confirm `hrvNightly` populates.
2. **LT1/LT2 pace-trend chart empty — not an algorithm bug.** Re-ran `scripts/rolling-lt-test.ts` and the real `updateVO2maxAndPaces()` directly against the local data mirror (7800+ activities) — both produced valid LT1/LT2 points for 22+ months with R² 0.96-1.00, ruling out the threshold/breakpoint-detection hypothesis from session 2026-06-22f. The actual bug: `ltPaceTrend` is only ever written by `updateVO2maxAndPaces()`, called fire-and-forget from three places, two of which (`app/api/cron/sync/route.ts`, `lib/strava/backfill-runner.ts`) used `.catch(() => {})` — any thrown error (e.g. a transient failure right after a large backfill) silently and permanently stalls the cached trend with zero log trace. Fixed both to log the error, matching the third (already-correct) call site in `app/api/strava/sync/route.ts`. Next regular sync (or pressing "Sync" manually) should now either repopulate the chart or, if it still fails, finally surface why in `pm2 logs`.
3. **Temperature/wind stats redesigned**: replaced the four separate discrete-bucket bar lists in `WeatherProfileCard` (temp bands, HR-normalized temp bands, wind bands) with a continuous scatter + linear-regression chart per variable (`components/charts/WeatherPaceScatterChart.tsx`), X = temperature/wind, Y = fitness-drift-adjusted relative pace (the same `adjustedPace` data `computeWeatherStats()` already computed for the old bands — `WeatherStats.tempScatter`/`windScatter` in `app/(dashboard)/stats/page.tsx`). Precipitation bands (only 3 buckets) and HR-normalized bands kept as-is. Backed by research: marathon performance degrades ~0.3-0.4%/°C outside ~7.5-15°C WBGT, and wind has a markedly asymmetric cost (headwind penalty ≫ tailwind benefit) that a continuous curve captures and discrete bins don't.
4. **Cadence & stride length redesigned**: replaced the "value over calendar week" line chart with cadence/stride-length plotted against pace (`components/charts/CadenceStrideScatterChart.tsx`), split into "last 8 weeks" vs. "8-16 weeks ago" point series with per-period regression lines, since Speed = Cadence × Stride Length is a mathematical identity — week-to-week drift in the old chart mostly reflected which mix of paces was run that week, not a real technique change. New `computeCadenceScatter()` in `page.tsx` replaces the old weekly-aggregation helper (used by both fast and slow paths); `CadenceScatterPoint` type exported.
5. **New `lib/garmin/insights.ts`**: `computeHrvBaseline()` (7-day rolling avg vs. a non-overlapping 60-day personal baseline, flags `overreaching_risk` on a ≥20% drop — the cited HRV-overreaching precursor in the sport-science literature; also reports 14-day coefficient of variation, informational only) and `computeRestingHRBaseline()` (latest vs. 30-day trailing average). `computeReadinessScore()` implements the composite formula already documented in `docs/architecture/overview.md` (HRV 40% + TSB 30% + sleep 20% + resting-HR-trend 10%, each normalized 0-100 around the athlete's own baseline, re-normalized over whichever components have data), optionally blended 60/40 with Garmin's own `trainingReadiness` score.
6. **Consolidated with the dashboard's pre-existing ad-hoc readiness formula.** Discovered mid-session (via the concurrent doc-audit commit's own notes) that `app/(dashboard)/dashboard/page.tsx` already had a separate, ad-hoc point-based `computeReadiness()` — removed it entirely; the dashboard's compact readiness pill and the new Stats → Recovery tab's detailed `ReadinessScoreCard` (score + per-component breakdown + overreaching-risk banner) now both call the one shared function. `dashboard/page.tsx`'s Garmin query widened from 14 days/HRV-only to 67 days/HRV+restingHR to feed the baseline windows. New shared `readinessLabel()` helper (Ready ≥70 / Moderate ≥45 / Recover <45, same thresholds the dashboard already used) keeps both surfaces visually consistent.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass. Could not log into the running app (no browser-automation tool available and no test credentials) to visually confirm the new charts — instead wrote throwaway scripts (not committed) that called the real new functions directly against the local data mirror: weather scatter found 598/568 temp/wind candidate points with sane sample values, cadence scatter found 102 points (43 recent/59 older) with a realistic pace/cadence/stride sample, and the consolidated readiness function degrades gracefully to a single-component score (TSB only, since this DB has no Garmin data) without crashing. HRV/LT1-LT2 production fixes are not yet confirmed live — both require a real production sync to verify (no Garmin tokens or production DB access from this machine).

---

**Session 2026-06-23 — Workout-type color palette reordered into hue (rainbow) order.**

`TYPE_COLOR_PALETTE` in [app/(dashboard)/settings/sports/sports-manager.tsx](app/(dashboard)/settings/sports/sports-manager.tsx) (the "Color:" swatch picker shown when adding/editing a workout type) had its 25 colors in an arbitrary order. Reordered to red → orange → amber → lime → emerald → teal → sky/blue → indigo → violet → fuchsia → pink, light-to-dark within each hue, purely for a more intuitive picker layout. No behavior change — `PRESET_COLORS` (the sport-level color picker) and `RUN_TYPE_COLORS` were untouched.

**Verification:** `pnpm build --no-lint` passes.

---

**Session 2026-06-23b — Existing sports can now have "related to running" toggled, not just at creation.**

`isRunningRelated` (drives the weekly-running-distance projection, see `backfill-running-sports` route) could only be set in the "Add new sport" form — once a sport existed, the flag only rendered as a read-only "Running" badge. Added `isRunningRelated` to `sportUpdateSchema` in [app/api/sports/route.ts](app/api/sports/route.ts), and a checkbox ("Related to running (counts toward weekly running distance)") inside each sport's expanded panel in [sports-manager.tsx](app/(dashboard)/settings/sports/sports-manager.tsx), wired through the existing `updateSport()` PATCH call. The header's "Running" badge is unchanged and still shows the current state when collapsed.

**Verification:** `pnpm build --no-lint` and `npx tsc --noEmit` both pass. Could not exercise the live toggle through the browser (no test login credentials, no browser-automation tool — see prior sessions) or via a direct Prisma round-trip (local Postgres container `traininglab-db` wasn't running and Docker Desktop wasn't started for this small check); the change mirrors the existing, already-working `name`/`color` PATCH pattern exactly, and the `isRunningRelated` column itself is already in active use elsewhere (sport creation, planner weekly-km projection).

**Note:** `docs/api/sports.md` doesn't exist yet — a pre-existing gap from an earlier documentation audit that covered ~10 other route files but missed this one. Not created in this session (out of scope); flagged here for a future docs pass.

---

**Session 2026-06-23c — Planner sections can now be true interval blocks: work segment + rest/recovery segment + reps, counted as one section.**

Previously a `WorkoutSection`'s `repetitions` field only repeated a single segment N times (e.g. "6×800m Z4") with no way to express rest between reps as part of the same block — a rest interval had to be a separate, unrelated section. Added a rest segment to the section model itself:

1. **Schema:** `WorkoutSection` gained `restDurationType` ("time"|"distance"|null), `restDuration` (seconds), `restDistance` (meters), `restTargetZone` (1-5) in [prisma/schema.prisma](prisma/schema.prisma). Reuses the section's existing `zoneType` for interpretation (no separate rest zone type) — only the target zone number differs between active and rest.
2. **De-duplicated the section zod schema and estimate math**, which is what made this change safe to add without missing a call site: the section validation schema was copy-pasted verbatim across `app/api/planner/templates/route.ts` and `app/api/planner/templates/[id]/route.ts` — extracted to [lib/planner/sectionSchema.ts](lib/planner/sectionSchema.ts). The "sum sections into total duration/distance/zone-seconds" math existed *twice* with diverging logic (server's `computeEstimated()` vs. the client builder's own `estimated()`) — unified into [lib/planner/estimate.ts](lib/planner/estimate.ts)'s `estimateSections()` (raw totals, used by the live builder preview) and `computeTemplateEstimate()` (the `estimatedDuration`/`estimatedDistance`/`estimatedZoneDistribution` shape persisted on `WorkoutTemplate`). An interval section's total is `repetitions × (active segment + rest segment)`, with active and rest contributing to their own (possibly different) zone's seconds.
3. **Fixed a real, reachable bug found while touching this code:** `PATCH /api/planner/templates/[id]` replaces a template's sections but never recomputed the template's cached `estimated*` fields — they only got set on initial `POST`. Editing any existing template's sections (the normal "edit template" flow in the planner UI, `handleTemplateUpdate()` in `planner-client.tsx`) silently left `estimatedDuration`/`estimatedDistance`/`estimatedZoneDistribution` stale, which feeds the week view's zone bars (`WeekSummaryStrip.tsx`) and template cards. Now recomputes via `computeTemplateEstimate()` on every section replace. This predates the interval-block work but would have made the new rest-segment data look broken on any edit if left unfixed.
4. **Builder UI** ([components/planner/WorkoutBuilder.tsx](components/planner/WorkoutBuilder.tsx)): when a section's repetitions is set above 1, a "Rest between reps" control appears — duration type (none/time/distance), a value input (seconds for time, meters for distance), and a target zone select, mirroring the active-segment fields. The collapsed section row's summary line now reads e.g. `6× 400m Z4 + 90s Z1 rest` instead of just totalling the active segment.
5. **AI coach context:** `get_workout_templates` in `lib/ai/tools.ts` now includes the rest segment in its plain-text section summary, so the coach can see interval structure when discussing saved templates.

**Docs written before implementing** (per `docs/guides/documentation-rules.md`): `docs/api/planner.md`'s template section schema and `docs/architecture/overview.md`'s `WorkoutSection` row updated first.

**Not changed:** ad-hoc (non-template) planned workouts still only store a single top-level `targetDuration`/`targetDistance` — section detail, interval or not, has only ever persisted via a linked `WorkoutTemplate`. This is pre-existing architecture, unrelated to this feature.

**Verification:** `npx prisma generate`, `npx tsc --noEmit`, and `pnpm build --no-lint` all pass. Wrote a throwaway script (`scripts/__verify_interval_estimate.ts`, deleted after running) calling `estimateSections()`/`computeTemplateEstimate()` directly — pure functions, no DB needed — with a 6×400m@Z4 + 90s@Z1-rest section: got `totalSec: 1044, totalM: 2400, zoneSec: { z4: 504, z1: 540 }` (504 = 6×84s active, 540 = 6×90s rest), matching hand-calculated expectations exactly; a plain non-interval section (no reps/rest) produced byte-for-byte the same result as the old pre-refactor formula, confirming no regression for existing templates. Did not exercise the live DB round-trip or browser UI (local Postgres container wasn't running; no test login/browser-automation tool available — see prior sessions' verification notes) — the local dev DB needs `prisma db push` applied before any existing template can be loaded/edited through the running app.

---

**Session 2026-06-23d — Planner calendar card merges running-related sports into one figure; week-detail "Volume by intensity" now uses the Z1-Z5 zone system instead of a separate, buggy intensity-label scheme.**

1. **[components/planner/WeekSummaryStrip.tsx](components/planner/WeekSummaryStrip.tsx)** (the compact calendar card and the row summary below each week): its `bySport`/`topSports` per-sport breakdown grouped strictly by `sportType`, so a week with both "Running" and "Orienteering" workouts showed two separate top-sport entries even though both are running-related — duplicating effort the card's *other* indicator (`displayRunKm`, the "~Xkm" predicted/planned figure) already did correctly by merging across `isRunningRelated` sports. Now `bySport` keys running-related sport types under one `"Running"` bucket (reusing the same `runningSportNames` set, hoisted above the aggregation loop instead of being computed twice). Non-running sports are unaffected and still listed individually.
2. **[app/(dashboard)/planner/week/page.tsx](app/(dashboard)/planner/week/page.tsx)** (the full week-detail page, opened by clicking into a week): explicitly **not** changed to merge by sport — "Volume by sport" there stays per-sport as before, by design (different view, different purpose than the calendar card).
3. Its separate **"Volume by intensity"** section, however, grouped by the loose `targetIntensity` string field (`"easy"/"moderate"/"quality"` from the CSV plan importer, or `"Easy"/"Moderate"/"Hard"/"Race"` when the AI coach sets it) with its own ad-hoc color scheme — and that color scheme compared against the capitalized AI-coach values only, so for CSV-imported data (lowercase) every bar always rendered the same default gray regardless of intensity (confirmed: the screenshot driving this session showed "easy" and "moderate" both gray). Replaced with `intensityToZone()`, mapping `easy→Z2, moderate→Z3, quality/hard→Z4, race→Z5` (user-confirmed mapping, matching the same easy/tempo/threshold zone conventions `WorkoutBuilder.tsx`'s `typeToZone()` already uses elsewhere), rendered with the shared `ZONE_COLORS` (`lib/planner/types.ts`) and a new local `ZONE_LABELS` constant — which also replaced a second, slightly-differently-worded inline zone-label array that the pre-existing "Zone distribution" section had (`"Z1 Easy"` vs. the `ZONE_NAMES` constant elsewhere saying `"Z1 Recovery"` — left that wording mismatch alone, out of scope, but stopped this file from defining the label list twice with itself).

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass. `intensityToZone()` is a 4-line pure string-comparison function with no edge cases beyond what's listed above; not worth a throwaway test script. Did not exercise the live UI (no browser-automation tool, no test login — see prior sessions) — worth a manual check on `/planner` and `/planner/week` after deploying, especially for a week mixing Running + Orienteering workouts and a week with CSV-imported easy/moderate/quality sessions.

---

**Session 2026-06-23e — Statistical zone estimation now retries with a wider recency window before giving up; investigated a real "Method: fallback" case (user `Elias.ljungdell@gmail.com`).**

1. **Root cause, found via production `pm2 logs` (debug=true is always on for the manual "Apply zones" call):** `estimateZonesFromStatisticalAnalysis()` had plenty of data — 263 and 363 weighted points respectively in the two passes, both far above the `points >= 40` minimum — but they collapsed into a **single** 15 sec/km pace bucket (`monoBuckets=1`, needs `>= 6`). With only one bucket there's no pace-vs-HR curve to find a breakpoint in, so the function correctly returned `null` rather than guess, and `updateHRZones()` fell all the way back to fixed percentages (`zonesMethod: "fallback"`). This was not a data-volume problem — the existing `points >= 40` and `mono >= 6` debug log lines (already in `estimateZonesFromStatisticalAnalysis()`, [lib/fitness/zones.ts](lib/fitness/zones.ts)) made the actual failing gate immediately visible without needing direct DB access.
2. **Fix — escalating half-life fallback in [lib/fitness/zones.ts](lib/fitness/zones.ts):** `estimateZonesFromStatisticalAnalysis()` gained an optional trailing `halfLifeOverrideDays` param that bypasses the normal 90-180-day auto-computed half-life when set. `estimateZonesFromActivities()` now tries the standard recency-weighted pass first (unchanged behavior, returned immediately if it succeeds), and only if that returns `null` does it retry with `EXTENDED_HALFLIFE_LADDER_DAYS = [270, 365, 545, 730, 1095]`, stopping at the first half-life that produces a usable result. This is a strict superset of the old behavior — any case that used to succeed still succeeds identically on the first try; only previously-`null` cases are affected. `StatisticalZoneResult` gained `usedExtendedWindow?: boolean` so callers know which path produced the result.
3. **`updateHRZones()` in [lib/fitness/cache.ts](lib/fitness/cache.ts):** `zonesMethod` gained a new value `"statistical-historical"`, set instead of `"statistical"` when `statResult.usedExtendedWindow` is true — surfaced as-is in the `/api/coach/calibrate` response and the Stats page's "Method: …" line, so the user/AI coach can tell a result leaning on older training data apart from one reflecting current fitness (the explicit design intent of recency-weighting documented in `docs/fitness/hr-zone-statistical-estimation.md` §6).
4. **Tooltip** (`statZones` in [lib/fitness/tooltips.ts](lib/fitness/tooltips.ts)) updated to mention the automatic look-back and the new method label.
5. **Open question, not yet resolved:** a production SQL check of Elias's whole-activity pace (`distance/movingTime`) showed a similar coefficient of variation across 2024/2025/2026 (~22-26%) — no single older year stands out with obviously more pace variety than the others. That weakens (but doesn't rule out — this was whole-activity average, not the lap-level GAP buckets the algorithm actually uses) the theory that simply reaching further back will fix *this specific* user; the `monoBuckets=1` collapse could instead be the pool-adjacent-violators step merging everything due to noisy/inconsistent lap-level HR rather than a too-narrow time window. Flagged to the user as unconfirmed — needs re-running "Apply zones" on his account after this deploys and re-checking the `[zones:debug]` log to see whether `usedExtendedWindow` actually finds `>=6` mono buckets, or still collapses to 1 even at the 1095-day rung (which would point at HR data quality as the real root cause instead).

**Verification:** `pnpm build --no-lint` passes (one transient webpack prerender flake on the first run, unrelated to this change — `/api/races` and `/api/strava/sync` route modules genuinely exist; a clean retry succeeded). The only non-doc call sites of `estimateZonesFromStatisticalAnalysis()` are the two inside `estimateZonesFromActivities()` itself (confirmed via grep), so adding the trailing param was safe with no other caller to update. Not yet verified against Elias's real production data — see open question above; this machine cannot reach the production DB or server logs directly (per `CLAUDE.md`), so confirmation requires the user to redeploy and re-trigger calibration.

---

**Session 2026-06-23f — Research-only session: five new feature plans written, none implemented yet.**

User asked for broad research (not implementation) on five upcoming features, each written up as its own dated plan in `docs/planning/` per the "doc before code" convention, each ending with an explicit validation + archive instruction for whichever agent implements it next:

1. **[RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](Planerattköra/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md)** — race-time predictions are "short a little too slow, long way too fast" for this athlete. Wrote a throwaway script (`scripts/_tmp_race_predict_check.ts`, run then deleted) comparing both existing prediction models (`predictRaceTime`'s global blended-VDOT curve and `riegelPredict`'s personalized-exponent curve) against real stored `RaceRecord` PBs. Confirmed the complaint quantitatively: the default "Peak" column is within ~4% for 1K-5K but -6% to -16% (too fast) at 10K; the "Riegel" column, intended as the personalized fix, is actually *worse* (+17% to +30%, too slow) because `personalizedFatigueExponent()` fits one log-log slope across 1K-to-marathon `bestEfforts`, mixing anaerobic-domain and submaximal-long-run data into a single, too-steep exponent (1.1997 vs. standard 1.06) that's then wrongly extrapolated locally from a single Mile anchor. Root cause and a concrete fix direction (regime-local/bracket-based personalization instead of one global exponent) are documented; not yet implemented.
2. **[GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md](Planerattköra/GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md)** — one-way `PlannedWorkout` → Google Calendar sync, modeled directly on the existing Strava/Garmin OAuth pattern (raw `fetch`, not the `googleapis` SDK, to stay consistent with the rest of the codebase). Flags one open design decision before implementation: all-day calendar events (no schema change) vs. timed events (requires adding a planned-time field) — recommends all-day for MVP.
3. **[KIMI_FREE_MODEL_PLAN_2026_06_23.md](Planerattköra/KIMI_FREE_MODEL_PLAN_2026_06_23.md)** — verified (web research, not assumed) that Kimi K2 is genuinely free only via OpenRouter's `:free` model variants (50 req/day, no card ever required); Moonshot's own API requires a $1 minimum recharge, and Kimi K2 on Groq (already integrated for Llama) is paid, not covered by Groq's no-card free tier. Plan is a near-mechanical extension of the existing Groq/NVIDIA "OpenAI SDK + custom baseURL" provider pattern, with exact file/line touch-points enumerated (`AISettings` schema, `lib/ai/client.ts`, both coach chat/calibrate routes, `ai-settings.tsx`).
4. **[POST_WORKOUT_AI_SUMMARY_PLAN_2026_06_23.md](Planerattköra/POST_WORKOUT_AI_SUMMARY_PLAN_2026_06_23.md)** — event-driven (not time-cron) AI summary sent after each new synced activity. Identified the exact hook points across all three activity-creation code paths in `lib/strava/sync.ts` (only one of which currently fires the existing `tryMatchActivity` post-create hook — a pre-existing gap flagged for the implementing agent to verify). Recommends a shared Telegram bot (one app-wide bot token + per-user `chat_id`) as the notification channel over ntfy/email/webpush, but flags the channel choice as a real open product decision to confirm before building.
5. **[AUTO_PB_DETECTION_PLAN_2026_06_23.md](Planerattköra/AUTO_PB_DETECTION_PLAN_2026_06_23.md)** — automatic vs. manual PB detection, toggle proposed on `AthleteProfile` (default `"manual"`, no behavior change for existing users). Recommends detecting purely from `Activity.bestEfforts` (exact Strava-computed segment times, already trusted by the VDOT estimator) rather than whole-activity ±20%-tolerance matching, which sidesteps GPS-distance noise entirely. Proposes requiring `isRace=true` only to seed a *first* PB on a never-before-tracked distance, not to beat an existing one — documented as a deliberate, adjustable judgment call.

Plans 4 and 5 share the same new-activity hook point and are written to cross-reference each other so whichever gets implemented first doesn't create a competing hook the second has to untangle.

**Verification:** N/A — no application code changed this session. Each plan's own "Slutinstruktion till implementerande agent" section requires the implementing agent to validate against real data/a real account before marking it done and moving the file to `docs/planning/archive/`.

**Note:** the five plan files were subsequently moved by a concurrent session from `docs/planning/` directly into a new `docs/planning/Planerattköra/` subfolder (not this session's doing — links above updated to match, per the project's "multiple concurrent sessions on one checkout" pattern, see memory).

---

**Session 2026-06-23g — Critical review pass on all five 2026-06-23f plans; each updated in place with concrete, verified findings (not just a review report).**

User asked for a critical review of the five plans above to catch design flaws before any implementation starts. Re-verified specific claims against the actual source files (not just the prose already written) and against fresh web research, then edited each plan file directly:

1. **Race estimate plan:** confirmed Purdy Points isn't a better fit for the actual problem distances (5K-10K) per the literature, so the regime-aware Riegel approach stays; added an explicit requirement that the fix degrade gracefully on sparse per-distance data and keep `FitnessCache.predictionsJson`'s consumers (`fitness-metrics.tsx` + the AI coach's `get_fitness_metrics` tool) in sync if the field semantics change.
2. **Google Calendar plan:** web research confirmed Google's Calendar API does *not* expose all-day-event reminder settings — escalated the all-day-vs-timed-event choice from "decide later" to "decide with the user before coding," since all-day events may not deliver the time-relevant notification the feature is presumably for. Added explicit handling for a calendar event deleted out-of-band (404 on next update) and flagged the raw-fetch-vs-`googleapis` tradeoff as a real one, not a given.
3. **Kimi plan:** read the exact `chat/route.ts` lines and found the existing NVIDIA/Groq branching is binary ternaries, not a simple OR-chain — adding Kimi as a third branch needs a small provider lookup table, not another nested ternary; documented this concretely with a code sketch. Also surfaced a confirmed OpenRouter `:free`-tier bug where tool-calling can fail outright — and confirmed the existing `try/catch` around the tool-check call already degrades gracefully, so this is a "verify it still does" item, not a new gap to build.
4. **Post-workout summary plan:** found a real, serious gap — `!exists` is true for *every* activity on a user's first full Strava connect, so the naive hook would fire an AI call + notification per historical activity (could be thousands) the moment the feature is implemented. Added a mandatory `postWorkoutSummaryEnabledAt` guard. Also found the originally-sketched Telegram UX ("paste your chat_id into a text field") has no ownership verification — in a multi-user app, one user could type in another user's chat_id and silently receive their workout notifications; replaced with a verification-code flow. Added budget/spend-tracking integration (automatic background AI calls must respect the same monthly budget as manual coach chat, and skip silently rather than crash when exhausted).
5. **Auto-PB plan:** same backfill-flood risk as #4, but worse — auto-created `RaceRecord` rows persist permanently rather than just notifying once. Added the same enable-timestamp guard, plus a separate, explicit user-initiated "scan history for PBs" bulk action so users can still backfill on purpose without the automatic toggle doing it as a surprise side effect.

**Verification:** N/A — still docs-only, no application code touched. Each plan's validation section now includes an explicit test for its new critical-risk finding (backfill-guard test, chat_id-verification test, etc.) that the implementing agent must pass before archiving the plan.

---

**Session 2026-06-23g — Planner: active interval time in the builder preview, real pace-zone estimates instead of a flat default, auto-save on every edit flow, and two layout fixes (template card truncation, collapsible main sidebar).**

1. **Active interval time + real pace-zone estimates** ([lib/planner/estimate.ts](lib/planner/estimate.ts)): `estimateSections()` now returns `activeSec` separately from `totalSec` (work time vs. work+rest), shown in the builder's "Estimated" preview as "Active interval time" once it differs from the total. Sections missing one dimension (time-only → no distance; distance-only → no explicit pace) are now estimated using the athlete's real calibrated pace for that zone (`paceZonesToRanges()`, new in [lib/fitness/zones.ts](lib/fitness/zones.ts)) instead of a flat 6:00/km guess — wired into both template API routes via the user's `FitnessCache.vdot`, and into the builder via its existing `paceZones` prop. De-duplicated the `[easy, marathon, threshold, interval, repetition] → [z1..z5]` array-building that `app/(dashboard)/planner/page.tsx` already did inline.
2. **Real bug found and fixed while building the above:** `formatDuration()` ([lib/utils.ts](lib/utils.ts)) assumed whole-second integer input — true for every prior caller (DB-stored `Int` durations) — and rendered fractional seconds as a literal garbage string (`"34:43.13898091040028"`) once the new pace-zone math could produce non-integer estimates. Now rounds the input first. Caught via live browser verification (Playwright), not by reading the code — a textbook case for why a UI feature needs an actual browser check, not just `tsc`/`build`.
3. **Auto-save across planner edit flows** ([planner-client.tsx](app/(dashboard)/planner/planner-client.tsx), [WorkoutBuilder.tsx](components/planner/WorkoutBuilder.tsx), [BlockEditorModal.tsx](components/planner/BlockEditorModal.tsx)): editing an existing template, planned workout, or training block now saves automatically (debounced ~800ms) instead of requiring an explicit "Save changes" click — matching the pattern the Sports settings page already used. User-confirmed design decision: Cancel now reverts the server-side resource back to its state when the editor opened (a snapshot — the relevant `editingTemplate`/`editWorkout`/`editingBlock` state itself, which never gets reassigned while its modal is open, serves as that snapshot with no extra state needed), rather than just closing with whatever had already auto-saved. Creating a brand-new template/workout/block is unchanged — nothing exists yet to attach an auto-save to. Also found: `PATCH /api/planner/templates/[id]`'s validation failure had no `detail`, and both editor flows silently swallowed a failed save with zero feedback — both fixed (toast on failure now).
4. **Investigated, not fully root-caused: user reported "Save changes" on an edited template not persisting.** Reproduced realistic interval-block payloads against the real `sectionSchema`/`updateSchema` via a throwaway script — all validated successfully, ruling out a validation-rejection theory. Confirmed the user had already deployed (with `prisma db push`) before testing, ruling out a missing-migration theory. Root cause not conclusively found; the auto-save rework plus the now-visible failure toasts are the practical mitigation — if it recurs, the toast will say why instead of failing silently.
5. **Template card title truncation** ([TemplateCard.tsx](components/planner/TemplateCard.tsx)): the hover-only action icons (edit/add/delete) used `opacity-0` rather than actually being removed from layout, so they permanently reserved ~100px from the title's available width regardless of how wide the templates panel was resized — looked exactly like "plenty of space, title still truncates" because the reserved space was invisible. Switched to `hidden md:group-hover:flex`. Also fixed the stats row (duration/distance/section count) clipping instead of wrapping at narrow widths, and "1 sections" grammar.
6. **Collapsible main sidebar** ([components/sidebar.tsx](components/sidebar.tsx)): the app-wide left nav can now collapse to an icon-only rail (desktop only — mobile keeps the full drawer), `localStorage`-persisted, following the exact pattern the planner's own `TemplateLibrary` sidebar already used.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass. Unlike prior sessions this one **did** get a real browser check — started the local Postgres container (Docker was stopped; started it, ran `prisma db push` to sync this session's schema), seeded a dedicated, isolated test login (`scripts/seed-user.ts`, deleted after testing), and drove the app end-to-end with Playwright: confirmed the sidebar collapses/persists/expands correctly, built and saved a real `6×1km Z4 + 90s Z1 rest` interval template and watched the formatDuration bug appear live (then fixed it and re-confirmed clean output), and confirmed the template card shows its full title once widened and reflows correctly on hover. This is the first session this conversation where "no browser-automation tool available" (see [[feedback_verification_no_browser]]) no longer applied — `npx playwright` was already cached and usable without a fresh install.

**Noted but not actioned:** this session ran concurrently with another active session on the same machine/checkout (commits `c3cd8dd`, `17f915e`, both already on `main` by the time this session's work was committed — an unrelated zone-estimator fix and a docs-only research session). A `lib/fitness/zones.ts` read briefly caught that session's edit mid-write (a transient race, not a real bug — confirmed correct on a follow-up read). Both sessions' changes coexist correctly in the final `tsc`/`build` check above.

---

**Session 2026-06-23h — Root-caused and fixed the second-user (`Elias.ljungdell@gmail.com`) statistical zone estimator "fallback" case from earlier sessions; found and fixed an unrelated, real LT2-display inversion bug along the way.**

Extensive live production investigation (debug logs + direct SQL against the production DB, run by the user since this machine cannot reach it) ruled out several plausible-looking hypotheses before finding the real mechanism:

1. **Ruled out:** lap-distance/duration floor (800m/180s) — initially suspected, but real HR-kinetics research (HR needs ~3 time constants, ~90-150s, to approach steady state after an effort-level change) showed lowering it would have fed the regression physiologically-invalid (pace, HR) pairs from short severe-domain reps whose avgHR is still mid-rise, not at steady state. Confirmed empirically: his "I-RUN 12x400" 400m reps (75-80s) showed avgHR of 142-175bpm against a 194 maxHR — far below what sustaining that pace would actually demand, exactly as HR-kinetics predicts. Left this floor untouched.
2. **Ruled out:** `VirtualRun` sportType exclusion in `nameOnlyOlFilter()` — checked via SQL; the user's activities are 100% `Run`/`TrailRun`, zero `VirtualRun`.
3. **Ruled out:** backfill bug — `lib/strava/backfill.ts`/`sync.ts` store Strava's lap array verbatim, no transformation; the degenerate near-zero-distance laps found in the data are genuine raw Strava artifacts (stray lap-button presses / GPS pause-resume), not something a backfill re-run would fix.
4. **Real root cause, confirmed via a new temporary debug log** (per-pace-bin point count + accumulated weight, added to `estimateZonesFromStatisticalAnalysis()` in [lib/fitness/zones.ts](lib/fitness/zones.ts)): his fast/threshold-pace laps are genuine and properly long (e.g. "4x4min" 2026-03-27: four 240s/~1000m reps; "I-run - Tusingar": five ~1000m reps at 213-221s) but land across many *different* adjacent 15 sec/km bins due to normal rep-to-rep pace variation, combined with an aggressive 90-day recency half-life (triggered because he trains very frequently — ≥50 runs in the last 90 days). Each individual bin's accumulated weight stays under the `MIN_EFF_WEIGHT=8` threshold even though the underlying data is valid, so only one (slow, very consistent) bin ever qualified — hence `rawBuckets=1`. Separately, several otherwise well-structured interval sessions ("10x3min"/"Tröskel 3x10min" 2025-12-14, "Dist med Noa" 2025-12-22) have *zero* heart-rate data on any lap at all — not fixable, just a sensor/recording gap.
5. **Fix that actually resolved it:** the escalating half-life fallback already shipped in Session 2026-06-23e (`EXTENDED_HALFLIFE_LADDER_DAYS`) found a working result at `halfLife=270d` — wider bins of accumulated weight across a longer window resolved the fragmentation, producing `rawBuckets=15 monoBuckets=6 slopeMax=0.317 rSquared=1` and a successful `statistical-historical` result (LT1=169bpm, LT2=180bpm). Confirmed live in production.
6. **Unrelated bug found via the resulting UI screenshot:** the newly-produced LT2=180bpm (92.8% of this user's 194 maxHR) exposed a real, pre-existing inversion in `ltBoundaries()` ([lib/fitness/zones.ts:117-124](lib/fitness/zones.ts#L117-L124)) — `ltTrainingRange` used a fixed `91% of maxHR` ceiling, which produced an inverted `[180, 177]` range (shown in the Stats page as "Training range: 180-177 bpm") whenever LT2 itself is at or above 91% of maxHR. An archived bug-audit doc (`docs/planning/archive/HR_BUGAUDIT_AND_FIXES.md`, BUG-2, dated 2026-05-21) had already flagged this exact formula as fragile and proposed using Z4's own bounds instead — that fix was apparently never actually applied before the doc was archived. Applied now: `ltTrainingRange: [zones.z4[0], zones.z4[1]]`, which `ensureValidZones()` already guarantees is ascending.

**Verification:** `pnpm build --no-lint` passes after each of the three commits (`582b7d6` diagnostic logging, `c44fa0f` the ltBoundaries fix). The diagnostic bin-detail log is debug-gated (already always on for the manual "Apply zones" call) and purely additive — no behavior change. Confirmed live in production via the user re-triggering "Apply zones" on the real account and sharing `pm2 logs` output at each step; the final result (`statistical-historical`, R²=1, LT1=169/LT2=180) and the corrected training-range display were both observed directly, not just inferred.

---

**Session 2026-06-23i — Max-HR sensor-artifact cap is now personalized per athlete instead of one fixed 190bpm global constant.**

Follow-on from Session 2026-06-23h's physiology research (LT2 at 92.8% of a 194 maxHR is plausible per the heart-rate-deflection-point literature) — the user pointed out the deeper issue: `MAXHR_ARTIFACT_CAP=190` in [lib/fitness/zones.ts](lib/fitness/zones.ts) was a single global threshold applied to every athlete, which is wrong in both directions (too low for a 220-maxHR athlete, too permissive for one whose real ceiling is ~180).

1. **Researched the right technique:** confirmed via web search that Hampel/MAD (median absolute deviation) filtering is the established method for sensor-artifact rejection in wearable HR data. A naive application to *all* per-activity max-HR readings would be wrong though — easy days legitimately produce low "max HR," contaminating the median — so the new `estimatePersonalizedArtifactCap()` restricts to the athlete's hardest-effort 15% of activities first, then applies Hampel filtering within that tail only.
2. **Validated against real local dev DB data** (1654 of the user's own activities) before writing any production code, per established practice (`scripts/_tmp_*.ts`, written and deleted, never committed). First pass used the textbook Hampel "3× robust-sigma" extreme-outlier threshold — produced cap=197, which the user (knowing their own physiology) flagged as too loose, with an explicit ask to make it stricter for everyone, and to make sure the cap could move *down* as well as up for individuals with a lower real ceiling (not just raise it for high-maxHR athletes).
3. **Retuned empirically:** tested several tail-percentage/multiplier combinations and confirmed via iterative re-trimming (recomputing median/MAD after excluding points beyond the candidate cap, repeated to confirm stability) that the multiplier — not under-iteration — was the lever that mattered. Settled on 1× robust-sigma (not the classic 3×): gives cap=188 against a stated real max of ~185bpm, vs. 197 from the textbook threshold. The 15%-tail's raw median (184) alone was already very close to the true ceiling — confirms the formula needed to be tight, not the conventional generic-outlier-detection margin.
4. **Wired in** ([lib/fitness/cache.ts](lib/fitness/cache.ts) `updateHRZones()`): `artifactCap = profile?.maxHRArtifactCap ?? estimatePersonalizedArtifactCap(maxHRs)` — manual override still always wins; the personalized estimate is the new default, falling back to the fixed 190bpm constant only when an athlete has under 50 activities with `maxHeartrate` (too little data for a reliable per-athlete tail). Settings UI ([athlete-profile.tsx](app/(dashboard)/settings/athlete-profile.tsx)) copy updated to describe the auto-calculated default instead of a flat "190."
5. **Investigated other-harm risk** (explicitly requested): confirmed `estimateMaxHRFromRaces()` has its own independent ≤210bpm clamp regardless of the cap, so race-derived maxHR can't run away even if a personalized cap is unusually high. Confirmed `updateVO2maxAndPaces()` doesn't duplicate this cap logic — it reads `maxHR` from the already-computed `FitnessCache` row, so no second implementation needed updating. Confirmed `MAXHR_ARTIFACT_CAP` (the constant) has no other direct external consumers besides its own function's fallback default.

**Verification:** `pnpm build --no-lint` passes. Validated twice against real production-grade data (not synthetic): the local dev DB's 1654 real activities (this session) and the prior session's live production findings for the second user. Not yet verified end-to-end against the second user's production account specifically (would require him re-running "Apply zones" again) — the formula's behavior was validated generically against ground-truth-confirmed local data instead, which is the stronger validation since the true max HR was independently known going in.

---

**Session 2026-06-23j — Auto-PB-detection plan (docs-only) broadened from "strict new PB only" to "all race/training results within a configurable tolerance of PB."**

User asked to widen [AUTO_PB_DETECTION_PLAN_2026_06_23.md](Planerattköra/AUTO_PB_DETECTION_PLAN_2026_06_23.md)'s scope: track every competition or training result on a distance that falls within a tolerance band below PB, not just outright new bests, for a richer per-distance result history rather than a pure "record book." Updated the plan (still pre-implementation, no app code touched):

1. **Confirmed `races-client.tsx` already fully supports this with zero UI changes** — its history table already renders every `RaceRecord` per distance with a "vs PB" delta column, and the timeline chart already plots every result with only the PB marked via `ReferenceDot`. The entire change is backend-only: the detection rule (§4 step 5) now saves a result whenever `newTime <= best * (1 + tolerancePct / 100)`, one unified condition instead of a strict-improvement-only check.
2. Added `pbDetectionTolerancePct` (proposed default 5%, user-configurable 1-20%) alongside the existing `pbDetectionMode` field, surfaced in Settings only when "Automatic" is selected.
3. Flagged that this broadening makes the backfill-flood guard (§2b, from the prior critical-review pass) *more* important, not less — a wider tolerance matches more historical activities if the enable-timestamp guard were ever skipped.
4. Added explicit validation steps for the tolerance boundary (just-inside vs. just-outside cases) and for changing the percentage actually changing what gets saved.

**Verification:** N/A — still docs-only. The plan's own validation section (§8) now requires testing the tolerance logic against real synced activities before the implementing agent archives it.

---

**Session 2026-06-24 — Automatic PB / near-PB detection implemented end-to-end, per [docs/planning/archive/AUTO_PB_DETECTION_PLAN_2026_06_23.md](archive/AUTO_PB_DETECTION_PLAN_2026_06_23.md).**

1. **Schema** ([prisma/schema.prisma](prisma/schema.prisma)): `AthleteProfile` gained `pbDetectionMode` (`"manual"|"automatic"`, default `"manual"` — no behavior change for existing users), `pbDetectionModeChangedAt` (backfill guard), `pbDetectionTolerancePct` (default 5).
2. **New `lib/races/distances.ts`**: `RACE_DISTANCE_PRESETS` — the canonical distance-label↔meters list, now shared between manual entry (`races-client.tsx`'s `PRESETS`, previously its own hardcoded copy) and automatic detection, so a manually-entered "Mile" and an auto-detected "Mile" always land in the same history bucket. Extended beyond the old manual-entry list to also cover every distance Strava computes a `bestEffort` for (2 Mile, 10 Mile, 20K, 30K) — without this, those Strava-only distances could never be auto-detected.
3. **New `lib/races/pb-detection.ts`**: `shouldRecordResult()` (pure — a result is recorded if it beats or is within `tolerancePct`% of the current best for that distance, or seeds the first-ever entry on an untracked distance only when `Activity.isRace === true`), `detectPBsForActivity()` (DB-touching, idempotent per activity+distance, used by both the live hook and the bulk-scan endpoint), and `detectAndRecordPBs()` (the live-sync entry point — checks `pbDetectionMode` and the `pbDetectionModeChangedAt` guard itself).
4. **Wired into [lib/strava/sync.ts](lib/strava/sync.ts) at all three activity-creation paths** (`syncActivities`, `resyncRecentActivities`, `syncSingleActivity`) — fire-and-forget after the upsert, same pattern as the existing weather-fetch/`tryMatchActivity` side effects, and only for genuinely new activities. `syncSingleActivity` previously had no `exists` check at all (the webhook path always just upserted) — added one so the new hook (and any future one) can tell create from update.
5. **New `POST /api/races/scan-history`**: the explicit, user-initiated bulk backfill action from the plan's §2b — bypasses `pbDetectionMode`/the timestamp guard entirely (it *is* the deliberate alternative to automatic backfilling), processes the user's full running history oldest-first so each result is compared against the true best-so-far at that point in time, returns the created rows so the UI can show them immediately without a full reload.
6. **Settings UI** ([athlete-profile.tsx](app/(dashboard)/settings/athlete-profile.tsx)): Manual/Automatic radio + a tolerance-percentage input (shown only in Automatic mode). **API** ([app/api/settings/profile/route.ts](app/api/settings/profile/route.ts)): the tricky part — `pbDetectionModeChangedAt` must only be stamped on an actual manual→automatic *transition*, never on every save while already automatic (which would silently re-arm the backfill guard each time and mask activities synced between two unrelated profile edits); implemented by reading the existing stored mode before deciding whether to stamp it.
7. **Races UI** ([races-client.tsx](app/(dashboard)/races/races-client.tsx)): "Scan history for PBs" button next to the existing "Link activities" button. Confirmed during planning (re-verified here) that the history table and timeline chart already render every `RaceRecord` per distance with a "vs PB" delta — no other UI change was needed for the "track near-PB results too" requirement.
8. **User's explicit requirement** ("tävlingsnamnet skrivs in som namnet på aktiviteten") — `RaceRecord.eventName` is set to `Activity.name` (the actual Strava activity title) for every auto-detected row, confirmed in the positive-case validation below (`eventName="Åmilen!"`, matching the source activity's real name).

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass (the new `/api/races/scan-history` route appears in the build's route list). Validated against real local dev DB data with a throwaway script (run then deleted, no `_tmp_*` files committed):
- 7/7 pure `shouldRecordResult()` cases passed (strict PB, within-tolerance, outside-tolerance, exact tie at 0% tolerance, first-entry-requires-race, first-entry-rejected-without-race).
- `matchTrackedDistance()` correctly matched all 13 canonical distances plus a near-miss (1503m→1500m) and correctly rejected a distance with no match.
- Ran `detectPBsForActivity()` against the 5 most recent real activities — correctly found nothing to record (all easy/interval training, none close to any PB).
- Ran it against a real activity ("Åmilen!", a flagged race) whose 5K `bestEffort` exactly tied the existing 5K PB from the same activity: correctly **skipped** the already-recorded 5K (idempotency), correctly recorded two never-before-tracked distances from the same race (800m, 2 Mile — allowed because `isRace=true`), and correctly recorded two near-PB (not-best) results within tolerance (1K at +7.0%, Mile at +2.7%) with `eventName` set to the real activity name. Re-running the exact same activities a second time created zero additional rows, confirming idempotency. All test-created rows were deleted afterward, leaving the dev DB exactly as found.

---

**Session 2026-06-24b — Kimi K2.5 added as a new model on the existing NVIDIA NIM provider, not a new 5th provider.**

Asked to investigate whether Kimi was available free via NVIDIA, following up on the archived `KIMI_FREE_MODEL_PLAN_2026_06_23.md`, which had concluded (after checking Moonshot's own API and Groq) that OpenRouter was the only genuinely free path, recommending a whole new provider. That research hadn't checked NVIDIA NIM itself. It turns out **Kimi K2.5** (newer than K2/K2.6 — 1T-param multimodal, 256K context) is hosted directly on NVIDIA NIM at the exact same `https://integrate.api.nvidia.com/v1` endpoint and `NVIDIA_API_KEY` this app's existing `lib/ai/nvidia.ts` provider already uses. Verified via web search (not guessed): NVIDIA's free tier is an ongoing rate-limited tier (40 RPM, no card) since the old credit-trial system was phased out in early 2025 — not a one-time allowance — and has no daily cap, unlike OpenRouter's Kimi `:free` variants (50 req/day, which the same archived plan itself flagged as a real problem for an active coach chat).

Added `moonshotai/kimi-k2.5` to `NVIDIA_MODELS` ([lib/ai/nvidia.ts](lib/ai/nvidia.ts)) as the new `NVIDIA_DEFAULT_MODEL` — existing users keep whichever model they already had selected; only new/unset selections get the new default. Updated the provider comparison table and prose in [ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx), the NVIDIA NIM section in [docs/integrations/strava.md](docs/integrations/strava.md), and the `nvidiaModel` field comment in `prisma/schema.prisma` (comment only, no migration needed). Updated the archived plan file with a supersession note explaining why, rather than implementing it as written — its OpenRouter approach remains valid as a fallback if NVIDIA ever drops this model.

**Verification:** `npx tsc --noEmit` passed. Could not run `pnpm build --no-lint` this time — another concurrent session on this same machine had a dev server running against the shared `.next` directory at the time (confirmed via `netstat`), and building would have corrupted its cache. Relied on `tsc` plus a careful manual diff review instead. Not yet tested against a real NVIDIA account with Kimi selected — recommend a quick real coach-chat test with Kimi K2.5 selected (including a query that triggers a tool call, e.g. "what's my VDOT?") before considering this fully confirmed working end-to-end.

---

**Session 2026-06-24c — Sidebar collapse/expand toggle moved to the bottom; logo, nav, and Settings icons now pixel-identical in size and position between collapsed and expanded states.**

1. Refactored [components/sidebar.tsx](components/sidebar.tsx) from two separate JSX trees (one for the collapsed rail, one for the expanded sidebar) into a single shared tree. The only difference between states now is the `<aside>` width and each row's label `<span>` collapsing via `max-w-0 opacity-0` (vs `max-w-[160px] opacity-100`) — icons themselves never change size, padding, or DOM position when toggling, instead of the old design where collapsed/expanded each rendered icons with different sizes and centering schemes.
2. Moved the collapse/expand toggle (`PanelLeftClose`/`PanelLeftOpen`) out of the header (next to the logo) into its own row at the bottom of the sidebar, below Settings and the theme toggle, in both states — previously the *only* way to re-expand from the collapsed rail was clicking the logo itself.
3. Unified the Settings icon size from 16px to 18px (`ICON_SIZE`, matching the nav icons), and the logo icon is now always 24px (`LOGO_SIZE`) in both states instead of 24px collapsed / 34px expanded.
4. Split `LogoText` out of `LogoWordmark` in [components/logo.tsx](components/logo.tsx) — no visual or API change for existing `LogoWordmark` call sites (login/register/pending pages) — so the sidebar can wrap just the text half in a width-animating clip container while the `Logo` icon itself is untouched; `LogoWordmark` is now just `<Logo>` + `<LogoText>` composed together.

**Verification:** `pnpm build --no-lint` passes. Real browser check via a throwaway seeded test user (created via `scripts/seed-user.ts`, activated directly via Prisma, deleted afterward) + Puppeteer (resolved from the existing npx cache, no new install): logged in, read `getBoundingClientRect()` for the logo icon, first nav icon, and Settings icon in both the expanded and collapsed states — all three reported identical x/y/width/height before and after toggling collapse. Confirmed via `document.elementFromPoint()` that the only thing visually overlapping the new bottom collapse button in screenshots was Next.js's own dev-mode floating indicator (a `<nextjs-portal>` element, dev-only, unrelated to the app).

---

**Session 2026-06-24d — One-way Planner → Google Calendar sync implemented end-to-end, per [docs/planning/archive/GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md](archive/GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md).** Two decisions the plan flagged as needing the user first were resolved before coding: all-day events (not timed — simplest, no schema change), and step-by-step Google Cloud setup instructions (the user hasn't set up an OAuth client yet) rather than assuming one exists.

1. **Doc written first** ([docs/integrations/google-calendar.md](docs/integrations/google-calendar.md)), per `docs/guides/documentation-rules.md` — full Google Cloud Console walkthrough (project → enable Calendar API → OAuth consent screen + `calendar.events` scope + Testing-mode 7-day refresh-token-expiry warning → OAuth client → redirect URI), plus the data flow, all-day exclusive-end-date quirk, token refresh behavior, and per-event 404 handling.
2. **Schema** ([prisma/schema.prisma](prisma/schema.prisma)): new `GoogleCalendarAccount` model (encrypted tokens, `calendarId` default `"primary"`, `needsReconnect` flag), `AppConfig.googleClientId/googleClientSecret`, `PlannedWorkout.googleEventId`. `lib/config.ts`'s `AppCredentials`/`getCredentials()` and `/api/settings/credentials` extended with the same DB→admin→env fallback chain Strava/Garmin already use.
3. **`lib/google-calendar/client.ts`** — raw `fetch`, no SDK (kept consistent with `lib/strava/client.ts`/`lib/garmin/*`, a deliberate tradeoff flagged in the plan's critical-review pass): OAuth URL builder (`access_type=offline&prompt=consent` to guarantee a refresh token), code exchange, `refreshGoogleToken()` (dedupes concurrent refreshes like Strava's version; correctly does *not* overwrite `refreshToken` on a normal refresh — Google only reissues it on first consent, unlike Strava which rotates it every time; sets `needsReconnect` on `invalid_grant`), and `googleCalendarFetch()` (2-attempt linear-backoff retry on 5xx/429, throws a distinct `GoogleCalendarNotFoundError` on 404 so callers can special-case a deleted event).
4. **`lib/google-calendar/sync.ts`** — `createEvent`/`updateEvent`/`deleteEvent`/`pushUpcomingWorkouts`. All-day event body uses `toAllDayRange()` to handle Google's *exclusive* end-date (`end.date` must be the day after `start.date`) — verified against year-rollover and leap-day boundaries. `updateEvent()` catches `GoogleCalendarNotFoundError` specifically: clears the stale `googleEventId` and recreates the event rather than throwing. Title gains a `✓`/`✗` prefix when a workout is marked completed/missed. Description includes a short per-section summary when the workout has a linked template.
5. **Wired into the planner workout routes** ([app/api/planner/workouts/route.ts](app/api/planner/workouts/route.ts) POST, [[id]/route.ts](app/api/planner/workouts/[id]/route.ts) PATCH/DELETE) — fire-and-forget, same pattern as the existing weather-fetch side effect, never blocks or fails the planner CRUD response.
6. **New routes**: `app/api/google-calendar/callback`, `/sync` (the explicit "push upcoming workouts" backfill — future-only, never touches history), `/disconnect`.
7. **Settings UI**: [google-calendar-connect.tsx](app/(dashboard)/settings/google-calendar-connect.tsx) (mirrors `strava-connect.tsx`'s redirect-URI/credentials/connect pattern, plus a `needsReconnect` warning banner) wired into [settings/page.tsx](app/(dashboard)/settings/page.tsx) as a third integration card; `GOOGLE_CALENDAR_GUIDE` added to [components/setup-guide.tsx](components/setup-guide.tsx).

**Verification:** `npx tsc --noEmit` passes clean. `pnpm build --no-lint` could not complete — a concurrent session's `pnpm dev` was actively writing to the same `.next/` directory throughout (three consecutive attempts each got past "Compiled successfully" and failed afterward with a *different* `.next/cache`-related error each time — the signature of a filesystem race, not a deterministic code error). Verified the two genuinely tricky pieces of logic in isolation instead, via a throwaway script (run then deleted): `toAllDayRange()` against four boundary dates (plain day, year rollover, Feb→Mar in a leap year, the leap day itself) and the section-description/title formatters against representative inputs — all correct. **Not yet tested against a real Google account** — no OAuth client exists yet; the user chose to receive setup instructions (`docs/integrations/google-calendar.md`) rather than provide existing credentials, so end-to-end verification (connect → create/edit/delete a workout → confirm in Google Calendar app) is pending the user completing that setup. Recommend a full manual pass through `docs/planning/archive/GOOGLE_CALENDAR_SYNC_PLAN_2026_06_23.md` §8's validation steps once credentials are in place, including the conflict case (delete a synced event directly in Google Calendar, then edit the same workout in TrainingLab).

---

**Session 2026-06-24e — Fixed a real regression in the previous session's (2026-06-24c) collapsible-sidebar refactor: the TrainingLab wordmark was silently losing its leading "Tr"; also centered rail icons and moved the collapse toggle next to the theme toggle per user screenshots.**

User reported via screenshots: (1) the collapse-sidebar control should sit beside the theme toggle in one row, not as its own full-width bordered button below it; (2) the logo text was rendering as "ainingLab" instead of "TrainingLab" at full size; (3) collapsed/rail-mode icons (logo, nav, Settings) were left-aligned instead of centered in the narrow rail.

1. **Root cause of (2):** [components/logo.tsx](components/logo.tsx)'s `LogoText` used a negative `marginLeft` to pull the text tight against the T-icon — correct in a plain flex row (`LogoWordmark`, used unchanged on login/register/pending), but 2026-06-24c had wrapped `LogoText` in its own `overflow-hidden` clipping `<span>` in [components/sidebar.tsx](components/sidebar.tsx) so the label can animate away when collapsing. A negative *leading* margin inside an `overflow-hidden` box pulls content past that box's own left edge, which gets clipped — exactly the missing "Tr". Fixed by moving the pull-in to a negative `marginRight` on the icon's own side (new exported `logoPullIn(size)` helper) — applied outside any clipping boundary, so it can never be clipped regardless of what wraps the text.
2. **(3):** added `justify-center` to the logo row, nav links, and the Settings link when `rail` (collapsed) is true — they were already icon-only in that state but left-aligned after the row's own padding rather than centered in the available width.
3. **(1):** theme toggle and collapse/expand button now share one flex row (`gap-1`) when expanded; falls back to stacking each full-width (the previous layout) when collapsed, since two icon buttons don't fit side by side in the 64px rail.

**Verification:** `npx tsc --noEmit` passes. Real browser check via a throwaway seeded test user (`scripts/seed-user.ts`, activated via a one-off Prisma script, deleted after) + Playwright (resolved from the existing npx cache, Chromium already downloaded — no new install): confirmed via `textContent()` the logo now reads the full `"rainingLab"` (plus the icon forms the "T"); confirmed via `getBoundingClientRect()` that every rail icon's center-x sits within 0.5px of the rail's true center; confirmed via bounding boxes that the theme/collapse buttons share one y-position when expanded and use two distinct y-positions (stacked) when collapsed. One screenshot showed what looked like a dark unrelated blob over the bottom buttons — confirmed via `document.elementFromPoint()` and by removing `<nextjs-portal>` elements before re-screenshotting that it was Next.js's dev-mode floating indicator (dev-only, unrelated to the app), not a real rendering bug — consistent with the same false alarm documented in session 2026-06-23i.

---

**Session 2026-06-24f — Fixed a real bug from the previous session (2026-06-24b): NVIDIA retired the `moonshotai/kimi-k2.5` model ID outright, so every NVIDIA-provider coach request 404'd.**

User reported the live coach chat returning `Fel: 404 404 page not found` with NVIDIA NIM/Kimi selected, right after 2026-06-24b had shipped `moonshotai/kimi-k2.5` as the new `NVIDIA_DEFAULT_MODEL`. Verified via web search (not guessed): NVIDIA deprecated `kimi-k2.5` around 2026-04-29/30 with no redirect — the endpoint just 404s — and replaced it with **Kimi K2.6** (`moonshotai/kimi-k2.6`), confirmed via `docs.api.nvidia.com`'s API reference; same 256K-context 1T-param multimodal model, no other behavior change.

1. **[lib/ai/nvidia.ts](lib/ai/nvidia.ts):** swapped the `kimi-k2.5` entry in `NVIDIA_MODELS` and `NVIDIA_DEFAULT_MODEL` for `kimi-k2.6`. Added `resolveNvidiaModel(stored)` — returns `stored` only if it's still a known id in `NVIDIA_MODELS`, otherwise falls back to the current default. This matters beyond just today's fix: the settings UI's save handler ([ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx)) always writes the *current* `nvidiaModel` value to the DB on every save (not just when the dropdown changes), so any user who saved AI settings while `kimi-k2.5` was the default got it persisted as their explicit stored value — a bare `?? NVIDIA_DEFAULT_MODEL` fallback would never catch that, since the DB value isn't null. `resolveNvidiaModel()` self-heals that case (and any future NVIDIA model retirement) without needing a manual DB migration the user would have to apply by hand on the production server.
2. Replaced the duplicated `aiSettings?.nvidiaModel ?? NVIDIA_DEFAULT_MODEL` fallback with `resolveNvidiaModel(...)` at all call sites: [app/api/coach/chat/route.ts](app/api/coach/chat/route.ts) (tool-call model selection, streaming client construction, and the `modelUsed` log written to `Message`), [app/api/coach/calibrate/route.ts](app/api/coach/calibrate/route.ts), and [app/api/activities/[id]/analyze/route.ts](app/api/activities/[id]/analyze/route.ts).
3. Updated the `kimi-k2.5` references in the comparison table + prose in [ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx), the `nvidiaModel` field comment in `prisma/schema.prisma`, and the NVIDIA NIM section of [docs/integrations/strava.md](docs/integrations/strava.md) (added a note there about NVIDIA's no-redirect retirement behavior and the new fallback).

**Verification:** `pnpm build --no-lint` passes clean (after clearing a stale `.next` cache from an earlier interrupted build — unrelated to this change). Not yet re-tested against a real NVIDIA account in the browser — recommend the user retry the exact failing query ("vilken modell är du?") with NVIDIA/Kimi selected once this is deployed to confirm `kimi-k2.6` actually responds instead of 404ing, since NVIDIA's hosted-model availability can only be confirmed by calling the live endpoint.

---

**Session 2026-06-24g — NVIDIA and Groq model dropdowns in Settings now autosave on change, matching the existing provider-switch behavior, instead of requiring "Save settings".**

User asked for this directly after the 2026-06-24f fix, where picking `kimi-k2.6` from the dropdown wouldn't actually take effect until the full "Save settings" button was clicked.

1. **[ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx):** added `selectNvidiaModel()`/`selectGroqModel()`, mirroring the existing `selectProvider()` pattern — optimistic state update, immediate `PATCH /api/settings/ai` with just `{ nvidiaModel }`/`{ groqModel }`, revert + inline error (`nvidiaModelError`/`groqModelError`) on failure. Wired both `<select onChange>` handlers to these instead of bare `setState`. `/api/settings/ai`'s `PATCH` handler ([app/api/settings/ai/route.ts](app/api/settings/ai/route.ts)) already supported arbitrary partial updates (only fields present in the body get written) — no backend change needed.
2. The full "Save settings" button still sends `nvidiaModel`/`groqModel` as before (harmless — same value, idempotent) since it also handles API keys and budgets that still require an explicit save.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass.

---

**Session 2026-06-24h — Researched whether better free AI models exist than what's integrated; found and fixed a second dead-model-id bug (Groq) along the way; built a seamless per-reply rate-limit fallback for the coach chat.**

User asked three things: (1) investigate whether better free models exist than Claude/Gemini/NVIDIA/Groq, (2) make rate-limit hits seamless — auto-switch to whichever integrated model has the airiest limits, with a visible notice, (3) update the Settings comparison info to match.

1. **Research** ([docs/planning/archive/FREE_AI_MODEL_RESEARCH_2026_06_24.md](archive/FREE_AI_MODEL_RESEARCH_2026_06_24.md)) — verified from primary sources, not blog aggregators, after the aggregators disagreed with each other: NVIDIA NIM's general tier is 40 RPM/no daily cap (confirmed via NVIDIA's own forums); Kimi K2.6 specifically is carved out at ~30 req/hour (dedicated forum thread); Groq's `llama-3.3-70b-versatile` is 30 RPM/**1,000 RPD** (official `console.groq.com/docs/rate-limits`), `llama-3.1-8b-instant` gets 14,400 RPD on the same account (much higher cap, smaller/weaker model); **Cerebras** looked like a strong new candidate from third-party blogs (1M tokens/day, GPT-OSS-120B/Qwen3/Llama4 Scout, OpenAI-compatible) but its own official docs (`inference-docs.cerebras.ai/support/rate-limits`) show a **5 RPM** cap — worse than everything we already have for an interactive chat despite the huge daily token volume; not integrated as a result, flagged as a future candidate for batch/background AI work (e.g. the still-unbuilt post-workout-summary plan) instead. Gemini's real current free-tier RPD couldn't be pinned down — Google's own rate-limit/pricing pages defer to a per-account number in AI Studio, and this app has *two* disagreeing legacy numbers already (`docs/integrations/strava.md` said 1,500 RPD since the file's first commit, `ai-settings.tsx` said 25 req/day) — left both as explicitly-flagged unverified rather than guessing a winner.
2. **Found a second dead-model-id bug while researching Groq** (the same class as 2026-06-24f's Kimi K2.5 retirement): `llama3-groq-70b-8192-tool-use-preview` and `mixtral-8x7b-32768` in `GROQ_MODELS` ([lib/ai/groq.ts](lib/ai/groq.ts)) are no longer on Groq's current model list (confirmed via `console.groq.com/docs/models`) — any user with either selected would 404 the same way the Kimi K2.5 bug did. Removed both, added `openai/gpt-oss-120b`, and added `resolveGroqModel()` mirroring `resolveNvidiaModel()`'s self-healing fallback. Wired into the same call sites: [app/api/coach/calibrate/route.ts](app/api/coach/calibrate/route.ts), [app/api/activities/[id]/analyze/route.ts](app/api/activities/[id]/analyze/route.ts), and three sites in [app/api/coach/chat/route.ts](app/api/coach/chat/route.ts).
3. **Seamless rate-limit fallback** — new [lib/ai/fallback.ts](lib/ai/fallback.ts): `isRateLimitError()` (checks HTTP 429 / `RESOURCE_EXHAUSTED` / "rate limit" across the Anthropic/OpenAI-compatible/Google SDK error shapes), `FALLBACK_MODEL` (NVIDIA Nemotron 70B — picked over Groq/Cerebras/Gemini per the research above as the airiest verified limit of anything actually integrated), `getFallbackClient()` (returns `null` — no fallback attempted — if the user has no NVIDIA key on file, or if the thing that just failed *was* already the fallback itself), `modelDisplayName()` for human-readable notice text.
4. **[app/api/coach/chat/route.ts](app/api/coach/chat/route.ts)** — new `streamWithFallback()` helper wraps both the Claude final-stream call (refactored into an inline `AIClient`-shaped adapter so it can share the same fallback path as everything else) and the NVIDIA/Groq/Gemini stream call: on a rate-limit error with zero text sent so far for that reply, retries once with the NVIDIA fallback client and emits a `notice` SSE event; a *partial* stream (some text already sent before the failure) is never retried, since there's no clean way to "unsend" text already on the wire. The fallback never touches the user's saved `provider`/`nvidiaModel`/`groqModel` settings — it's a per-reply decision only, re-evaluated fresh on the next message. `saveAssistantMessage()` simplified to take the actually-used provider/model directly instead of re-deriving it from settings, so `Message.modelUsed` and cost/spend tracking correctly reflect the fallback model (and its $0 cost) when one was used, not the originally-configured one.
5. **[components/coach/ChatInterface.tsx](components/coach/ChatInterface.tsx)** — new `notice` field on `Message`, rendered as a small `AlertTriangle`-icon warning banner above the assistant bubble (same `border-warning/30 bg-warning/5` styling already used for pending tool-action cards), shown once per affected reply.
6. **[ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx)** comparison table + prose updated with the corrected per-model numbers above (Groq "30 RPM, 1K/day", NVIDIA "40 RPM, no daily cap" + a Kimi-specific caveat, Gemini's number flagged with a link to `aistudio.google.com/rate-limit` instead of asserted confidently) and a new paragraph explaining the automatic-fallback behavior and its NVIDIA-key requirement. `docs/integrations/strava.md`'s Groq/NVIDIA sections and Gemini line updated to match, including a new "Rate-limit fallback" subsection.

**Scope decision:** the live-fallback-with-notice behavior was built for the coach chat only (`/api/coach/chat`), not `calibrate` or `analyze` — those are occasional one-shot calls without a structured per-message notice channel (`analyze` streams plain text, not JSON events), so the cost of adding the same machinery there didn't seem proportionate to the benefit. Both got the cheaper `resolveGroqModel()`/`resolveNvidiaModel()` stale-id safety net regardless, since that bug class applies everywhere a model id is read from a user's saved settings.

**Verification:** `npx tsc --noEmit` passes after every step above. Not yet tested against a real rate-limited account (would need to actually exhaust a free-tier quota live) — recommend the user watch for the new warning banner the next time Kimi K2.6's ~30/hour cap is hit during a real coach-chat session, as the first live confirmation.

---

**Session 2026-06-24i — Implemented [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md): replaced the global-exponent Riegel model and the raw global-VDOT "Peak" column with one shared, bracket-based personalized prediction, fixing the "short too slow, long way too fast" complaint at its root.**

Re-ran the plan's diagnostic methodology (a throwaway script, run then deleted, same as the plan's own §8) against real local data before touching any code, to confirm the documented baseline and catch anything that had drifted since the research pass. Found one thing the original research didn't catch: this athlete's `Activity.isRace=true` flag is **exclusively** orienteering events (verified — every single isRace activity in the local DB is an OL race by name; zero road races are ever flagged isRace) — so naively trusting "race-flagged" bestEfforts beyond 10K (as an earlier iteration of this fix did) silently fed in OL terrain/navigation pace as if it were road pace, which is actively worse than the bug being fixed. Final design relies on `RaceRecord` (user-confirmed PBs, already clean) as the only trusted source beyond 10K, with `Activity.bestEfforts` trusted only up to 10K regardless of any race flag.

1. **[lib/fitness/vo2max.ts](lib/fitness/vo2max.ts):**
   - `personalizedFatigueExponent()`: now caps input at 10K (previously 1000m–42200m unfiltered). Empirically this athlete's bestEfforts imply a consistent VDOT 53.8–60 through 10K, then crash to ~41 at 15K and ~27 at marathon distance — that gap is terrain/pacing in non-maximal or off-road segments, not real fatigue, and was previously dragging the global exponent to 1.1997 (vs. standard 1.06).
   - New `personalizedRacePrediction()` — bracket-based local model: finds the runner's own nearest real result(s) (by log-distance) bracketing the target distance and fits a *local* Riegel exponent between just those two, instead of extrapolating one global exponent from a single fixed anchor (previously always the highest-implied-VDOT PB, often the Mile). Falls back to the global exponent for single-sided extrapolation, with confidence scaled by how far the extrapolation reaches.
   - New `buildKnownPerformances()` — merges `RaceRecord` PBs (trusted at any distance) with `Activity.bestEfforts` (trusted only ≤10K) into one deduplicated real-performance set, keyed by distance.
   - New `blendedRacePrediction()` — combines the global Daniels VDOT curve ("peak") with the local bracket model, weighted by how well-anchored the target distance is: ~0.95 weight on the local model for a near-exact real-PB match, 0.85 for a genuine two-point interpolation, decaying toward 0.15 (mostly global curve) for long single-sided extrapolations (e.g. marathon with no marathon PB) — and widens `predictionRange()`'s ± band proportionally in that low-confidence case, instead of presenting an falsely sharp number. Predicted durations under 3.5 minutes (Daniels' %VO2max-vs-duration table is uncalibrated below that) get a `lowConfidenceShort` flag and lean almost entirely on the local model regardless of bracket quality.
   - `predictionRange()` gained an optional `uncertaintyMultiplier` param (defaults to 1, fully backward compatible) used by the widening above.
   - New `computeRacePredictions(vdot, tsb, racePBs, bestEfforts)` — the single canonical implementation of one `predictionsJson` row per `RACE_DISTANCES` entry, replacing three previously hand-duplicated versions (see below).
2. **[lib/fitness/cache.ts](lib/fitness/cache.ts):** both `updateVO2maxAndPaces()` (AUTO, every Strava sync) and `updateHRZones()` (MANUAL, calibration button + profile save) now call `computeRacePredictions()` instead of their own inline `predictRaceTime`/`riegelPredict`/`predictionRange` triplets — these had silently diverged (`updateHRZones()` used zero personalization, plain Riegel 1.06, and would overwrite the AUTO path's better numbers every time the user saved their profile). New exported `loadBestEffortsForRacePredictions()` — `updateHRZones()` uses `loadActivitiesLight()` which deliberately omits `bestEfforts`, so this is a small dedicated query for just that field.
3. **[app/(dashboard)/stats/page.tsx](app/(dashboard)/stats/page.tsx):** the cache-miss SLOW PATH had its own *third*, independently-evolved implementation (`bestAnchorFor()` + a hand-tuned `riegelExponent()` by distance ratio) — already closer to "right" in spirit than the cache.ts versions, but still a third thing that could drift. Replaced with the same `computeRacePredictions()` call.
4. **Deleted `app/api/stats/route.ts` and `docs/api/stats.md`** (confirmed dead code — zero callers anywhere in app code, AI tools, or tests; superseded by the stats page's own SSR computation) after explicit user confirmation, per Bug Audit Practice and the plan's own §5 item 5 instruction to resolve this rather than leave it drifting. It had a fourth, even simpler prediction implementation with no Riegel/personalization at all.
5. **UI/AI sync** (per the plan's §6 explicit warning): [components/stats/fitness-metrics.tsx](components/stats/fitness-metrics.tsx) — "VDOT (peak form)" column renamed to "Estimate (personalized)" since `peak` is now the blended number, not the raw global curve; "Riegel (from PB)" renamed "Riegel (your PBs)"; a `*` badge + footer note appears for any `lowConfidenceShort` row. [lib/ai/tools.ts](lib/ai/tools.ts)'s `get_fitness_summary` tool appends the same low-confidence caveat inline per affected distance.
6. **[prisma/schema.prisma](prisma/schema.prisma):** `predictionsJson` comment updated to include the new `lowConfidenceShort` field (comment-only — `Json?` column, no migration needed).

**Verification:** Ran the actual production functions (`updateVO2maxAndPaces()` and `updateHRZones()`, not just isolated unit logic) against the real local dev DB via a throwaway script, then deleted it. 1K–10K leave-one-out error (predicting each real PB distance with that PB excluded from its own training data) improved from -5.6%/+30% (Peak/Riegel) to within ±3.2% across the board, meeting the plan's ±3-5% target. 15K/HM/Marathon (no real anchor data) correctly widen their uncertainty band (±3.9% → ±13.7% at marathon) instead of staying falsely sharp. Sub-1500m (e.g. 800m) correctly flagged `lowConfidenceShort` rather than forced into a number the model was never calibrated for. `pnpm build --no-lint` passes clean (one `noImplicitAny` fix needed on the new bestEfforts query). Not yet viewed in a real browser — recommend a quick look at the Stats page race-predictions table after deploying to confirm the new column labels and `*` badge render as expected.

---

**Session 2026-06-24j — Bumped the logo size across every view it appears in.**

User asked to make the logo bigger everywhere — confirmed via grep that there are exactly four usage sites in the whole app, all now updated:

1. **[components/sidebar.tsx](components/sidebar.tsx):** `LOGO_SIZE` 24→30. Both the expanded header and the collapsed/rail state share this one constant (per 2026-06-24c/e's deliberate unification — never reintroduce separate collapsed/expanded sizes), so the icon stayed pixel-identical in size between the two states, just larger. Checked the math before changing: header row is a fixed `h-16` (64px) regardless of state, and the rail is a fixed `md:w-16` (64px) with `px-3` padding — 30px leaves comfortable margin in both the 52px available height and the 40px available rail width, well short of the wordmark-clipping regression from 2026-06-24c/e.
2. **[app/(auth)/login/page.tsx](app/(auth)/login/page.tsx), [register/page.tsx](app/(auth)/register/page.tsx), [pending/page.tsx](app/(auth)/pending/page.tsx):** `LogoWordmark` 52→64 (same ~25% proportional bump as the sidebar). These render inside a centered `max-w-sm` column with no tight constraints, so no layout math needed there.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass. Real browser check (Docker Postgres already healthy, seeded a throwaway `claude-verify@local.test` user via `scripts/seed-user.ts`, activated directly via Prisma, deleted after) + Playwright (resolved from the existing npx cache): screenshotted the login page, the expanded sidebar, and the collapsed rail (clicked the collapse toggle) — logo is visibly bigger in all three with no clipping, no overflow, and the rail icon still centered. One hydration-mismatch console warning appeared on the login page (`caret-color` style on the password input) — confirmed unrelated to this change (concerns the password field, not the logo) before disregarding it.

---

**Session 2026-06-24k — User asked to center the sidebar logo "to look nicer"; investigated whether literal centering was actually the right call before implementing it.**

A screenshot of the live production sidebar showed the bigger (2026-06-24j) logo sitting visibly closer to the left edge than the nav icons below it, with empty space to its right. Before centering it as literally requested, checked both the actual cause and the UX convention: confirmed via web search (NN/g's "Centered Logos Hurt Website Navigation" + uxmovement.com) that centering a sidebar logo is a known anti-pattern — users are measurably more likely to miss the home/dashboard click, and it breaks visual rhythm with a left-aligned nav column. The real cause of the "doesn't look right" feeling was simpler: nav icons sit 24px from the sidebar edge (`<nav>`'s own `px-3` + each `<Link>`'s own `px-3` = 12+12px), while the logo header only had a single `px-3` = 12px — a real 12px misalignment, not a missing center.

1. **[components/sidebar.tsx](components/sidebar.tsx):** header's padding changed from a flat `px-3` to `rail ? "px-3 justify-center" : "pl-6 pr-3"` — rail/collapsed state is untouched (still symmetric `px-3` + `justify-center`, preserving the exact centering verified in 2026-06-24e), expanded state's left padding bumped to `pl-6` (24px) to match the nav icons' inset exactly instead of literally centering the wordmark.
2. Explained the tradeoff to the user rather than silently doing the literal ask — implemented the alignment fix as the recommended default per auto-mode guidance, flagged that true centering remains available if they still want it after seeing this.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both pass. Real browser check (same seeded-user + Playwright pattern as 2026-06-24j) with a tight crop screenshot of the header + first few nav rows: the logo's "T" icon left edge now lines up pixel-for-pixel with the nav icons below it. Rail/collapsed state re-screenshotted too — unchanged, still centered.

---

**Session 2026-06-24l — Put the sidebar's Settings link, theme toggle, and collapse button on one row when expanded (previously Settings sat alone on its own row above the toggle+collapse row).**

1. **[components/sidebar.tsx](components/sidebar.tsx):** merged the two separate bottom rows into a single `flex items-center gap-1` row containing the Settings `Link`, `ThemeToggle`, and collapse `button`. Fitting all three in the 192px-wide expanded rail without clipping the "Settings" label required tightening horizontal padding throughout: outer container `p-3`→`px-2 py-3`, Settings link `px-3 gap-3`→`px-2 gap-2`, and both icon buttons `px-3`→`px-2` (kept `py-2.5` on the buttons so their height still matches the Settings link). Rail/collapsed behavior unchanged — `rail && "flex-col"` still stacks all three full-width, since three icon buttons don't fit side-by-side at `w-16`.
2. First pass (full `px-3`/`gap-3` everywhere) clipped "Settings" down to "Set" — the three-item row's combined natural width (~201px) exceeds the available 168-176px content width at the old padding; confirmed via Playwright screenshot before tightening spacing, then re-verified after.

**Verification:** `pnpm build --no-lint` passes. Real browser check (same seeded-user + Playwright pattern as prior sessions, test user deleted after): screenshotted the sidebar bottom row both expanded (Settings label fully visible alongside both icons, no clipping) and collapsed (all three stacked full-width as before).

---

**Session 2026-06-24m — Verified two of the five 2026-06-23f research plans against the actual current code; archived one that was already fully implemented; wrote a new academic-literature follow-up plan for race-time predictions (research-only, nothing implemented).**

1. **Verified [docs/planning/archive/FREE_AI_MODEL_RESEARCH_2026_06_24.md](archive/FREE_AI_MODEL_RESEARCH_2026_06_24.md)** against the live source, not just its own §5 claims: confirmed `GROQ_MODELS`/`resolveGroqModel()` in [lib/ai/groq.ts](lib/ai/groq.ts), the 429→NVIDIA-Nemotron-70B `streamWithFallback()` fallback in [lib/ai/fallback.ts](lib/ai/fallback.ts)/[app/api/coach/chat/route.ts](app/api/coach/chat/route.ts), and the corrected comparison table in [ai-settings.tsx](app/(dashboard)/settings/ai-settings.tsx) all match session 2026-06-24h above exactly. Moved the file from `docs/planning/Planerattköra/` to `docs/planning/archive/` and fixed a stale relative link to it in 2026-06-24h's own entry above (pointed at the file's pre-move location).
2. **Re-verified [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md)** (already archived, implemented in 2026-06-24i above) against current [lib/fitness/vo2max.ts](lib/fitness/vo2max.ts) — `personalizedFatigueExponent`, `personalizedRacePrediction`, `buildKnownPerformances`, `blendedRacePrediction`, `computeRacePredictions` all match the plan's design and [docs/fitness/race-time-predictions.md](../fitness/race-time-predictions.md)'s description with no drift. No action needed.
3. **User asked for a deeper academic-literature pass on improving race-time prediction using the large per-athlete dataset (2,800+ activities).** Read the full current implementation first (`vo2max.ts`, [lib/fitness/critical-speed.ts](lib/fitness/critical-speed.ts), [lib/fitness/decoupling.ts](lib/fitness/decoupling.ts), [lib/fitness/cache.ts](lib/fitness/cache.ts)), then searched/fetched real primary sources rather than relying on training-data recall: a 2024/2025 systematic review on field-based critical-speed testing in runners (PMC11933073), a 2023 paper on mean-maximal-power-based critical-power estimation from habitual training data, a 2025/2026 Frontiers in Physiology paper predicting Valencia Marathon time from half-marathon time across 7,663 runners, and Vickers & Vertosick (2016, BMC, N=2,303) on race-time prediction equation accuracy. Wrote [docs/planning/Planerattköra/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](Planerattköra/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md) — key finding: this codebase already computes two large-dataset-driven models whose output is cached but never fed into the race-time blend — `estimateCriticalSpeed()`'s 2-parameter hyperbolic CS/W′ model and `estimateLT1FromDecoupling()`'s cardiac-drift LT1 — both currently only surface as AI-coach display text. The plan's top proposal wires the already-computed CS/W′ estimate in as a third, physiologically-independent component of `blendedRacePrediction`, weighted by its own R² (computed in `critical-speed.ts` but currently discarded, not cached), rather than building a new model. Also flags that the hardcoded 0.93 marathon-%-of-critical-speed constant sits between the literature's elite (~95%) and population-average (~84.8%) values, and this athlete's already-diagnosed severe long-distance fade (2026-06-23 plan) suggests the lower end fits them better than a generic constant. Scoped explicitly as research-only, same convention as the rest of the 2026-06-23f series.

**Verification:** No code changed — doc-only session. Both implementation-status checks were done by reading actual current source, not by trusting the plan documents' own claims. All cited academic sources confirmed via live `WebSearch`/`WebFetch` against primary sources (PMC, PubMed, Frontiers, BMC) rather than recalled from training data.

---

**Session 2026-06-24n — Investigated a "Scan history for PBs found nothing" report; turned out not to be a bug (logic verified correct against real data), but surfaced a real flooding defect in the detection rule plus a real UI bug, written up as [docs/planning/archive/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md](archive/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md) (plan only, no detection-logic code changed yet). Also fixed one small, unrelated, real UI bug along the way.**

1. **Bug-audit per `CLAUDE.md`:** re-derived `shouldRecordResult()`/`matchTrackedDistance()` logic in an in-memory simulation against real local dev DB data (2,023 running activities) — found 82 legitimate PB/near-PB matches, confirming the detection logic itself was not broken. User confirmed the backfill did work. No code bug — documented why in the plan instead of "fixing" something that wasn't broken.
2. **Real defect found from the user's own backfill run:** 800m and 2 Mile flooded with dozens of slow, meaningless results. Root-caused to two compounding factors: Strava's `bestEfforts` finds the fastest sub-segment of that exact length *anywhere* in any activity (so short distances generate noisy candidates from ordinary easy runs), and those two distances had no manually-entered PB to anchor against. Caught a flaw in my own first-draft fix during a second review pass — gating only the near-PB branch missed that a long *chain of sequential "improvements"* from noisy data was the actual bulk of the flood, and using "any prior auto-detected race-flagged entry" as the trust signal was trivially always true (the bootstrap entry is itself always race-flagged). Corrected to: block *all* non-race candidates (improvement or not) for a distance until the user has manually entered at least one real PB for it — no schema change needed, just an `isManual` check.
3. **Plan also specifies:** restricting near-PB (non-improving) backfill matches to the last 365 days while leaving genuine all-time-PB detection unrestricted by age; a new "Remove all automatic PBs" button (`DELETE /api/races/auto-detected`) for clearing an already-flooded distance and re-running; consolidating the toggle, tolerance %, scan button, and new delete button into one dedicated Settings section (currently split between the Athlete Profile form and the Races page); and a real, independently-found bug — `app/api/settings/profile/route.ts` unconditionally nulls `dateOfBirth`/`sex` when absent from the request body, which the new Settings component's partial save would have silently triggered. None of this is implemented yet — plan only, per the user's request.
4. **Fixed a real, unrelated UI bug found via a screenshot:** [`PerformanceTrendCard`](app/(dashboard)/races/races-client.tsx) (the "Performance progression by half-year" table on the Races page) listed distance columns in whatever order `Set` first encountered them in the underlying query's alphabetical-by-label sort (`"10K", "1K", "3K", "5K", "Mile"`) instead of ascending distance length. Fixed by sorting against the file's existing `DISTANCE_ORDER` (already used elsewhere in the same file for the sidebar) before slicing to 5 columns.
5. Deleted two untracked leftover throwaway diagnostic scripts (`scripts/_tmp_full_table_check.ts`, `scripts/_tmp_race_predict_check.ts`) found left behind from an earlier research session in violation of the project's own "run then delete, never commit `_tmp_*`" convention — were breaking `tsc --noEmit` for unrelated reasons.

**Verification:** `npx tsc --noEmit` and `pnpm build --no-lint` both clean after the `PerformanceTrendCard` fix and tmp-script cleanup. The PB-detection rule changes in the plan are *not yet implemented* — no detection-logic code was touched this session, so no further runtime validation applies yet; validation steps are specified in the plan's own §9 for whoever implements it next.

---

**Session 2026-06-24o — Implemented [docs/planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md): wired the already-computed Critical Speed/W′ model into the race-time blend as a third, physiologically-independent vote, and added a long-run-history confidence signal — items 5 (dense MMP curve) and 6 (Valencia cross-check) deliberately deferred, see below.**

Ran the plan's own leave-one-out diagnostic (throwaway script, run then deleted) against real local data first to confirm the existing baseline (1K–10K mean abs error 0.61%, all distances 3.23%) before changing anything, per the plan's §5 validation discipline.

1. **[prisma/schema.prisma](prisma/schema.prisma):** added `FitnessCache.criticalSpeedRSquared`/`criticalSpeedEffortsUsed` (plan item 1) — the CS/W′ fit's own goodness-of-fit was already computed in `estimateCriticalSpeed()` but silently discarded after use; now cached so it can gate confidence. `prisma db push` + `generate` against the local dev DB.
2. **[lib/fitness/vo2max.ts](lib/fitness/vo2max.ts)** (plan item 2 — the highest-priority proposal): `blendedRacePrediction()` now takes an optional `cs` (Critical Speed/W′ result) and folds in a third vote via new `criticalSpeedVote()`: the raw fitted hyperbola for targets ≤15,000m (the model's own fitting range), a published 97.3%-of-CS fraction for the Half Marathon row only (a well-validated single figure from a 2024/2025 field-testing systematic review — matches the long-standing hardcoded HM factor in `critical-speed.ts` almost exactly), and no vote at all beyond that (Marathon) — the literature's sustainable-%-of-CS spread is too wide by caliber (elite ~95%, population average ~84.8%) to pick one fraction for a point estimate without real data to validate against. The CS share is carved out of the existing "peak" portion of the blend (never displaces real personal-anchor evidence in the local bracket model), scaled by `rSquared` and by whether the local model is already bracketed (less room) or a one-sided extrapolation (more room — exactly where an independent cross-check is most valuable).
3. **Marathon range-widening (plan item 3):** rather than replacing the long-standing single `0.93` marathon-%-of-CS constant in `critical-speed.ts` (used only in its own low-data fallback path, which doesn't even trigger for the athlete this was validated against) with a new unvalidatable point estimate, `blendedRacePrediction()` now unions the literature's elite (0.95×CS) and population-average (0.848×CS) bounds into the Marathon row's `predictionRange()` — widening only, never narrowing, and never touching the point estimate, since there's no real marathon `RaceRecord` yet to validate a point-estimate change against.
4. **Long-run-history confidence (plan item 4):** new `longRunAdequacyWidenFactor()` — `computeRacePredictions()` takes an optional `longestRunLast8wM`, widening the Half Marathon/Marathon range further when recent long-run distance falls well short of the target (Vickers & Vertosick 2016: weekly mileage/long-run history predicts marathon-specific fade independently of any PB exponent). All three call sites already ran an 8-week lookback loop for `avgWeeklyRunKm` — added longest-run tracking to the same loop, no new query. For the athlete validated against, this is currently a no-op (a 42.6km run in the last 8 weeks already covers the marathon distance) — confirmed the mechanism activates correctly by re-running with a synthetic 10K-only long-run input, which widened the Marathon band from 2:19:51–3:18:23 to 2:11:00–3:32:57.
5. **`computeRacePredictions()`** now fits Critical Speed internally (computed once, not duplicated between the blend and the cache write) and returns `{ predictions, criticalSpeed }` instead of a bare array — updated all three call sites: [lib/fitness/cache.ts](lib/fitness/cache.ts) `updateVO2maxAndPaces()` (AUTO — persists `criticalSpeed` to the new cache fields, matching the existing convention that CS/decoupling fields are AUTO-path-only), `updateHRZones()` (MANUAL — uses `predictions` only), and [app/(dashboard)/stats/page.tsx](app/(dashboard)/stats/page.tsx) (SLOW PATH — same).
6. **[lib/ai/tools.ts](lib/ai/tools.ts):** `get_fitness_summary`'s Critical Speed line now appends fit quality (`R²=0.58 (moderate fit, n=10 efforts) — also factored into the race-time predictions above`) so the AI coach can calibrate how much weight to put on it when discussing predictions.
7. **Deliberately deferred (documented, not silently dropped):** plan item 5 (a denser Mean-Maximal-Power-style curve mined from `splitsMetric` across all 2,800+ activities, instead of just Strava's ~10–14 standard `bestEfforts` distances) — flagged in the plan as something to revisit only if items 1–4 prove insufficient, not a first-pass task. Plan item 6 (cross-checking the Marathon row against the Valencia-equation population model) — this athlete has no real Half Marathon result either, so feeding a *predicted* HM time into a population formula would compound uncertainty on top of uncertainty with nothing real to validate the result against; revisit once a real HM `RaceRecord` exists.

**Verification:** Re-ran the leave-one-out diagnostic after the change: 1K–10K mean abs error held at 0.50% (no regression — slightly better, since the CS vote nudges the 10K row toward the cross-validated consensus), all-distances 3.14%. 15K shifted 58:27→58:47 and Half Marathon 1:22:23→1:23:19 (both now pulled toward agreement between the local-Riegel-extrapolation and CS-fraction estimates, which had quietly disagreed with the optimistic global Daniels curve even after the 2026-06-24i fix). Marathon's point estimate is unchanged at 2:41:58 by design; its range's upper bound widened from 3:04:05 to 3:18:23 to honestly reflect the literature spread. `npx tsc --noEmit` and `pnpm build --no-lint` both clean. Deleted all throwaway `scripts/_tmp_*.ts` diagnostic scripts used for validation, per project convention.

---

**Session 2026-06-24p — Implemented [docs/planning/archive/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md](archive/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md) in full: the flood-fix detection rule, the new Settings section, the delete-automatic-PBs button, and the dateOfBirth/sex partial-update fix. Plan archived.**

1. **[lib/races/pb-detection.ts](lib/races/pb-detection.ts) — the actual flood fix (plan §3+§4d):** `shouldRecordResult()` gained two new required params. `distanceHasManualBaseline` (true if any existing `RaceRecord` for that distance has `isManual: true`) now gates *every* non-race candidate — improvement or near-PB — not just near-PB; until a distance has a manual entry, only `Activity.isRace === true` results can touch it at all. `withinLastYear` caps non-improving near-PB matches to the last 365 days; a genuine all-time improvement is always recorded regardless of age once the manual-baseline gate is passed. `detectPBsForActivity()` now fetches all existing records for the distance (not just the fastest) to compute both signals — no schema change needed, just an `isManual` check. No changes needed to `app/api/races/scan-history/route.ts` or the three `lib/strava/sync.ts` call sites — both inherit the fix automatically through the shared function.
2. **New `DELETE /api/races/auto-detected`** ([app/api/races/auto-detected/route.ts](app/api/races/auto-detected/route.ts)): bulk-removes every `isManual: false` `RaceRecord` for the user, manual entries untouched — the recovery action for a distance that flooded under the old rule.
3. **Fixed the dateOfBirth/sex partial-update bug** ([app/api/settings/profile/route.ts](app/api/settings/profile/route.ts)) found during planning, *before* building the new caller that would have triggered it: a key absent from the request body now leaves that field untouched (Prisma `undefined` semantics) instead of being unconditionally nulled. Verified both callers afterward — the full-form `AthleteProfileForm` save still clears the field when the user actively empties it (key present, value empty), the new partial-payload `PBDetectionSettings` save leaves it untouched (key absent).
4. **New [app/(dashboard)/settings/pb-detection.tsx](app/(dashboard)/settings/pb-detection.tsx)** (`PBDetectionSettings`): the Automatic/Manual toggle, tolerance-% field, "Scan history for PBs" button (moved from the Races page), and the new "Remove all automatic PBs" button (two-step confirm, same pattern as the existing single-record delete on the Races page) — all in one card, all with real `try/catch` error handling (the original, independently-found `handleScanHistory` bug — silently resetting with no feedback on a failed request — fixed by construction rather than copied forward).
5. **Removed the old split locations:** the PB-detection `<Field>` deleted from [athlete-profile.tsx](app/(dashboard)/settings/athlete-profile.tsx); the "Scan history for PBs" button + its state deleted from [races-client.tsx](app/(dashboard)/races/races-client.tsx). New `<section>` card wired into [settings/profile/page.tsx](app/(dashboard)/settings/profile/page.tsx) between "Athlete Profile" and "Appearance".
6. **[docs/api/races.md](../api/races.md):** rewrote the automatic-detection description to match the new three-tier rule (no record yet → race required; record but no manual baseline → race required for everything; manual baseline exists → full tolerance+365-day rule), documented the new `DELETE /api/races/auto-detected` endpoint.

**Verification:** Re-derived the corrected `shouldRecordResult()` against 12 pure cases (the original 7 plus 5 new ones covering the manual-baseline gate and the 365-day boundary) — all pass. Re-ran the real-data simulation from the investigation session with the *fixed* rule (throwaway script, run then deleted): 800m and 2 Mile dropped from a flood of noisy training splits to 14 entries each, **every single one `isRace: true`** (real orienteering competition results — "DM sprint", "Stafett DM", "USM Sprint", etc. — not training noise). Distances with an existing manual baseline (10K, 1K, 5K, Mile) still gained a handful of training-sourced near-PB/improvement entries as intended, confirming the gate is correctly distance-scoped rather than blocking everything. `npx tsc --noEmit` and `pnpm build --no-lint` both clean (`/api/races/auto-detected` appears in the build's route list; `/settings/profile` and `/races` bundle sizes shifted consistently with the section move). Browser/UI click-through of the new Settings section and the delete-confirm flow not yet performed — logic-level validation only this session.

---

*Last updated: 2026-06-24p (implemented the PB-detection flood fix, the new Settings section, and the auto-PB delete button per the consolidation plan — the manual-baseline gate now blocks all non-race training data from a distance until the user enters a real PB for it, validated against real data showing 800m/2 Mile dropping from flooded to 14 race-only entries each; also fixed the dateOfBirth/sex partial-update data-loss bug before it could be triggered; plan archived; previously: 2026-06-24o (implemented the race-time-prediction academic research plan: Critical Speed/W′ wired in as a third blend vote for distances ≤ half-marathon, Marathon range honestly widened using the literature's elite/population-average CS-fraction spread instead of inventing an unvalidatable point-estimate change, a long-run-history confidence signal added for HM/Marathon, R² now cached and surfaced to the AI coach; MMP-curve and Valencia-cross-check proposals explicitly deferred with documented reasoning; validated via leave-one-out against real RaceRecord data — 1K-10K error held at ~0.5%, no regression; plan archived; previously: 2026-06-24n (investigated a PB-detection "found nothing" report, confirmed the logic was correct, but found and planned a fix for a real flooding defect in the near-PB rule plus a Settings-consolidation request — docs-only, see [PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md](Planerattköra/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md); also fixed a real distance-column-ordering bug in the Races page's performance-trend table; previously: 2026-06-24m (verified and archived FREE_AI_MODEL_RESEARCH_2026_06_24.md against live code, fixed a stale cross-link; re-verified RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md's implementation with no drift found; wrote a new research-only academic follow-up plan on race-time predictions, proposing to wire the already-computed-but-unused Critical Speed/W′ and decoupling models into the race-time blend rather than building anything new; no code changed; previously: 2026-06-24l (sidebar Settings/theme-toggle/collapse merged onto one row when expanded — required tightening padding/gaps to fit the "Settings" label without clipping; rail/collapsed stacking unchanged; verified via Playwright screenshots of both states; previously: 2026-06-24k (sidebar logo realigned to match the nav icons' 24px left inset instead of literally centering it, after confirming via UX research that centered sidebar logos are a known anti-pattern — the real issue was a 12px padding mismatch, not a missing center; rail/collapsed state untouched; verified via Playwright crop screenshot showing pixel alignment with nav icons; previously: 2026-06-24j (logo bumped bigger across all four usage sites — sidebar LOGO_SIZE 24→30 shared between expanded/rail states, LogoWordmark 52→64 on login/register/pending — verified via real browser + Playwright screenshots, no clipping/overflow regression; previously: 2026-06-24i (race-time predictions reworked: bracket-based local personalization replacing the single-global-exponent Riegel model that was making 5K-10K predictions worse than no personalization at all; found and excluded a real data-quality trap along the way — this athlete's isRace flag is exclusively orienteering, not road races; three independently-drifted prediction implementations (cache.ts ×2, stats/page.tsx slow path) unified into one computeRacePredictions(); dead /api/stats route removed after explicit confirmation; 1K-10K leave-one-out error now within ±3.2%, down from -5.6%/+30%; previously: 2026-06-24h (researched better-free-model alternatives — Cerebras's real 5 RPM cap ruled it out as a chat fallback despite a tempting 1M tokens/day headline; found and fixed a second dead-model-id bug on Groq, same class as 2026-06-24f's Kimi K2.5 retirement; built a seamless per-reply rate-limit fallback to NVIDIA Nemotron 70B for the coach chat with a visible notice banner, scoped to chat only — not calibrate/analyze; Settings comparison table and strava.md corrected with verified-from-primary-source numbers instead of disagreeing blog/legacy figures; tsc clean; previously: 2026-06-24g (NVIDIA/Groq model dropdowns in Settings autosave immediately on change via PATCH, mirroring the existing provider-switch pattern, instead of requiring the full "Save settings" button; tsc + build clean; previously: 2026-06-24f (fixed NVIDIA's outright retirement of the kimi-k2.5 model id used by 2026-06-24b's NVIDIA-NIM Kimi default — swapped in moonshotai/kimi-k2.6, added resolveNvidiaModel() so a previously-saved-now-stale model id self-heals to the current default instead of repeating this 404 if NVIDIA retires another model later; previously: 2026-06-24e (fixed a real logo-clipping regression from the prior session's collapsible-sidebar refactor — negative leading margin inside a new overflow-hidden clip box was eating the wordmark's "Tr" — by moving the pull-in margin to the icon's trailing edge instead; centered rail-mode icons; moved the collapse toggle to share a row with the theme toggle instead of its own full-width button; verified via Playwright geometry + textContent checks; previously: 2026-06-24d (one-way Planner→Google Calendar sync shipped as all-day events — lib/google-calendar/client.ts + sync.ts, wired into all three planner workout routes, OAuth callback + push-upcoming + disconnect routes, Settings UI card, full Google Cloud setup doc written first; tsc clean, pnpm build blocked by a concurrent session's dev server sharing .next/, tricky date/formatting logic verified in isolation; live OAuth flow not yet tested — pending the user's own Google Cloud OAuth client; plan archived; previously: 2026-06-24c (sidebar collapse/expand toggle moved to the bottom + logo/nav/Settings icons made pixel-identical between collapsed and expanded states, verified via real browser geometry check; previously: 2026-06-24b (Kimi K2.5 added to the existing NVIDIA NIM provider's model list instead of building a new OpenRouter-based 5th provider — same free ongoing 40 RPM tier, no daily cap unlike OpenRouter's Kimi :free; previously: 2026-06-24 (automatic PB/near-PB detection shipped — lib/races/distances.ts + pb-detection.ts, wired into all three Strava sync paths, POST /api/races/scan-history bulk backfill, Settings UI toggle + tolerance %, validated against real local data including an idempotency + first-time-distance-race-gate + eventName-mirrors-activity-name check; plan archived; previously: 2026-06-23j (auto-PB-detection plan broadened to track all results within a configurable tolerance of PB, not just strict new bests — confirmed the existing races-client.tsx UI needs no changes to support this; previously: 2026-06-23i (max-HR sensor-artifact cap personalized per athlete via Hampel/MAD filtering on each athlete's own hard-effort tail, replacing one fixed global 190bpm threshold; tuned and validated against real local data with a known ground-truth max HR before shipping; previously: 2026-06-23h (root-caused and fixed the second-user statistical-zone-estimator fallback case via live production debug logs + SQL — real cause was pace-bin fragmentation under recency decay, not the lap-duration floor, VirtualRun filtering, or a backfill bug, all ruled out with evidence first; fixed an unrelated LT2-training-range display inversion bug found along the way, previously flagged but never actually fixed in an archived bug audit; previously: 2026-06-23g (planner active interval time + real pace-zone estimates replacing a flat 6:00/km default; formatDuration() fractional-seconds bug found via live Playwright verification and fixed; auto-save with revert-on-cancel across template/workout/block editing; template card title-truncation fix (opacity-0 → hidden, was reserving layout space invisibly); collapsible main sidebar; previously: 2026-06-23f (research-only — five feature plans written: race-estimate personalization, Google Calendar planner sync, free Kimi model via OpenRouter, post-workout AI summary notifications, automatic PB detection; previously: 2026-06-23d (WeekSummaryStrip's per-sport breakdown merges running-related sports into one "Running" entry; week-detail page's "Volume by intensity" converted from a separate buggy intensity-label color scheme to the shared Z1-Z5 zone system; previously: 2026-06-23c (WorkoutSection gained a rest/recovery segment for true interval blocks — repetitions × (active + rest); de-duplicated section zod schema and estimate math into lib/planner/sectionSchema.ts + lib/planner/estimate.ts; fixed PATCH /api/planner/templates/[id] never recomputing cached estimate fields after a section edit; WorkoutBuilder UI + AI coach template summary updated; previously: 2026-06-23b (isRunningRelated now editable on existing sports via a checkbox in sports-manager.tsx, not just at creation; previously: 2026-06-23 (workout-type color palette in sports-manager.tsx reordered into hue/rainbow order, cosmetic only; previously: 2026-06-22j (Garmin HRV field-name bug fixed [lastNight→lastNightAvg]; LT1/LT2 pace-trend empty-chart bug root-caused to silent error-swallowing in two of three updateVO2maxAndPaces() call sites, now logged; temperature/wind stats redesigned from discrete bucket bars to continuous scatter+regression charts; cadence/stride length redesigned from time-series to vs.-pace scatter with recent/older period overlay; new lib/garmin/insights.ts with HRV 7-day-vs-60-day baseline overreaching detection and a composite readiness score, consolidated with and replacing the dashboard's previous separate ad-hoc readiness formula; previously: 2026-06-22i (full documentation audit: archived a fully-shipped feature plan, fixed single-user/multi-user and Apache/nginx and migration/db-push inconsistencies across CLAUDE.md/README.md/architecture/workflows/testing docs, fixed dead cross-references, added NVIDIA/Groq to AI provider docs, corrected numeric drift in HR-zone docs vs. lib/fitness/zones.ts, created docs/api/garmin.md + admin.md + stats.md + weather.md + cron.md and fixed drift in five other API docs; previously: corrected finding 3 from 2026-06-22g: HEAD-request hang was a local curl/schannel quirk over HTTPS, not a server bug — connection_upgrade map fix kept as harmless good practice, not reverted; external security recon against live server: nonce-based CSP replacing script-src unsafe-inline, nginx server_tokens off, nginx Connection-upgrade map fix; second-user statistical zone estimator investigation: backfill-completion fitness-cache refresh added, misleading empty-state copy fixed, debug instrumentation added to estimateZonesFromStatisticalAnalysis/estimateZonesFromActivities pending live diagnosis; coach chat streaming/thinking-indicator fix + tool fetch timeouts, large-screen layout fix, planner desktop drag-and-drop: PointerSensor restore + native/dnd-kit conflict removed from WorkoutPill + display:contents collision-detection fix, laps/splits chart outlier+offset scaling fix, rolling calendar fills available height, statistical-threshold-estimation cache-overwrite fix, LT-trend halfLife cliff-edge smoothing + symmetric rate cap, lap-aware zone-time classification, statistical-threshold card now mirrors applied zones + create-branch field fix, duplicate HR-zone-distribution title disambiguated, info-tooltip hover-flicker fix, LT trend now uses combined activities+laps data matching the real estimator, OL-filter all-activities change tried and reverted after real-data validation showed it discards legitimate easy training, live calibration and rolling trend unified into one shared estimateZonesFromActivities() function, breakpoint-detection fastest-bucket heuristic fixed + gap-aware median-filter smoothing + lt1/lt2 ratio-consistency fix, confidence/reliability tooltips added to both statistical-zones card and LT/AT trend chart)*
