# TrainingLab — Fixes & Improvements Plan

> Prioritized implementation backlog based on current app state (2026-05-19).

---

## 1. Dashboard broken — stats show "—" despite 2,810 synced activities

**Symptom:** "This week / This month / Year to date" cards all show `—` and "Sync Strava to see data" even though Activities Synced = 2,810.

**Root cause (suspected):** The `app/(dashboard)/dashboard/page.tsx` queries use `prisma.activity.count({ where: { userId } })` for the total (works), but `prisma.activity.findMany({ where: { userId, startDate: { gte: weekStart } } })` for period stats. The `startDate` field may be stored in UTC midnight, which in Sweden (UTC+2) shifts the date — same timezone bug as the planner. The `startOfWeek()` in `date-fns` also defaults to Sunday — needs `{ weekStartsOn: 1 }`.

**Fix:**
- Audit `dashboard/page.tsx` date comparisons — use `startOfWeek(now, { weekStartsOn: 1 })` consistently
- Ensure `startDate` comparisons account for UTC offset (compare date strings, not Date objects directly)
- Add console logging to verify counts during development
- Replace "—" with actual aggregated data

**Files:** `app/(dashboard)/dashboard/page.tsx`

---

## 2. Activity detail page — full Strava-style view

**Current state:** Activity list at `/activities` shows cards. Clicking does nothing.

**Desired:** Click any activity → `/activities/[id]` with full detail:
- **Header:** Name, date, sport badge, race flag if applicable
- **Stats bar:** Distance, moving time, pace/speed, elevation gain, calories
- **Description/Notes:** Full Strava description text (already stored in DB)
- **HR metrics:** Avg HR, max HR, HR zone distribution chart (pie or bar)
- **Pace chart:** Per-km/lap pace as bar chart, with HR overlay
- **GPS map:** Render polyline on a map (use Leaflet.js — free, no API key needed)
- **Splits table:** Per-km splits with pace, HR, elevation
- **Best efforts:** Strava-reported PRs for this activity (stored in `bestEfforts` JSON)
- **Weather badge:** Temp + conditions if available
- **Laps:** If the activity has laps (intervals), show them in a table

**New files:**
- `app/(dashboard)/activities/[id]/page.tsx` — server component, fetches full activity
- `app/(dashboard)/activities/[id]/activity-detail.tsx` — client component for charts/map
- `components/charts/PaceChart.tsx` — per-km pace bar chart
- `components/charts/MapView.tsx` — Leaflet polyline map (lazy-loaded, client-only)

**New dependency:** `leaflet` + `react-leaflet` for the map

**Fetch strategy:** Basic activity fields already in DB. Activity streams (per-second GPS/HR/pace) are fetched on-demand from Strava API and cached on first load.

---

## 3. Weekly volume chart — sport filter (All / Running only)

**Current state:** Chart shows all sports stacked. No filter.

**Desired:** Toggle buttons above the chart:
- **All sports** (default) — stacked bars as now
- **Running only** — single colour bar, higher detail
- **Custom** — multi-select sport chips

**Fix:** Add `sportFilter` state to `StatsClient`. Pass filtered `weeklyVolumes` to `WeeklyVolumeChart`.

**Files:** `app/(dashboard)/stats/stats-client.tsx`, `components/charts/WeeklyVolumeChart.tsx`

---

## 4. VO2max / pace zones / HR zones — accuracy improvements

**Current state:** VO2max = 48.6 estimated from VDOT formula. CTL = 26 TSS (very low — indicates TSS computation is underestimating). Easy pace 5:18–6:39/km.

**Issues identified:**
1. **CTL too low (26 TSS):** TRIMP formula likely underestimates because `restHR` defaults to 50 and `maxHR` is estimated. Without an athlete profile (weight, max HR from Garmin), the HR-ratio is wrong.
2. **VO2max pipeline:** Currently uses 3 methods weighted equally. Race-based VDOT should dominate heavily if recent race data exists.
3. **Pace zones:** Derived from VDOT. If VDOT is accurate (48.6), threshold pace of 4:28–4:44 is roughly correct for a 48.6 athlete. But the zones may need the user to confirm/override.

