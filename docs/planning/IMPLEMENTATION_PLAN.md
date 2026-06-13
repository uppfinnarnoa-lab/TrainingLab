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
  - New `useEffect` (runs on `est.totalSec`/`est.totalM` changes, i.e. whenever sections change): if the sum of section durations (minutes, rounded) exceeds `totalDurMin`, raises `totalDurMin` to match; same for section distances (km, 1 decimal) vs `totalDistKm`. One-way ratchet — totals grow to cover the sections but never auto-shrink if sections are later reduced, since the field still represents "at least this much."
  - Drag-and-drop section reorder: new `draggedKey`/`dragOverKey` state and `moveSection(fromKey, toKey)` helper (splices the dragged section to the drop target's position, renumbers `order` 0..n, sets `sectionsCustomized = true`). Implemented with native HTML5 DnD (`draggable`/`onDragStart`/`onDragOver`/`onDragLeave`/`onDrop`/`onDragEnd`) on each `SectionRow`'s header bar — same pattern as `TemplateCard.tsx`'s drag source. `SectionRow` gained `isDragging`/`isDragOver` props for opacity/border feedback; the `GripVertical` icon is now the visual drag handle (`cursor-grab`).

**Verification:** `pnpm build --no-lint` passes. No browser available in this session — not clicked through in the UI yet.

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

*Last updated: 2026-05-31 (Config K: weighted P80, slope-based LT2, effective-weight buckets; Config D: data-driven pace bounds, OL bootstrap; bug audit written; LT/AT trend chart plan written)*
