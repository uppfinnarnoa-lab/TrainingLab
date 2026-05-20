# Session Implementation Plan

> Written before coding to avoid missing anything.

## 1. Polarisation bar — fix colors + show 5 zones

**Problem:** 3-zone Seiler bar (Z1 easy/Z2 tempo/Z3 hard) uses wrong colors and conflicts
with the 5-zone HR table below it. User wants all 5 zones with matching colors.

**Fix:**
- Rename Seiler zones to "Low / Moderate / High" to avoid confusion with HR Z1-Z5
- Add a separate "HR zone distribution (5 zones)" bar above polarisation, matching the
  donut chart colors and HR table zone names (Z1 Recovery/Z2 Aerobic/Z3 Tempo/Z4 Threshold/Z5 VO2max)
- Polarisation bar keeps Seiler 3-zone logic but renamed labels
- Both bars shown in the existing PolarisationCard

Files: `app/(dashboard)/stats/stats-client.tsx`

---

## 2. Analytics Plan Part 1 — implement missing items + fix visibility

### 2a. Fast path returns null analytics (USER CAN'T SEE ANY OF IT)
The stats/page.tsx fast path returns `null` for analytics → nothing shows.
Fix: compute analytics from `recentForCurve` (24-week fetch already done).

### 2b. Missing implementations from ANALYTICS_PLAN.md Part 1:

**1D — YoY volume comparison** (simple, existing data)
- Group activities by year, compute total km per sport per year
- Show as grouped bar chart or table in a new "Year-over-year" section in Volume tab

**1D — PR progression by year** (simple, from RaceRecord)
- Best time per distance per calendar year from RaceRecord table
- Show as multi-line chart on Races page (or Stats → Fitness)

**1D — Active streak** ✅ (already done)

**1E — Time-of-day analysis** (simple, existing data)
- Group activities by hour of day → avg pace at that hour (easy runs only)
- Bar chart in Stats → Fitness or Overview

**1G — Resting HR trend** (from Garmin, existing data)
- 12-week resting HR from garminDailySummary
- Line chart in Stats → Overview or separate card

Files: `app/(dashboard)/stats/page.tsx`, `app/(dashboard)/stats/stats-client.tsx`

---

## 3. Strava sync — daily auto + smart 3-day resync on manual

**Auto sync:** Change from hourly back to once per day (06:00)
File: `lib/cron.ts`

**Manual sync (Sync button):**
When clicked, instead of simple incremental sync:
1. Fetch all activities from last 3 days via `/athlete/activities`
2. For each: compare with stored version (check if description changed)
3. If changed: fetch full individual activity detail via `/activities/{id}`
4. Update in DB

This ensures manually written descriptions/notes on Strava get synced.
File: `lib/strava/sync.ts`, `app/api/strava/sync/route.ts`

---

## 4. MaxHR from intervals — use statistical bucket approach, not single source

**Problem:** Current intervalBasedMax uses 85th percentile of maxHR from interval sessions
but this gives equal weight to each session, including old/stale data.

**Better approach:**
- Collect ALL hard runs (high avgHR, not just interval names)
- Bucket by effort level (HR as % of estimated maxHR from other sources)  
- Use the statistical model's LT2 HR derivation to estimate maxHR
- After statistical zone analysis: maxHR_derived = statResult.lt2HR / 0.89
- Blend with other sources: min(race-based, stat-derived) + buffer

File: `lib/fitness/cache.ts`, `lib/fitness/zones.ts`

---

## 5. Build and push

`pnpm build --no-lint && git add . && git commit && git push`

---

## Priority order

1. Fast path analytics fix (users can't see anything)
2. Polarisation 5 zones + colors
3. Strava sync changes
4. MaxHR statistical fix
5. YoY volume + time-of-day + resting HR
6. Build + push