**Fixes:**
- Prompt user to fill in Athlete Profile (max HR, resting HR, weight) — these dramatically improve all estimates
- Add a "Calibration" section in Settings with current estimates and confidence indicators
- Allow manual override of: max HR, VO2max, threshold pace
- Store overrides in `AthleteProfile` and use in all fitness calculations
- Increase VDOT race-method weight to 0.8 when recent race data exists (< 6 months)

**Files:** `lib/fitness/vo2max.ts`, `lib/fitness/training-load.ts`, `lib/fitness/zones.ts`

---

## 5. AI-powered HR zone re-estimation

**Desired:** A button "Re-estimate zones with AI" in the Statistics → Zones tab (and Settings → Athlete Profile). When clicked:
1. Sends last 5 years of activities + current profile to AI coach
2. AI analyzes HR distribution, compares against known race efforts, estimates lactate threshold HR and max HR
3. AI returns structured JSON: `{ maxHR: 194, restHR: 42, thresholdHR: 175, zones: [z1, z2, z3, z4, z5] }`
4. User sees the AI's reasoning + suggested zones
5. User clicks "Apply" → saved to `AthleteProfile`
6. All stats pages re-compute with new zones (CTL, HR zone distribution, pace zones, VO2max all update)

**Implementation:**
- New API route: `POST /api/coach/calibrate` — runs AI calibration and returns structured zone estimates
- New component: `ZoneCalibrationPanel` — shows current vs AI-estimated zones, apply button
- AI prompt: structured analysis of max observed HR, HR at known race paces, HR drift over long runs (aerobic decoupling)
- After applying: clear stats cache, trigger re-computation

**Files:** `app/api/coach/calibrate/route.ts`, `components/stats/ZoneCalibrationPanel.tsx`

---

## 6. Continuous VO2max / race pace auto-update

**Current state:** VO2max is computed fresh on every stats page load (expensive). No caching or triggered updates.

**Desired:** VO2max, training paces, and race predictions update:
1. **After each Strava sync** — check if new activities improve best efforts → recompute if so
2. **Stored in DB** — not recomputed on every page load
3. **Displayed with "last updated" timestamp** — user knows when estimate was last refreshed

**Implementation:**
- Add `FitnessCache` model to schema: `{ userId, vo2max, vdot, confidence, method, maxHR, restHR, zones, computedAt }`
- After Strava sync, compare new best efforts vs stored → trigger recompute if improved
- Stats page reads from `FitnessCache` (fast) with a "Refresh estimates" button for manual trigger
- Cron job: recompute weekly even if no new sync

**Schema addition:**
```prisma
model FitnessCache {
  id          String   @id @default(cuid())
  userId      String   @unique
  vo2max      Float
  vdot        Float
  confidence  String
  method      String
  maxHR       Int
  restHR      Int
  thresholdHR Int?
  zones       Json     // { z1: [lo,hi], z2: [lo,hi], ... }
  computedAt  DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Files:** `prisma/schema.prisma`, `lib/fitness/cache.ts`, `lib/strava/sync.ts`

---

## Priority order

| # | Feature | Effort | Impact |
|---|---|---|---|
| 1 | Dashboard bug fix | Low | High — visible immediately |
| 2 | Activity detail page | Medium | High — core feature |
| 3 | Fitness cache + auto-update | Medium | High — accuracy + performance |
| 4 | VO2max / zone accuracy | Medium | High — all estimates depend on this |
| 5 | AI zone calibration | Medium | High — unique feature |
| 6 | Weekly volume sport filter | Low | Medium |

---

## Notes on current estimates

Looking at the screenshot (VO2max 48.6, CTL 26):

- **VO2max 48.6** from race-based VDOT is likely accurate if it's using a real race result. For an orienteer training ~70 km/week this is in the expected range.
- **CTL 26 TSS** is clearly too low — a 70 km/week runner should have CTL 60–90+. The TSS per activity is being underestimated, almost certainly because `maxHR` and `restHR` are using defaults (190/50) rather than your actual values. **Fix: fill in max HR and resting HR in Settings → Athlete Profile.**
- **Pace zones** (easy 5:18–6:39) seem reasonable for VDOT 48.6 but feel slow if you're running sub-4:10 in training. This suggests the VDOT might be underestimated. **Fix: your actual race time should anchor this better.**

*Last updated: 2026-05-19*
