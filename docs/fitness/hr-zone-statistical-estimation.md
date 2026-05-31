# HR Zone Estimation — Statistical Analysis from Training Data

> **Status:** 2026-05-31 — **Implemented and live** in `lib/fitness/zones.ts`  
> **Function:** `estimateZonesFromStatisticalAnalysis()`  
> **Algorithm version:** Config K (weighted P80 + slope-based LT2 detection)

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

## 2. Algorithm — As Implemented (Config K)

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

HR filter (universal physiological bounds, not user-specific):
```
0.52 × maxHR < avgHR < 0.96 × maxHR
```

Terrain filter: `totalElevationGain / distance < 0.12` (>12% avg grade — GAP correction unreliable).

### Step 2: Grade-Adjusted Pace (GAP)

Uses `gradeAdjustedPace()` from `lib/fitness/vo2max.ts` (Minetti cost-of-transport model):
```
grade = totalElevationGain / distanceM
GAP = rawPace × (1 + grade × 3.5)   // simplified — actual formula in vo2max.ts
```

### Step 3: Buckets — 15 sec/km bins, effective-weight threshold

Fixed bin width of 15 sec/km. Bucket qualifies if `sum(weight) ≥ 8`.
This is data-driven: 3 recent race laps (weight ≈ 3 each → total 9) qualifies;
12 laps from 18 months ago (weight ≈ 0.2 each → total 2.4) does not.

### Step 4: Weighted P80 per bucket

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

### Step 5: Pool-Adjacent-Violators (PAV)

Enforces strictly non-increasing HR with increasing pace. Adjacent buckets that violate
monotonicity are merged (count-weighted average) until the constraint is satisfied.
This removes noise inversions that would corrupt R² and mis-place breakpoints.

### Step 6: Slope-based LT2 detection

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

### Step 7: bp2 via regression (LT1 fallback anchor)

bp1 is fixed by slope detection. bp2 is found by optimising the two remaining segments:
```typescript
for (let j = bp1 + 1; j < nb - 1; j++) {
  const err = segErr(0, bp1) + segErr(bp1, j) + segErr(j, nb - 1);
  if (err < bestErr) { bestErr = err; bp2 = j; }
}
```

Regression weights: `1 / sqrt(count)` — sparse fast-pace buckets get proportionally
more influence than the dense easy-run region.

### Step 8: LT1 from VT1/VT2 speed ratio

```
lt1PaceTarget = lt2Pace / 0.844   (VT1/VT2 ratio — PMC12845794, n=1411)
lt1HR = interpolate HR from bucket curve at lt1PaceTarget
```

Fallback: if lt1PaceTarget is slower than all buckets, use bp2 pace/HR.

### Step 9: Sanity checks and zone building

LT1 and LT2 must satisfy:
- `lt1HR < lt2HR - 8` (minimum 8 bpm separation)
- `lt2HR < maxHR × 0.98`
- `lt1HR ≥ maxHR × 0.60`, `lt2HR ≥ maxHR × 0.70`
- `lt1Pace` in [240, 380] sec/km, `lt2Pace` in [200, 420] sec/km
- `lt2Pace < lt1Pace` (LT2 must be faster)
- R² ≥ 0.62

Zones built identically to `buildHRZonesFromLT()`: Z1–Z2–Z3–Z4–Z5 anchored to lt1HR/lt2HR.

---

## 3. Why Config K Fixed the Systematic Error

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
| 2025 full year | 151bpm @ 4:44 | 163bpm @ 4:00 | 0.99 |
| 2026 YTD | 152bpm @ 4:36 | 162bpm @ 3:53 | 0.99 |
| LIVE 5yr window | 153bpm @ 4:35 | 162bpm @ 3:52 | 0.99 |

---

## 4. Integration in TrainingLab

- `lib/fitness/zones.ts` — `estimateZonesFromStatisticalAnalysis()`
- `lib/fitness/cache.ts` — `updateHRZones()`: calls the function twice (all data + laps-only)
- Laps-only result stored as `statZonesLapsJson` — shown in "Statistisk tröskelestimering" card
- Applied if R² ≥ 0.80; falls back to race-PB method or fixed percentages if not

Priority order in `updateHRZones()`:
```
1. Manual override (manualLT1HR / manualLT2HR) — always wins
2. Statistical analysis (this method) — if R² ≥ 0.80
3. Race PB-derived — if good race data available
4. Fixed percentages (fallback)
```

---

## 5. Known Limitations

| Issue | Impact | Mitigation |
|---|---|---|
| Hardcoded pace range (200–391 sec/km) | Fails for very slow or very fast runners | Planned: data-adaptive pace bounds |
| OL race exclusion pace (5:30/km) | Wrong threshold for slow runners | Planned: derive from user's own pace distribution |
| LT1/LT2 sanity pace bounds (fixed) | Could filter valid estimates for extreme athletes | Planned: percentile-based bounds |

See `docs/planning/` for the data-driven filters improvement plan.

---

*Last updated: 2026-05-31*
