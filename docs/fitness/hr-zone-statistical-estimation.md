# HR Zone Estimation — Statistical Analysis from Training Data

> **Status:** 2026-05-31 — **Implemented and live** in `lib/fitness/zones.ts`  
> **Function:** `estimateZonesFromStatisticalAnalysis()`  
> **Algorithm version:** Config K + D (weighted P80, slope-based LT2, data-driven pace bounds)

---

## 1. Core Idea

Most zone models use fixed percentages of maxHR (e.g., Z2 = 70–80%). These are wrong for
many athletes — LT1 might be at 65% or 85% depending on the individual.

The correct approach: let the DATA tell us where the physiology changes.

**Key insight:** If we plot median avgHR per pace bucket (e.g., every 15 sec/km), the
resulting curve is NOT linear — it has kinks at LT1 and LT2 where the relationship between
pace and HR changes slope. These kinks are the zone boundaries.

With 2 800+ runs, we have enough data to detect these kinks statistically.

---

## 2. Algorithm — As Implemented (Config K + D)

### Step 1: Data collection and filtering

Inputs are per-lap rows from the Strava lap splits (not whole activities). This gives finer
granularity and avoids the avgHR-dilution problem of whole activities with varied pace.

Per-lap point weight:
```
weight = tempWeight × recency × raceBoost
  tempWeight: temp > 25°C → 0.35; temp > 20°C → 0.75; else 1.0
  recency: exp(-daysAgo / halfLife)
  raceBoost: isRace ? 3.0 : 1.0
  halfLife: 90 days if ≥40 laps in last 90 days, else 180 days
```

Points with `weight ≤ 0.01` are excluded (effective window: ~14 months at halfLife=90).

**First pass (all raw points):** HR filter and minimum lap filter applied, no gap upper bound.
```
0.52 × maxHR < avgHR < 0.96 × maxHR   (universal physiological bounds)
distanceM ≥ 800, movingTimeSec ≥ 180
totalElevationGain / distance < 0.12   (>12% avg grade — GAP correction unreliable)
gap > 200 s/km                          (3:20/km — physical impossibility for 800m+ laps)
```

No upper bound on gap — sparse slow-pace buckets are filtered by the effective-weight
threshold at Step 3 instead.

### Step 2: Pace percentiles for data-driven sanity bounds

After computing all raw valid points, compute pace percentiles **before** the weight threshold:
```typescript
const sortedRawGaps = allValid.map(p => p.gap).sort((a, b) => a - b);
const gapP60 = gapPct(0.60); // upper bound for LT2: threshold must be faster than 60% of training laps
const gapP85 = gapPct(0.85); // upper bound for LT1: aerobic threshold faster than 85% of training
```

These auto-scale with any athlete's fitness level. A 6:00/km runner's LT2 at 6:00/km passes
if 60% of their training laps are ≥6:00/km — which is the physiology.

### Step 3: Grade-Adjusted Pace (GAP)

Uses `gradeAdjustedPace()` from `lib/fitness/vo2max.ts` (Minetti cost-of-transport model):
```
grade = totalElevationGain / distanceM
GAP = rawPace × (1 + grade × 3.5)   // simplified — actual formula in vo2max.ts
```

### Step 4: Buckets — 15 sec/km bins, effective-weight threshold

Fixed bin width of 15 sec/km. Bucket qualifies if `sum(weight) ≥ 8` (MIN_EFF_WEIGHT).
This is data-driven: 3 recent race laps (weight ≈ 3 each → total 9) qualifies;
12 laps from 18 months ago (weight ≈ 0.2 each → total 2.4) does not.

### Step 5: Weighted P80 per bucket

```typescript
// Sort laps by HR ascending, accumulate weight until 80% is reached
const sortedByHR = [...pts].sort((a, b) => a.hr - b.hr);
let cumW = 0;
let pct80HR = sortedByHR[sortedByHR.length - 1].hr;
for (const pt of sortedByHR) {
  cumW += pt.w;
  if (cumW >= totalW * 0.80) { pct80HR = pt.hr; break; }
}
```

Race laps (3× weight) drive P80 upward at fast-pace buckets, capturing true race-effort HR
rather than being washed out by training laps at the same pace.

### Step 6: Pool-Adjacent-Violators (PAV)

Enforces strictly non-increasing HR with increasing pace. Adjacent buckets that violate
monotonicity are merged (count-weighted average) until the constraint is satisfied.
This removes noise inversions that would corrupt R² and mis-place breakpoints.

