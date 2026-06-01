# Implementation Plan: LT Trend Window Stabilization

**Status:** Awaiting approval  
**Scope:** `lib/fitness/cache.ts` · `lib/fitness/zones.ts` · `scripts/rolling-lt-test.ts` · DB cleanup  
**Date:** 2026-06-01 (final — iterative investigation complete)

---

## 1. Problem Statement

The LT trend chart currently uses a 90-day rolling window per monthly data point.
This produces physiologically implausible swings:

- **Feb 2026 outlier (W90):** LT2 at 4:30/km — 38s slower than the calibrated value.
  Root cause: a 90-day winter window captures only low-intensity runs; no clear LT2 knee.

- **Jun 2025 spike (W90):** LT2 at 3:45/km — captured an accidental race-cluster within
  that exact 90-day window, not representative of that month's actual fitness.

- **Coverage gaps:** W90 fails entirely for 9 of 17 months (2025-02 to 2026-06) because
  there aren't enough laps in the narrow window to meet the effective-weight threshold.

Investigation also uncovered two estimator algorithm bugs that affect both the trend
chart and the live calibration.

---

## 2. Investigation Summary

### Why do 700 laps sometimes return "insufficient data"?

The algorithm requires each pace bucket to accumulate ≥8 *effective weight* (not raw
lap count). With halfLife=90 and `asOf=Dec 31 2022`, a lap from January 2022 has
recency weight `e^(-365/90) ≈ 0.017`. A bucket of 50 such laps has effective weight
≈ 0.85 — far below 8. The dataset physically exists but is nearly invisible to the
recency-weighted algorithm. With the 5-year window spread across time, most buckets
in historical annual windows fail this test.

### The key insight: ALL history + asOf-shifted

The LIVE calibration button already uses all 5 years of data with exponential recency
decay — it is effectively a window of unlimited length where the half-life controls
which data matters. For the LT trend chart, we can apply the exact same principle by
passing all available laps up to `windowEnd` and setting `asOf = windowEnd`. This is
identical to running LIVE from a different point in time.

### Estimator bugs found during investigation

**Bug A — bp1=0 false positive:** The slope-based LT2 detection loop started at i=0,
allowing LT2 to be placed at the fastest bucket. This happens when the slopeMax is at
the LT1 inflection rather than LT2, making the 20% threshold loose enough that
slope[0] passes. Result: LT2 placed at race pace (3:45/km), then LT1 only 5-6 bpm
lower → the HR gap check fails and the month returns null. Or worse — the data happens
to pass, returning a false LT2 at race pace.

Fix: start the slope search at i=1. This prevents placing LT2 at the absolute fastest
bucket while still allowing bp1=1 (second bucket).

**Bug B — HR gap threshold too strict:** The check `lt1HR >= lt2HR - 8` rejects
zone pairs where the LT1-LT2 HR spread is less than 8 bpm. During post-OL season
transition (Aug–Oct), the training distribution is compressed — many easy runs, fewer
threshold runs — which reduces the HR spread to 6-7 bpm. The resulting LT2 placement
is physiologically correct (4:15/km at 84% maxHR, LT1 at 81% maxHR), but the 8 bpm
threshold was rejecting these valid estimates. Lowering to 5 bpm unlocks them.

### OL race filter — global vs per-window bootstrap

**Problem:** The OL race filter uses a pace threshold = LT1 × 1.15. In production,
this threshold is computed once using current fitness (LT1 ≈ 4:35 → threshold ≈ 5:17).
Applied globally, this means spring 2025 OL season races at 5:30-6:00 pace
(appropriate LT1 efforts at that time, when fitness was LT1=5:20) are incorrectly
excluded as "OL paced". The global threshold (5:17) is too strict for historical
windows where fitness was lower.

**Fix:** Compute the OL threshold per-window using all acts up to `windowEnd` with
`asOf=windowEnd`. This gives a historically appropriate threshold for each window. In
the test scripts, OL thresholds ranged from 5:17 to 6:29 across 2025-2026 windows
vs. a fixed 5:30 with the old global approach.

