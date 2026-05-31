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
let bp1 = 1;
for (let i = 0; i < slopes.length - 2; i++) {
  if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
}
```

Scans from the fastest bucket. The first transition where the HR-pace slope exceeds
20% of the curve's own maximum slope = LT2. The 0.20 threshold is dimensionless —
it scales with the curve's own geometry, not with any HR value or maxHR%.

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

- `lib/fitness/zones.ts` — `estimateZonesFromStatisticalAnalysis()`
- `lib/fitness/cache.ts` — `updateHRZones()`: OL threshold bootstrap (Phase 1), then calls the estimator twice (all data + laps-only)
- Laps-only result stored as `statZonesLapsJson` — shown in "Statistisk tröskelestimering" card
- Applied if R² ≥ 0.80; falls back to race-PB method or fixed percentages if not

Priority order in `updateHRZones()`:
```
1. Manual override (manualLT1HR / manualLT2HR) — always wins
2. Statistical analysis (this method) — if R² ≥ 0.80
3. Race PB-derived — if good race data available
4. Fixed percentages (fallback)
```

**Important:** `updateVO2maxAndPaces()` (auto-sync path) does NOT run zone calibration.
Zone results are only written by `updateHRZones()` (manual calibration button).

---

## 6. Standalone Test Script

`scripts/year-estimate-test.ts` — validates the algorithm against real data without touching production.
Run with: `pnpm tsx scripts/year-estimate-test.ts`

See `docs/guides/year-estimate-test.md` for full documentation.

---

*Last updated: 2026-05-31 (Config D: data-driven pace bounds, OL bootstrap; Config K: weighted P80, slope-based LT2)*