### Step 7: Slope-based LT2 detection

```typescript
const slopes = paceArr.slice(0, -1).map((p, i) =>
  (hrArr[i] - hrArr[i+1]) / (paceArr[i+1] - p)
);
const slopeMax = Math.max(...slopes);
if (slopeMax < 0.25) return null;   // no dominant kink at all — too smooth/ambiguous to trust

let bp1 = 1; // fallback: second bucket
if (slopes[0] > 0.60 * slopeMax) {
  bp1 = 0;
} else {
  for (let i = 1; i < slopes.length - 2; i++) {
    if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
  }
}
```

Scans from the fastest bucket. The first transition where the HR-pace slope exceeds
20% of the curve's own maximum slope = LT2. The 0.20 threshold is dimensionless —
it scales with the curve's own geometry, not with any HR value or maxHR%.

**The fastest bucket needs a much stronger signal (60% of max, not 20%) to be selected
as LT2 itself.** Originally this bucket was *always* skipped, to guard against a sparse,
noisy fast-pace bucket dominating the result. That blanket rule was too blunt: in some
real sparse historical windows the fastest bucket is the genuine, best-supported kink
(highest weight of any bucket that month), while in others a moderate fastest-bucket
slope (33–55% of max) turned out to be a pool-adjacent-violators merge artifact that gave
a physiologically impossible result (faster than the live, most data-rich computation).
The 60%/0.25 thresholds were calibrated against exactly these cases — see
IMPLEMENTATION_PLAN.md Bug 17 for the full empirical investigation, including several
plausible-looking fixes (cross-time anchoring, wider recency halfLife, a bucket-weight
confidence floor, a much more aggressive orienteering name-filter) that were tested
against 5+ years of real data and rejected because each one regressed something already
validated as correct.

### Step 8: bp2 via regression (LT1 fallback anchor)

bp1 is fixed by slope detection. bp2 is found by optimising the two remaining segments:
```typescript
for (let j = bp1 + 1; j < nb - 1; j++) {
  const err = segErr(0, bp1) + segErr(bp1, j) + segErr(j, nb - 1);
  if (err < bestErr) { bestErr = err; bp2 = j; }
}
```

Regression weights: `1 / sqrt(count)` — sparse fast-pace buckets get proportionally
more influence than the dense easy-run region.

### Step 9: LT1 from VT1/VT2 speed ratio

```
lt1PaceTarget = lt2Pace / 0.844   (VT1/VT2 ratio — PMC12845794, n=1411)
lt1HR = interpolate HR from bucket curve at lt1PaceTarget
```

Fallback: if lt1PaceTarget is slower than all buckets, use bp2 pace/HR.

### Step 10: Sanity checks and zone building

Universal physiological bounds (apply equally to all athletes):
- `lt1HR < lt2HR - 8` (minimum 8 bpm separation)
- `lt2HR < maxHR × 0.98`
- `lt1HR ≥ maxHR × 0.60`, `lt2HR ≥ maxHR × 0.70`
- `lt2Pace < lt1Pace` (LT2 must be faster)
- R² ≥ 0.62

