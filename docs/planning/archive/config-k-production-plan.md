# Config K — Production Implementation Plan

**Status:** Ready to implement  
**Scope:** `lib/fitness/zones.ts` only — `cache.ts` API surface unchanged

## What Config K Is

Config K is an improved zone-estimation algorithm validated in `scripts/year-estimate-test.ts`.
It fixes a systematic bug where the Pool-Adjacent-Violators step merged the fast-pace LT2 plateau
into a single blob, causing the regression to mis-place the LT2 breakpoint by 20–30 sec/km.

Validated results (user's dataset):

| Year | Orig LT2 | K LT2 | Target |
|------|----------|-------|--------|
| 2025 | 162@4:00 | 163@4:00 | ~correct ✓ |
| 2026 | 155@4:30 | 162@3:53 | ✓ |
| LIVE | 160@4:15 | 162@3:52 | 162@3:53 ✓ |

## Root Cause Fixed

With the original unweighted P80, race laps (3× recency weight) contributed only 1 count each.
So the 3:30/km bucket (dominated by races) had P80=160.9, lower than the 3:45/km bucket (162.2).
PAV merged 3:30+3:45+4:00 into one blob → regression placed bp1 at 4:15, not 3:45–3:52.

## Four Changes in `estimateZonesFromStatisticalAnalysis`

### 1. Weighted P80 (replaces unweighted P80)

```typescript
// BEFORE
const sortedHR = [...pts].map(p => p.hr).sort((a, b) => a - b);
const pct80HR = sortedHR[Math.min(Math.floor(sortedHR.length * 0.80), sortedHR.length - 1)];

// AFTER
const sortedByHR = [...pts].sort((a, b) => a.hr - b.hr);
let cumW = 0;
let pct80HR = sortedByHR[sortedByHR.length - 1].hr;
for (const pt of sortedByHR) { cumW += pt.w; if (cumW >= totalW * 0.80) { pct80HR = pt.hr; break; } }
```

Race laps (3× boost) in the 3:30/km bucket now drive P80 to 162.6 instead of 160.9,
eliminating the spurious inversion that triggered PAV merging.

### 2. Effective-weight minCount (replaces count-based filter)

```typescript
// BEFORE: MIN_COUNT = 10; .filter(([, pts]) => pts.length >= MIN_COUNT)
// AFTER:  MIN_EFF_WEIGHT = 8; .filter(([, pts]) => pts.reduce((s, p) => s + p.w, 0) >= MIN_EFF_WEIGHT)
```

A bucket with 5 recent race laps (weight ≈ 3 each → total ~15) passes; a bucket with
12 laps from 18 months ago (weight ≈ 0.2 each → total ~2.4) does not. This is data-driven,
not count-based.

### 3. Slope-based LT2 detection (replaces exhaustive joint 3-segment search for bp1)

```typescript
// BEFORE: nested i,j loop finds joint (bp1, bp2) minimising total segment error
// AFTER:
const slopes = paceArr.slice(0, -1).map((p, i) => (hrArr[i] - hrArr[i+1]) / (paceArr[i+1] - p));
const slopeMax = Math.max(...slopes);
let bp1 = 1;
for (let i = 0; i < slopes.length - 2; i++) {
  if (slopes[i] > 0.20 * slopeMax) { bp1 = i; break; }
}
// Then find bp2 by fixing bp1 and optimising only j:
let bestLSErr = Infinity, bp2 = Math.min(bp1 + 2, nb - 2);
for (let j = bp1 + 1; j < nb - 1; j++) { ... }
```

Scans from fastest bucket, picks the first transition where the HR-pace slope exceeds
20% of the curve's own maximum slope. Fully data-driven: the 0.20 threshold is a
dimensionless ratio of the curve's own geometry — no HR value or maxHR% is referenced.

### 4. Regression weights: count-based instead of totalWeight-based

```typescript
// BEFORE: const bucketWeights = mono.map(b => 1 / Math.sqrt(b.totalWeight));
// AFTER:  const bucketWeights = mono.map(b => 1 / Math.sqrt(b.count));
```

Sparse fast-pace buckets (LT2 region) need proportionally more regression influence
to avoid being dominated by the dense easy-run region. Count is the right denominator
for this purpose; totalWeight is now consumed by the P80 calculation.

## Files to Change

| File | Change |
|------|--------|
| `lib/fitness/zones.ts` | 4 changes in `estimateZonesFromStatisticalAnalysis` |
| `lib/fitness/cache.ts` | None — API surface unchanged |
| `docs/fitness/` | Update zone estimation doc to describe new algorithm |
| `docs/planning/IMPLEMENTATION_PLAN.md` | Mark as done |
| `docs/planning/bucket-estimator-improvements.md` | Update status |

## Verification Steps

1. Run standalone test script → confirm LIVE LT2 ≈ 3:52–3:55/km, LT1 ≈ 150–153bpm
2. `pnpm build --no-lint` — must compile cleanly
3. Open UI → Settings → "Beräkna zoner" button → confirm zones update
4. Check Statistisk tröskelestimering card: should show LT2 ≈ 162bpm @ 3:52/km

## Invariants Preserved

- The `StatisticalZoneResult` interface is unchanged → no breaking changes for callers
- The `poolAdjacentViolators` helper is unchanged
- The `segErr` helper is unchanged
- R² gate (0.62) is unchanged; new algorithm consistently gives R² ≥ 0.99 on this dataset
- All sanity checks (min gap, HR bounds) unchanged — these reference maxHR%, not fixed values