### Historical data coverage — investigation findings

After applying ALL HL-auto + per-window bootstrap, test scripts were run against the
full 2017-2026 dataset. Results:

| Period | Coverage | Root cause |
|--------|----------|------------|
| 2017-2020 | All null | HR barely varies across pace zones (flat at ~157bpm regardless of pace). PAV collapses all pace buckets into 2-3 merged groups — far below the ≥6 minimum. This is a data quality issue: training was not structured enough to produce a clear HR-pace curve. |
| 2021-2022 | Sparse (5-8 months) | Sufficient data for estimation in months following high-volume periods. 2021-02 shows a false positive at LT2=5:15 (discussed below). |
| 2023-2024 | Mostly null | Lower training volume than 2025. ALL HL-auto fails because not enough laps accumulate sufficient effective weight in the recent 90-day window. |
| 2025-2026 | 18/18 months ✓ | Validated against live calibration. Clean seasonal curve. |

**2021-02 false positive:** The algorithm returns LT2=5:15 for February 2021, placing
LT2 at a pace that is slower than the user's LT1 by 2024-2025. Root cause: the
training data shows a near-flat HR response across all pace zones (the fast-pace
buckets at 4:45-5:00 have similar HR to slow buckets), causing the slope peak to
appear at an intermediate pace rather than a true aerobic threshold. This result
would appear as an isolated data point on the chart if stored.