Data-driven pace bounds (Config D — auto-scale to any athlete's fitness):
- `lt2PaceSecPerKm ≤ gapP60` — LT2 must be faster than 60% of training laps
- `lt1PaceSecPerKm ≤ gapP85` — LT1 must be faster than 85% of training laps

Zones built identically to `buildHRZonesFromLT()`: Z1–Z2–Z3–Z4–Z5 anchored to lt1HR/lt2HR.

---

## 3. OL Race Threshold Bootstrap (cache.ts)

The activity filter in `updateHRZones()` excludes OL/orienteering races that are
terrain/navigation-limited (slower than easy training pace). The threshold is **bootstrapped**
from the data — not hardcoded.

**Phase 1:** Run `estimateZonesFromStatisticalAnalysis` with name-only OL filter (no pace check).
This gives a preliminary LT1 estimate.

**Phase 2:** `olPaceThreshold = round(LT1_pace × 1.15)` — upper boundary of easy training
pace. A race slower than easy-training pace is terrain/navigation limited, not fitness limited.

```typescript
const phase1Result = estimateZonesFromStatisticalAnalysis(phase1Laps, maxHR, restHR);
const olPaceThreshold = phase1Result ? Math.round(phase1Result.lt1PaceSecPerKm * 1.15) : 330;
```

Falls back to 330 s/km (5:30/km) if Phase 1 produces no estimate. For the reference athlete
(LT1=153 bpm @ 4:35/km), this bootstrap produces ≈5:17/km — consistent with the previous
hardcoded 5:30/km and correctly scaled for any fitness level.

---

## 4. Why Config K Fixed the Systematic Error

**Root cause:** With unweighted P80, race laps counted as 1 lap each regardless of their
information value. Fast-pace buckets (3:30/km) had P80=160.9, lower than the adjacent
slower bucket (3:45/km, P80=162.2). This PAV violation caused the 3:30+3:45+4:00 buckets
to be merged into one blob, shifting the LT2 breakpoint from 3:52 to 4:15.

**Fix:** Weighted P80 gives race laps (3× weight) proportionally more pull on P80.
Fast-pace buckets dominated by races get P80 ≈ 162–163, above their slower neighbours,
preserving the correct PAV structure. The slope-based LT2 detection then reliably finds
the plateau-to-descent transition regardless of how many buckets exist.

**Validated results (maxHR=184):**

| Window | LT1 | LT2 | R² |
|--------|-----|-----|----|
| 2025 full year | 151 bpm @ 4:44 | 163 bpm @ 4:00 | 0.99 |
| 2026 YTD | 152 bpm @ 4:36 | 162 bpm @ 3:53 | 0.99 |
| LIVE 5yr window | 153 bpm @ 4:35 | 162 bpm @ 3:52 | 0.99 |

Config D produces identical results on this dataset while applying correctly to athletes at any fitness level.

---

## 5. Integration in TrainingLab

As of 2026-06-18, both call sites share **one** pipeline — `estimateZonesFromActivities()` in
`lib/fitness/zones.ts` — instead of each maintaining its own copy of the OL-bootstrap +
dataset-construction logic. This was a deliberate architectural fix (see IMPLEMENTATION_PLAN.md
Bug 16): two parallel hand-maintained implementations had drifted apart in different ways
(Bugs 11/14/15), so the fix was to delete the duplication, not patch it again.

- `lib/fitness/zones.ts` — `estimateZonesFromActivities(activities, maxHR, restHR, asOf?)`:
  name-only OL filter → phase-1 laps-only bootstrap → OL pace threshold (`isRace`-gated only —
  see §3) → combined whole-activity + laps dataset → `estimateZonesFromStatisticalAnalysis()`
- `lib/fitness/cache.ts` — `updateHRZones()` (manual "Apply zones" button) calls it once, `asOf`
  defaulted to now → writes `statZonesJson`. (`statZonesLapsJson` is vestigial, always `null`.)
- `lib/fitness/cache.ts` — `updateVO2maxAndPaces()` (auto, every Strava sync) calls it once per
  rolling monthly window, `asOf` anchored to each historical `windowEnd` → writes
  `extraVizJson.ltPaceTrend` (the "LT/AT pace development" chart)
- Applied if R² ≥ 0.80; falls back to race-PB method or fixed percentages if not

Because both call sites invoke the exact same function, the trend chart's current-month point
is now structurally guaranteed to match what "Apply zones" would produce on the same data —
verified by running both functions directly against 5+ years of real data and confirming
byte-identical `lt1PaceSecPerKm`/`lt2PaceSecPerKm` output.

Priority order in `updateHRZones()`:
```
1. Manual override (manualLT1HR / manualLT2HR) — always wins
2. Statistical analysis (this method) — if R² ≥ 0.80
3. Race PB-derived — if good race data available
4. Fixed percentages (fallback)
```

**Historical trend months are locked in once computed** — `updateVO2maxAndPaces()` only computes
a month that's missing from `extraVizJson.ltPaceTrend` (or the current month, always recomputed).
Clearing `FitnessCache` forces a full rebuild with whatever algorithm is current at sync time.

---

## 5b. Escalating Half-Life Fallback (2026-06-23)

The standard recency window (90-180 day half-life, ~14-27 month effective lookback via the
`weight > 0.01` cutoff) is sometimes wide enough on raw point count but still finds **no usable
pace structure** — e.g. a real case where 263-363 weighted points cleared the `points >= 40`
gate easily, but every one of them landed in a single 15 sec/km bucket (`monoBuckets=1`, needs
`>= 6`), because that athlete's recency-weighted training window had essentially no pace
variety to detect a breakpoint in.

`estimateZonesFromActivities()` now retries with a wider half-life, one rung at a time, only
when the standard pass returns `null`:

```typescript
const EXTENDED_HALFLIFE_LADDER_DAYS = [270, 365, 545, 730, 1095];
```

Each rung re-runs the full phase1-bootstrap + final-pass pipeline with that half-life forced
(via `estimateZonesFromStatisticalAnalysis()`'s new `halfLifeOverrideDays` param, which bypasses
the normal recentCount-based auto-calculation). The loop stops at the **first** rung that
produces a non-null result — so the estimate always uses the most recent data that's actually
sufficient, never jumping straight to the full history. If every rung fails too, the function
returns `null` exactly as before and `updateHRZones()` falls through to race-PB/fixed-percentage
zones, unchanged.

This is a strict superset of the prior behavior: any case that used to succeed still returns the
identical result on the first (standard) try. Only previously-`null` cases are affected.

**Method labeling:** `StatisticalZoneResult.usedExtendedWindow` is `true` when an extended rung
was needed. `updateHRZones()` sets `zonesMethod: "statistical-historical"` instead of
`"statistical"` in that case — surfaced in the `/api/coach/calibrate` response and the Stats
page's "Method: …" line, so the result is visibly flagged as leaning on older training data
rather than current fitness (the whole point of recency-weighting in the first place — see §6).

---

## 6. Confidence and Known Limitations

The live computation (Statistical threshold estimation card) is the **highest-confidence**
output — it pools the entire training history (thousands of points across 5+ years), which
dilutes any single noisy data point to near-irrelevance. The R² shown there has consistently
matched or exceeded the documented baseline (0.99) throughout this algorithm's development.

The rolling trend (LT/AT pace development chart) is **structurally identical** but run on
much smaller per-window samples (a few hundred to a few thousand points for a single
historical month vs. the full pooled history). Smaller samples are more sensitive to:

- **Sparse fast-pace data** — a historical window with few hard efforts has fewer buckets to
  detect a breakpoint from, which is why some months return no point at all (judged too
  ambiguous to trust) rather than a forced guess.
- **Race composition noise** — for this athlete specifically, most race-effort data is
  orienteering, not road racing. OL pace/HR relationships carry more inherent noise (terrain,
  navigation stops) than road effort. Tested removing OL races from the dataset entirely:
  it regressed the live result (3:53/km → 4:00/km), so this isn't filtered out — the
  athlete's hardest verifiable efforts mostly happen during races, OL or not, and removing
  them removes real signal along with the noise. This is accepted as a known source of
  residual per-window noise rather than something with a clean fix.

**Practical implication:** trust the current month and the overall multi-year direction more
than any single older month's exact value. The UI surfaces this directly via tooltips on both
the live card (`tooltips.statZones`) and the trend chart (`tooltips.ltPaceTrend`) in
`lib/fitness/tooltips.ts`.

---

## 7. Standalone Test Scripts

- `scripts/year-estimate-test.ts` — validates the single-point estimator against real data without touching production. Run with: `pnpm tsx scripts/year-estimate-test.ts`. See `docs/guides/year-estimate-test.md`.
- `scripts/rolling-lt-test.ts` — validates the rolling monthly trend (mirrors `estimateZonesFromActivities()`) month-by-month against real data. Run with: `npx tsx scripts/rolling-lt-test.ts`, or `DEBUG_MONTH=2025-06 npx tsx scripts/rolling-lt-test.ts` for bucket/breakpoint detail on one month.

Both are frozen, standalone reimplementations — never imported from `zones.ts` — so algorithm experiments can't accidentally affect production. When an experiment is confirmed good, port it into `zones.ts` by hand and re-validate both scripts against it.

---

*Last updated: 2026-06-23 (added the escalating half-life fallback — §5b — for cases where the standard recency window finds plenty of points but no pace structure to detect a breakpoint in; new `zonesMethod: "statistical-historical"` flags results that needed it)*

*Previously updated: 2026-06-18 (unified updateHRZones() and updateVO2maxAndPaces() onto one shared estimateZonesFromActivities() pipeline; reconfirmed the OL pace-threshold exclusion must stay isRace-gated after real-data validation showed the alternative discards legitimate easy training; fixed the breakpoint scan's blanket fastest-bucket skip — now selectable with a 60%-of-max threshold plus an absolute slopeMax≥0.25 floor; gap-aware median-filter smoothing with lt1/lt2 ratio consistency; confidence/limitations section added; confidence tooltips added to the live card and trend chart)*
