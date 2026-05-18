# ClaudeTrainer — Implementation Plan

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

### Color Palette
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

Sport colors:
  Run:        #6EE7B7  (emerald)
  Orienteering: #34D399 (deeper green)
  Cycling:    #818CF8  (indigo)
  Skiing:     #BAE6FD  (light blue)
  Roller ski: #7DD3FC  (sky)
  Strength:   #FCA5A5  (soft red)
```

### Typography
- Font: **Inter** (system fallback: -apple-system)
- Headings: 600 weight, tight tracking
- Data labels: **JetBrains Mono** (numbers, paces, times)

### Components
- Border radius: `rounded-xl` (12px) for cards, `rounded-full` for pills/badges
- Shadows: `shadow-lg` with `shadow-black/30` — deep but soft
- Transitions: 150ms ease-out on all interactive elements
- Cards: `backdrop-blur-sm` for depth on darker backgrounds

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

  stravaAccount   StravaAccount?
  activities      Activity[]
  plannedWorkouts PlannedWorkout[]
  workoutTemplates WorkoutTemplate[]
  raceRecords     RaceRecord[]
  conversations   Conversation[]
  aiSettings      AISettings?
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
  id          String   @id @default(cuid())
  userId      String
  distance    String   // "5K", "10K", "Half Marathon", "Marathon", "Orienteering Sprint", custom
  distanceM   Float    // meters, for sorting
  time        Int      // seconds
  date        DateTime @db.Date
  eventName   String?
  stravaActivityId String?
  notes       String?
  isManual    Boolean  @default(false)
  user        User     @relation(fields: [userId], references: [id])

  @@index([userId, distance])
  @@index([userId, distanceM])
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
- Accessible from: template library ("New template"), calendar day ("Custom workout"), or editing an existing template
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

**Summary panels:**
- **Week summary** (sidebar when week view, or bottom panel in month view):
  - Total planned: distance, time by sport (stacked)
  - Load estimate (TSS)
  - Completeness % (actual vs planned, updates as week progresses)
  - Zone distribution for the week (see Intensity Analysis below)
- **Month summary**:
  - Monthly volume plan per sport
  - Week-by-week breakdown table
  - Load curve chart (planned TSS per day)

**Intensity & Structure Analysis (week view):**

Shown in a dedicated panel below or beside the week calendar:

```
Week 21 · May 19–25 · Planned load: 380 TSS

Volume by sport:
  Running   ████████████░░░  85 km · 7h 20min
  Cycling   ███░░░░░░░░░░░░  45 km · 1h 30min

Zone distribution (all sports):
  Z1 Easy       ████████████░░░  52%  4h 32min
  Z2 Aerobic    ████░░░░░░░░░░░  18%  1h 34min
  Z3 Tempo      ██░░░░░░░░░░░░░   8%  0h 42min
  Z4 Threshold  █████░░░░░░░░░░  15%  1h 18min
  Z5 VO2max     ███░░░░░░░░░░░░   7%  0h 37min

Intensity distribution:
  Easy/recovery  70%  ← ideal endurance ratio: 75–80%
  Hard/quality   30%  ← slightly high, watch recovery

Quality sessions: 3  (LT run, Intervals, Race-pace)
Interval time:  42 min
Long run:       2h 10min (Sunday)
```

**Polarization analysis:**
- Compares actual zone distribution to target profile (configurable: polarized 80/20, threshold-heavy, pyramidal)
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

**AI integration point:**
- "Plan my training" button → opens coach chat pre-loaded with current plan context
- AI can suggest workouts and add them directly to calendar via tool calls

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
Running:        800m, 1500m, Mile, 3K, 5K, 10K, Half Marathon, Marathon, Ultra (custom)
Orienteering:   Sprint, Short, Middle, Long, Ultra-Long
Cycling:        Custom distances
Skiing:         Custom distances
```

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
claudetrainer/
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
│   │   ├── WeeklySummary.tsx        # Volume + zone + polarization panel
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

## 9. Deployment (Ubuntu + Apache)

### Server Setup
```bash
# Install Node.js 20, pnpm, PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql postgresql-contrib
npm install -g pnpm pm2

# Database setup
sudo -u postgres psql
CREATE DATABASE claudetrainer;
CREATE USER claudetrainer WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE claudetrainer TO claudetrainer;
```

### PM2 Configuration
```json
// ecosystem.config.js
{
  "apps": [{
    "name": "claudetrainer",
    "script": "node_modules/.bin/next",
    "args": "start",
    "cwd": "/var/www/claudetrainer",
    "env": { "PORT": "3000", "NODE_ENV": "production" }
  }]
}
```