**Coverage gap 2023-2024:** The monthly rolling test shows null for ALL HL-auto across
all of 2023-2024, yet the year-end estimate for 2024 gives LT2=4:30. This is because
the year estimate uses asOf=2024-12-31 (including all of December's training), while
the rolling test uses the first day of each month as windowEnd. December 2024 training
pushed effective weight just above the threshold. The 4:30 estimate reflects December
2024 fitness (winter base building state), not the 2024 summer OL season peak.

**Production scope:** The cache.ts loop goes back 30 windows × 30 days ≈ 900 days
≈ 30 months from today. All months before ~2024-01 are outside this window entirely.
Within the 30-month window, only 2025-01 onwards produce valid ALL HL-auto estimates.
The 2021-02 false positive is never reached because it is >5 years old.

### Final test results — ALL HL-auto with all fixes

Full test run, ALL HL-auto + per-window OL bootstrap + bp1 fix + 5 bpm threshold.
**18/18 months with data** (2025-01 through 2026-06):

| Month   | LT2 raw | LT2 smoothed | LT1 smoothed | R²   |
|---------|---------|-------------|-------------|------|
| 2025-01 | **4:30** | 4:30         | 5:20         | 1.00 |
| 2025-02 | **4:30** | 4:30         | 5:20         | 0.99 |
| 2025-03 | **4:30** | 4:30         | 5:20         | 0.99 |
| 2025-04 | **4:45** | 4:30 (outlier) | 5:20       | 1.00 |
| 2025-05 | **4:30** | 4:30         | 5:20         | 1.00 |
| 2025-06 | **4:15** | 4:15         | 5:02         | 0.99 |
| 2025-07 | **4:00** | 4:15 (outlier) | 5:02       | 1.00 |
| 2025-08 | **4:15** | 4:15         | 5:02         | 1.00 |
| 2025-09 | **4:15** | 4:15         | 5:02         | 0.99 |
| 2025-10 | **4:15** | 4:15         | 5:02         | 0.99 |
| 2025-11 | **4:00** | 4:00         | 4:44         | 0.99 |
| 2025-12 | **4:00** | 4:00         | 4:44         | 0.98 |
| 2026-01 | **4:00** | 4:00         | 4:44         | 0.98 |
| 2026-02 | **4:15** | 4:15         | 5:02         | 1.00 |
| 2026-03 | **4:07** | 4:07         | 4:53         | 1.00 |
| 2026-04 | **4:00** | 4:00         | 4:44         | 0.99 |
| 2026-05 | **3:52** | 3:52         | 4:35         | 0.99 |
| 2026-06 | **3:53** | 3:53         | 4:36         | 0.99 |

The seasonal curve is physiologically plausible:
- Winter 2025 base: 4:30 → OL spring build: 4:30–4:15 → OL peak Jul: 4:15 (smoothed)
- Post-season Aug–Oct: 4:15 → Autumn/winter rebuild: 4:00 → Spring 2026: 3:52

Coverage: **18/18** vs 9/17 for W90 (original production config).

---

## 3. Recommendation: ALL HL-auto + per-window OL bootstrap + two algorithm fixes + smoothing

**Five changes total:**

1. **cache.ts** — remove 90-day lower-bound filter (window change)
2. **cache.ts** — per-window OL bootstrap (OL threshold computed per-window, not globally)
3. **zones.ts** — start bp1 slope search at i=1, not i=0 (bug fix, also affects live)
4. **zones.ts** — lower HR gap threshold from 8 to 5 bpm (bug fix, also affects live)
5. **cache.ts** — apply `smoothLTTrend()` to computed monthly points before storing

---

## 4. What Changes (and What Doesn't)

### 4a. LT trend loop — cache.ts (window filter + per-window OL bootstrap)

**Window filter change (one line removed):**

```typescript
// Current (cache.ts, inside ltPaceTrend block):
const windowStart = subDays(windowEnd, 90);
const windowLaps = allTrendLaps.filter(l => l.startDate >= windowStart && l.startDate <= windowEnd);

// After:
const windowLaps = buildTrendLaps(actsUpToWindow, windowOlFilter).filter(l => l.startDate <= windowEnd);
// (windowLaps is now built per-window — see below)
```

**Per-window OL bootstrap:**

The global bootstrap section (phase1Laps → phase1 → trendOlThreshold → olFilterTrend →
allTrendLaps) is replaced by per-window computation inside the monthly loop.
`buildTrendLaps` is updated to accept a pre-filtered activities list as its first parameter:

```typescript
const buildTrendLaps = (acts: TrendAct[], olFilter: (a: TrendAct) => boolean) =>
  acts
    .filter(a => olFilter(a) && !WU_CD_RE.test(a.name) && Array.isArray(a.laps))
    .flatMap(...);

// Inside the loop:
for (let i = 0; i < 30; i++) {
  const windowEnd = subDays(now, i * 30);
  ...
  const actsUpToWindow = (activities as TrendAct[]).filter(a => a.startDate <= windowEnd);
  const phase1Window = estimateZonesFromStatisticalAnalysis(
    buildTrendLaps(actsUpToWindow, nameOnlyOlFilter), maxHR, restHR, windowEnd
  );
  const windowOlThreshold = phase1Window ? Math.round(phase1Window.lt1PaceSecPerKm * 1.15) : 330;
  const windowOlFilter = (a: TrendAct) =>
    nameOnlyOlFilter(a) &&
    (!a.isRace || (a.averageSpeed != null && 1000 / a.averageSpeed < windowOlThreshold));
  const windowLaps = buildTrendLaps(actsUpToWindow, windowOlFilter);
  const result = estimateZonesFromStatisticalAnalysis(windowLaps, maxHR, restHR, windowEnd);
  ...
}
```

Note: This calls `estimateZonesFromStatisticalAnalysis` twice per window (bootstrap + estimate).
In steady state (historical months cached, only current month recomputed), this is 2 calls per sync.
For initial backfill (30 windows), it is 60 calls — all in-memory with no I/O, acceptable cost.

### 4b. Slope detection fix — zones.ts (bp1 loop start)

In `estimateZonesFromStatisticalAnalysis`, the slope-based LT2 detection:

```typescript
// Current (starts at i=0 — can place LT2 at fastest bucket):
for (let i = 0; i < slopes.length - 2; i++) {
  if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
}

// After (starts at i=1 — second bucket minimum):
// Start at i=1: prevents placing LT2 at the fastest bucket,
// which would put LT1 too close in HR space when fast-pace data is sparse.
for (let i = 1; i < slopes.length - 2; i++) {
  if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
}
```

Also update the `let bp1 = 0` initializer to `let bp1 = 1` (the loop fallback value
if no slope threshold is crossed, ensuring bp1 is never 0).

### 4c. HR gap threshold — zones.ts

```typescript
// Current:
if (lt1HR >= lt2HR - 8) return null;

// After:
if (lt1HR >= lt2HR - 5) return null;
```

5 bpm corresponds to ~2.7% of maxHR=184. In HR reserve terms, LT2 at 4:15/km sits
at 79% HRR and LT1 at 75% HRR — a physiologically distinct pair even with 6 bpm gap.

### 4d. Trend smoothing — cache.ts (new utility function)

After computing all monthly LT2/LT1 values, apply a two-pass smoothing function
before storing in `extraVizJson.ltPaceTrend`:

**Pass 1 — isolated outlier removal (threshold = 15s):**
A month is an outlier if its value is ≥15s different from *both* its neighbors
(a single-month spike faster than both, or a single-month dip slower than both).
Such points are replaced with the linear interpolation of the two neighbors.
Applied independently to lt2Pace and lt1Pace.
Only applied when both neighbors are exactly 1 month apart (no gaps — avoids
incorrectly flagging valid transitions across missing data months).

```typescript
// Example results (from test run):
// Apr 2025 raw=4:45 (neighbors: 4:30, 4:30) → smoothed to 4:30
// Jul 2025 raw=4:00 (neighbors: 4:15, 4:15) → smoothed to 4:15
```

**Pass 2 — rate cap (max 20s/month improvement):**
No single month may show more than 20s improvement over the previous month.
If a month is >20s faster, it is capped at `prev - 20`.
Physiological LT2 improvements of >20s/month are implausible outside injury recovery.
Only applied between consecutive months (gap = 1 month). Larger gaps allow any magnitude
of change since the athlete's fitness legitimately shifts during inactive/null periods.

After smoothing, the curve is clean and forms a plausible seasonal pattern with
no single-month spikes or dips. All other values (R², HR, lap count) are stored
as-is alongside the smoothed pace values.

### 4e. Rolling test script — scripts/rolling-lt-test.ts (already updated)

Per-window OL bootstrap is now implemented in the test script. The CONFIGS array
has ALL HL-auto first, plus ALL HL365 (halfLife=365, minEffWeight=4) for historical
exploration. `smoothTrend()` with gap-aware `monthDiff()` is already implemented.
No further changes needed.

### 4f. DB cleanup — clear old ltPaceTrend (ONE-TIME)

The current stored trend was computed with W90 and contains the Feb 2026 outlier
and other artifacts. It must be cleared so ALL HL-auto recomputes from scratch.

**Prisma raw SQL:**
```sql
UPDATE "FitnessCache"
SET "extraVizJson" = jsonb_set("extraVizJson"::jsonb, '{ltPaceTrend}', '[]'::jsonb)
WHERE "userId" = '<user-id>';
```

Only `ltPaceTrend` is reset. All other cached fields (VO2max, ATL/CTL, zones, etc.)
are untouched.

**Note:** The first sync after clearing will recompute all historical months from
scratch. Since we only do this once and the incremental cache prevents future
re-computation, the one-time cost is acceptable.

---

## 5. Data Requirements for the Estimator

The statistical LT estimator requires the following data characteristics to produce
a valid result for any given monthly window:

### Minimum data volume

- **≥40 valid laps** after filtering: HR in 52%-96% maxHR, distance ≥800m,
  duration ≥180s, elevation gradient <12%.
- **≥6 pace buckets** (each 15-second wide) with **effective weight ≥8** each.
  Effective weight = sum of recency-weighted lap contributions per bucket.
  With halfLife=90, a lap 90 days ago contributes e^(-1) ≈ 0.37 weight; a lap
  180 days ago contributes e^(-2) ≈ 0.14. To reach effective weight 8 from
  180-day-old laps alone, a bucket needs 57 laps at that age.

### Required data quality: monotonic HR-pace relationship

The laps must collectively show increasing heart rate at faster paces. If training
is dominated by a single intensity zone (e.g., all easy base runs), the HR barely
varies across pace zones and PAV (Pool-Adjacent-Violators) collapses all buckets
into 1-2 merged groups — far below the ≥6 minimum. This is the root cause of all
2017-2020 failures: the HR data was flat at ~157bpm regardless of pace, producing
only 2 post-PAV buckets.

In practice, the estimator requires training that spans **at least 3 distinct
intensity zones** regularly: easy/recovery (Z1-Z2), moderate/tempo (Z3), and
threshold/hard (Z4-Z5). A mix that produces HR variation from ~65% to ~95% maxHR
across the session sample is needed.

### Practical training volume requirement

Based on observations across 2017-2026:
- **Sufficient:** ~150-300+ filtered laps within the effective recency window
  (roughly last 3-6 months with halfLife=90), spanning multiple intensities.
  This corresponds to ~4+ structured running sessions per week.
- **Insufficient:** 2017-2020 with ~150-200 total laps but concentrated in
  easy/base paces. More volume is not the constraint — intensity distribution is.
- **First reliable month:** 2025-01 (when structured training volume and intensity
  variety both exceeded the threshold consistently).

### halfLife interaction

With halfLife=90 (standard), the "useful" window is approximately the last 180 days.
If training volume varies seasonally, months at the start of a volume block may fail
even if the cumulative historical dataset is large. The estimator is essentially
answering "what is the current fitness based on recent (6-month) training?", not
"what is the all-time best fitness?".

### Why 2024 year-end shows 4:30

The year-estimate-test.ts result for 2024 (LT2=4:30) uses asOf=2024-12-31, which
means December 2024 training dominates (halfLife=90). December base-building laps
pull the estimate toward winter fitness (4:30). The summer 2024 OL season peak was
likely faster (4:00-4:15), but is not reflected because those laps were 5-6 months
old at year-end with e^(-5) to e^(-6) ≈ 0.7-2% residual weight.
To estimate the 2024 summer peak, the estimator would need to be run with asOf=2024-07-01
— which the monthly rolling chart naturally provides, if sufficient data exists for that month.

---

## 6. Implementation Steps

1. **DB cleanup first:** Clear `ltPaceTrend` → `[]` in FitnessCache before code change.
2. **zones.ts:** Change bp1 loop start from i=0 to i=1; update `let bp1 = 1` default.
3. **zones.ts:** Change HR gap threshold from 8 to 5.
4. **cache.ts:** Update `buildTrendLaps` to accept pre-filtered acts list as first parameter.
5. **cache.ts:** Remove global bootstrap section (phase1Laps, trendOlThreshold, allTrendLaps).
6. **cache.ts:** Inside the monthly loop, add per-window bootstrap + build windowLaps without lower bound.
7. **cache.ts:** Add `smoothLTTrend()` utility and apply it to the computed monthly points before storing.
8. **Build verify:** `pnpm build --no-lint` — must pass.
9. **Trigger sync:** Run a Strava sync to recompute the trend with ALL HL-auto.
10. **Visual verify:** Stats page LT trend chart — expect 18 data points, smooth seasonal curve, no spikes or dips.
11. **Commit & push.**
12. **Update docs** (see section 8).

---

## 7. Audit Checklist

After implementation, verify each of the following:

- [ ] `lib/fitness/zones.ts` — bp1 loop starts at `i = 1` (not `i = 0`)
- [ ] `lib/fitness/zones.ts` — `let bp1 = 1` (default, not 0)
- [ ] `lib/fitness/zones.ts` — HR gap check uses `lt2HR - 5` (not 8)
- [ ] `lib/fitness/cache.ts` — `buildTrendLaps` accepts acts list as first parameter
- [ ] `lib/fitness/cache.ts` — global bootstrap section removed (no global `allTrendLaps`)
- [ ] `lib/fitness/cache.ts` — inside loop: per-window bootstrap computed via `estimateZonesFromStatisticalAnalysis`
- [ ] `lib/fitness/cache.ts` — `windowLaps` filter has NO lower bound (no `>= windowStart`), only `<= windowEnd`
- [ ] No `subDays(windowEnd, ...)` remains in the ltPaceTrend block for the lower bound
- [ ] `estimateZonesFromStatisticalAnalysis` signature unchanged (no new parameters)
- [ ] `updateHRZones` still passes full `[...statRuns, ...statLapRunsZones]` — NOT changed
- [ ] `lib/fitness/cache.ts` — `smoothLTTrend()` applied before storing monthly points
- [ ] DB `ltPaceTrend` cleared before first sync (check that old data is gone)
- [ ] After sync: chart shows 18 monthly data points (2025-01 through 2026-06)
- [ ] After sync: no Feb 2026 outlier (LT2 ≠ 4:30 for Feb 2026; should be 4:15)
- [ ] After sync: LT2 values form a plausible seasonal curve — no isolated dips or spikes (±15s from both neighbors)
- [ ] Live calibration result unchanged (2026-06 ALL: LT2=3:52, LT1=4:35)
- [ ] `pnpm build --no-lint` passes clean

---

## 8. Documentation Updates

- **`docs/planning/lt-at-trend-chart-plan.md`:** Already archived to `docs/planning/archive/`.
- **`docs/planning/IMPLEMENTATION_PLAN.md`:** Update LT trend feature entry to
  describe the ALL HL-auto approach. Add note about bp1 and HR gap bug fixes, per-window
  OL bootstrap, and smoothLTTrend post-processing.
- **Data requirements** are documented in Section 5 of this plan and should be referenced
  in any future changes to the estimator algorithm.

---

## 9. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| More data slows down the per-window computation | Very low | Stored once; only current month recomputed each sync (2 calls) |
| Per-window bootstrap fails for sparse windows | Very low | Falls back to default threshold (330→380s/km), same as global approach |
| ALL approach too stable (hides real improvements) | Low | HL=90 still weights recent 90 days 2-10× more than older data |
| HR gap threshold=5 accepts false zone pairs | Very low | 5 bpm at 84%/81% maxHR is physiologically distinct; other checks (R²≥0.62, HR range) remain |
| bp1=1 misses LT2 in edge cases | Very low | bp1=1 means "second bucket minimum" — the fastest bucket is almost never a real LT2 |
| DB cleanup accidentally clears other fields | None | jsonb_set only touches the `ltPaceTrend` key |
| Live calibration changes after zones.ts fix | Very low | 2026-06 test shows same result (3:52/4:35) before and after fix |
| Smoothing hides real fitness peaks | Low | Only single-month isolated spikes are removed; multi-month trends are preserved |
| Build breaks | Very low | Two constant changes, one filter removed, one function added — no type changes |

---

*Plan written: 2026-06-01 — iterative investigation complete, awaiting user approval*

---

## 10. Temperature Statistics Improvements

**Status:** Planned — implement together with LT trend changes above  
**Scope:** `app/(dashboard)/stats/page.tsx` · `app/(dashboard)/stats/stats-client.tsx`

### 10a. Current limitations

The existing weather profile (`WeatherProfileCard`) already does useful work:
- Fitness-drift correction (rolling 12-week median residual)
- Temperature bands + wind bands with confounder control
- OL / WU / CD exclusion

But several gaps remain:

1. **`> 20°C` band is too coarse.** A 20°C run and a 30°C run have very different physiological demands but get averaged together. Should split into `20–25°C` and `> 25°C`.

2. **Precipitation data is collected but never shown.** The DB stores `weatherPrecip` (mm), but it is never included in the weather stats. Wet conditions measurably slow pace via grip, thermal loss, and psychological load.

3. **`tempSensitivity` is always `null` in the fast path.** The fast path (cache hit) always sets `analytics.tempSensitivity = null` — the "Heat impact" card is invisible whenever the cache is warm, which is ~99% of page loads. Root cause: the computation was placed in the slow path only.

4. **No cold sensitivity metric.** We show heat penalty (above 15°C baseline) but nothing about cold performance. Cold air — especially below 5°C — affects running economy, breathing, and muscle function. The symmetric metric is missing.

5. **No HR-normalized analysis.** All bands use raw pace with a fitness-drift correction. The correction works but still conflates effort variation with temperature effect. Runs at controlled HR (70–80% maxHR) would give a cleaner signal since effort is fixed.

### 10b. Changes

**`page.tsx` — 5 changes:**

1. **Add `distance` and `weatherPrecip` to weatherActs query select** so both fields are available for analysis.

2. **Update `WeatherAct` type** to include `distance: number` and `weatherPrecip: number | null`.

3. **Compute `tempSensitivity` from `weatherActs` before the fast/slow path split** using `hrZones.z3[0]` (always available from fitnessCache zones or default formula). The `weatherActs` query is already always-fresh (never cached). This fixes the fast path null.
   - Remove the duplicate tempSensitivity computation from the slow path.

4. **Update `WeatherStats` interface** — add `byPrecip: WeatherBand[]` and `coldSensitivity: number | null`.

5. **Update `computeWeatherStats`:**
   - Accept `maxHR: number` parameter.
   - Split `> 20°C` into `20–25°C` and `> 25°C`.
   - Add precipitation bands: `Dry (< 0.5mm)`, `Light (0.5–2mm)`, `Rain (> 2mm)`. Control filter: moderate temp (0–25°C) only.
   - Compute `coldSensitivity`: OLS regression on runs where `weatherTemp < 10°C` — sec/km per 5°C drop below 5°C baseline. Returns null if fewer than 8 data points.
   - Add HR-normalized bands (`hrNormByTemp`): filter runs where `averageHeartrate ∈ [0.70 × maxHR, 0.80 × maxHR]`, then group by temperature band. These bands are independent of fitness drift because effort is HR-controlled.
   - Add `hrNormByTemp: WeatherBand[]` to return value.

**`stats-client.tsx` — 4 changes:**

1. **Fix fast path `tempSensitivity` display** — it now comes from pre-split computation so the card will appear on cache-hit loads.

2. **WeatherProfileCard — add precipitation section** below the temperature and wind sections. Same bar+pace layout, show only if ≥ 2 bands have data.

3. **WeatherProfileCard — add HR-normalized temperature section** with a subtitle explaining "Pace at 70–80% max HR — effort-controlled, fitness drift not required."

4. **WeatherProfileCard — add cold sensitivity chip** next to existing heat impact display. Show "Cold penalty: +Xs/km per 5°C below 5°C" in blue/grey tone.

### 10c. Expected output

- WeatherProfileCard gains three new sub-sections (precipitation, HR-normalized temp, cold sensitivity)
- "Heat impact" chip now shows on every page load (not just slow path)
- Temperature band analysis is more granular above 20°C where heat effects accelerate non-linearly
- Precipitation signal gives a clear wet/dry pace comparison if enough rain data exists

### 10d. Risk assessment

| Risk | Mitigation |
|------|-----------|
| Precipitation bands mostly empty (Sweden — most runs are dry) | Show section only if ≥ 2 bands with count > 0 |
| HR-normalized bands too sparse | Show section only if ≥ 3 bands with count ≥ 3 |
| coldSensitivity noise from few cold data points | Require ≥ 8 data points, else null |
| weatherPrecip null on old activities | WHERE clause already filters `weatherTemp: { not: null }` — precip may still be null for old rows. Use `a.weatherPrecip ?? 0` with 0 treated as dry. |
