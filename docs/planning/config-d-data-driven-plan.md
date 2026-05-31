# Config D — Data-Driven Filters Production Plan

**Status:** Ready to implement  
**Scope:** `lib/fitness/zones.ts` + `lib/fitness/cache.ts`  
**Depends on:** Config K (19da350) — this plan builds on top of it

## What Config D Is

Config D removes all hardcoded pace-based filters and replaces them with values  
derived from each runner's own data distribution. The algorithm produces identical  
results on this dataset, and now works correctly for athletes at any fitness level.

## What Was Hardcoded and Why It Was Wrong

| Filter | Hardcoded value | Problem |
|--------|----------------|---------|
| Gap upper bound | `gap < 391 s/km` (6:31/km) | Excludes all data for runners slower than 6:31/km |
| LT1 sanity pace | `240–380 s/km` | Fails for elites (< 4:00/km LT1) or slow runners (> 6:20/km LT1) |
| LT2 sanity pace | `200–420 s/km` | Same issue |
| OL race threshold | `< 330 s/km` (5:30/km) | Too tight for slow runners, too loose for elites |

## Config D Algorithm Changes (on top of Config K)

### 1. Remove gap upper bound in `zones.ts`

```typescript
// BEFORE
p !== null && p.gap > 200 && p.gap < 391 && p.weight > 0.01

// AFTER
p !== null && p.gap > 200 && p.weight > 0.01
```

Sparse slow-pace buckets are naturally filtered by `MIN_EFF_WEIGHT=8` (effective  
weight threshold). No hardcoded upper bound needed.

### 2. Compute pace percentiles from raw valid points

After computing all valid points (before weight threshold), compute:
```typescript
const sortedRawGaps = allValid.map(p => p.gap).sort((a, b) => a - b);
const gapPct = (p: number) =>
  sortedRawGaps[Math.max(0, Math.min(sortedRawGaps.length - 1,
    Math.floor(sortedRawGaps.length * p)))];
const gapP60 = gapPct(0.60); // LT2 must be faster than 60% of training laps
const gapP85 = gapPct(0.85); // LT1 must be faster than 85% of training laps
```

These are computed BEFORE the weight threshold filter so they include the full  
historical pace range (not just recent laps), giving stable percentile references.

### 3. Replace pace sanity checks with percentile bounds

```typescript
// BEFORE
if (lt1PaceSecPerKm < 240 || lt1PaceSecPerKm > 380) return null;
if (lt2PaceSecPerKm < 200 || lt2PaceSecPerKm > 420) return null;

// AFTER
if (lt2PaceSecPerKm > gapP60) return null;  // LT2 in faster 60% of training
if (lt1PaceSecPerKm > gapP85) return null;  // LT1 in faster 85% of training
```

Physics: threshold paces must be in the faster minority of training paces.  
A slow runner's LT2 at 7:00/km passes if 60% of their training laps are at 7:00+/km.

### 4. Bootstrap OL race pace threshold in `cache.ts`

**Phase 1:** Run `estimateZonesFromStatisticalAnalysis` with name-only OL filter (no pace  
check) to get a preliminary LT1 estimate.

**Phase 2:** Derive OL threshold = `round(lt1PaceSecPerKm × 1.15)` — the upper boundary  
of easy training pace. Races slower than easy-training pace are terrain/navigation limited.

```typescript
// Phase 1: name-only filter, get preliminary LT1
const nameOnlyFilter = (a: ActLight) =>
  !/virtualrun/i.test(a.sportType) &&
  !/indoor|inomhus/i.test(a.name ?? "") &&
  !/\bol\b|orienteer|\bmoc\b|stafett/i.test(a.name ?? "");
const phase1Laps = acts.filter(a => nameOnlyFilter(a) && ...).flatMap(laps...);
const prelim = estimateZonesFromStatisticalAnalysis(phase1Laps, maxHR, restHR);
const olPaceThreshold = prelim ? Math.round(prelim.lt1PaceSecPerKm * 1.15) : 330;

// Phase 2: data-driven filter
const olRaceFilterLight = (a: ActLight) =>
  nameOnlyFilter(a) &&
  (!a.isRace || (a.averageSpeed != null && 1000 / a.averageSpeed < olPaceThreshold));
```

**Validation:** For this user the bootstrap gives 5:27–5:30/km (vs hardcoded 5:30/km).  
For a slow runner (LT1=7:00/km): threshold = 8:03/km. For an elite (LT1=4:00/km): 4:36/km.

## Files to Change

| File | Change |
|------|--------|
| `lib/fitness/zones.ts` | 3 changes in `estimateZonesFromStatisticalAnalysis` |
| `lib/fitness/cache.ts` | Restructure `updateHRZones` to bootstrap OL threshold |
| `docs/fitness/hr-zone-statistical-estimation.md` | Update algorithm description |
| `docs/planning/IMPLEMENTATION_PLAN.md` | Note Config D deployment |

## Validated Results (on test dataset, maxHR=184)

| Window | K result | D result | Target |
|--------|----------|----------|--------|
| 2025 | LT1=151@4:44, LT2=163@4:00 | same | ~correct ✓ |
| 2026 | LT1=152@4:36, LT2=162@3:53 | same | ✓ |
| LIVE | LT1=153@4:35, LT2=162@3:52 | same | 162@3:53 ✓ |

Config D gives identical results on this dataset while being universally applicable.

## Preserved Invariants

- `StatisticalZoneResult` interface unchanged
- `poolAdjacentViolators` unchanged
- `segErr` unchanged
- R² gate (0.62) unchanged
- Universal HR bounds (0.52/0.96/0.60/0.70 × maxHR) unchanged — these are physiology constants
- VT1/VT2 ratio (0.844) unchanged — biomechanics constant
- `bootstrapOlThreshold` falls back to 330 s/km when insufficient data