### Apache Virtual Host
```apache
<VirtualHost *:443>
  ServerName trainer.yourdomain.com
  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/trainer.yourdomain.com/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/trainer.yourdomain.com/privkey.pem

  ProxyPreserveHost On
  ProxyPass / http://localhost:3000/
  ProxyPassReverse / http://localhost:3000/

  # Required for streaming AI responses (SSE)
  ProxyPass /api/coach/chat http://localhost:3000/api/coach/chat
  ProxyPassReverse /api/coach/chat http://localhost:3000/api/coach/chat
  SetEnv proxy-sendchunked 1
</VirtualHost>
```

### Environment Variables (.env.local)
```env
# Database
DATABASE_URL="postgresql://claudetrainer:password@localhost:5432/claudetrainer"

# NextAuth
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="https://trainer.yourdomain.com"

# Strava
STRAVA_CLIENT_ID="your_client_id"
STRAVA_CLIENT_SECRET="your_client_secret"
STRAVA_REDIRECT_URI="https://trainer.yourdomain.com/api/strava/callback"

# AI (stored per-user in DB, but can set defaults here)
ANTHROPIC_API_KEY=""
GOOGLE_AI_API_KEY=""
```

---

## 10. Development Phases

### Phase 1 — Foundation (Week 1–2)
- [ ] Initialize Next.js project, Prisma, PostgreSQL
- [ ] NextAuth with email/password
- [ ] Strava OAuth flow + token management
- [ ] Initial sync (fetch all historical activities)
- [ ] Activity storage and basic list view
- [ ] Basic app shell (sidebar, navigation)

### Phase 2 — Statistics (Week 2–4)
- [ ] Activity aggregation queries (volume, frequency, elevation by sport + period)
- [ ] Overview cards with sparklines and YoY comparison
- [ ] Volume charts: weekly stacked bar, 4-week rolling average, lifetime totals
- [ ] Training load engine: ATL, CTL, TSB (with shaded form zones)
- [ ] Zone engine: HR zones + pace zones from VO2max/VDOT, TRIMP/TSS per activity
- [ ] HR zone distribution + polarization charts
- [ ] VO2max estimation: race-based (VDOT), HR-ratio, tempo-HR regression
- [ ] Training paces table + race time predictions
- [ ] HR efficiency, aerobic decoupling, running economy, cadence trend
- [ ] Split analysis + auto-detected interval analysis
- [ ] Recovery time estimate + overtraining risk indicator
- [ ] Annual/monthly goal tracker
- [ ] Comparison view (period A vs B)
- [ ] Season spider chart
- [ ] Educational tooltips system (`lib/tooltips.ts`)
- [ ] Daily cron sync

### Phase 3 — Training Planner (Week 3–5)
- [ ] Sport categories + workout types CRUD (Settings → Sports & Types)
- [ ] Workout builder: sections editor, zone picker, live preview, zone bar
- [ ] Template library: sidebar, filtering by sport/type, drag-and-drop to calendar
- [ ] Calendar: month + week view, planned workout pills, drag-and-drop rescheduling
- [ ] Planned workout CRUD (from template or custom/blank)
- [ ] Activity → Planned workout matching (auto by date + sport)
- [ ] Week/month summary panels (volume by sport, estimated TSS)
- [ ] Intensity & structure analysis panel (zone distribution, polarization, quality sessions)

### Phase 4 — AI Coach (Week 4–5)
- [ ] AI client abstraction (Claude + Gemini)
- [ ] Context builder (smart activity selection)
- [ ] Streaming chat UI
- [ ] System prompt engineering
- [ ] API key management in settings
- [ ] Conversation history

### Phase 5 — Race Tracker (Week 5–6)
- [ ] Race auto-detection from Strava
- [ ] PB calculation per distance
- [ ] Race history table
- [ ] Timeline charts
- [ ] Manual entry and editing

### Phase 6 — Polish (Week 6–7)
- [ ] Responsive design pass
- [ ] Loading states and error handling
- [ ] Settings page (AI provider, sync preferences)
- [ ] Performance optimization (caching, pagination)
- [ ] Production deployment

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
- **Strava webhook** — real-time sync instead of polling (requires public URL, already have it)
- **Export** — PDF training report, CSV data export
- **Notifications** — daily training summary email, recovery alerts
- **Mobile** — PWA wrapper or React Native in future
- **Multi-user** — just enable registration + add user isolation middleware
- **Interval analysis** — detect and parse structured workouts automatically from GPS data
- **Weather data** — correlate performance with conditions

---

*Last updated: 2026-05-19*
