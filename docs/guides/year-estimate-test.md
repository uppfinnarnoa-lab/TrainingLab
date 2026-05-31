# Standalone Zone Estimator Test Script

**File:** `scripts/year-estimate-test.ts`  
**Purpose:** Validate and iterate on the zone estimation algorithm against real data without touching production code.  
**Run:** `pnpm tsx scripts/year-estimate-test.ts`

---

## Workflow

The test script is the primary development environment for zone estimator changes.

1. Edit algorithm variants in this script
2. Run and verify results match expectations
3. When satisfied, copy the confirmed-working logic to `lib/fitness/zones.ts` and `lib/fitness/cache.ts`
4. The script does **not** import from `lib/fitness/zones.ts` — it maintains its own independent copy of the algorithm to avoid circular contamination

---

## What It Tests

The script runs two algorithm configurations (Config K and Config D) for each calendar year from 2019 to the current year, then a 5-year LIVE window.

**Config K** — Weighted P80 + slope-based LT2 detection + effective-weight buckets  
**Config D** — All of Config K + data-driven pace bounds (no hardcoded pace ranges)

---

## Key Functions

### `makeOlRaceFilter(olRacePaceThresholdSecPerKm: number)`

Factory function that returns an activity filter. The filter excludes:
- Virtual runs (`sportType` contains `virtualrun`)
- Indoor activities (name contains `indoor` or `inomhus`)
- OL/orienteering activities (name matches: `\bol\b`, `orienteringsl`, `skogsl`, `olpass`, `orienteer`, `\bmoc\b`, `stafett`)
- Races slower than `olRacePaceThresholdSecPerKm` (terrain/navigation limited)

Pass `Infinity` to disable the pace check (name-only mode — used for Phase 1 bootstrap).

### `bootstrapOlThreshold(acts, maxHR, restHR, asOf?): number`

Two-phase OL threshold bootstrap:
1. Run estimator with name-only filter (no pace check) → preliminary LT1
2. Return `round(LT1_pace × 1.15)` — upper boundary of easy training pace
3. Falls back to 330 s/km (5:30/km) if Phase 1 produces no estimate

This makes the OL race exclusion threshold self-calibrating: a slow runner's threshold will
be higher (more permissive), and an elite's will be lower (more strict).

### `buildLaps(acts, olFilter): LapRow[]`

Extracts individual lap rows from activities matching the OL filter. Each lap must have:
- `average_heartrate` present
- `distance ≥ 800` m
- `moving_time ≥ 180` s

Includes `weatherTemp` from the parent activity for temperature correction.

### `estimateZones(runs, maxHR, restHR, opts): EstimateResult | null`

The core algorithm. Accepts configuration options:

| Option | Type | Description |
|--------|------|-------------|
| `useWeightThreshold` | boolean | Apply `weight > 0.01` filter (required for Config K/D) |
| `weightedP80` | boolean | Use recency/race-weighted P80 instead of count-based |
| `effectiveWeightMin` | boolean | Use `sum(weight) ≥ minCount` instead of `count ≥ minCount` |
| `minCount` | number | Minimum threshold (as weight or count depending on `effectiveWeightMin`) |
| `useSlopeDetection` | boolean | Use slope-based LT2 detection instead of exhaustive joint search |
| `dataDrivenPaceBounds` | boolean | Use P60/P85 percentile bounds instead of hardcoded pace ranges |
| `asOf` | Date | Treat this date as "now" for recency calculation (enables per-year testing) |
| `verbose` | boolean | Print bucket-level debug output to console |

**Config K shorthand:**
```typescript
const cfgK = (asOf?, verbose?) => ({
  useWeightThreshold: true, weightedP80: true, effectiveWeightMin: true, minCount: 8,
  useSlopeDetection: true, asOf, verbose,
});
```

**Config D shorthand:**
```typescript
const cfgD = (asOf?, verbose?) => ({ ...cfgK(asOf, verbose), dataDrivenPaceBounds: true });
```

---

## Output Format

```
maxHR=184  restHR=45

── 2019 ──  OL threshold=5:17/km
2019 cfgK  : LT1=148bpm @ 4:52  |  LT2=160bpm @ 4:08  |  R²=0.987  |  29 buckets  |  312 laps  OL<5:17
2019 cfgD  : LT1=148bpm @ 4:52  |  LT2=160bpm @ 4:08  |  R²=0.987  |  29 buckets  |  312 laps  OL<5:17
...
── 2025 (K) ──  OL threshold=5:27/km
  Points: 587  halfLife: 90  recentCount: 124
  Pace percentiles: P60=4:58/km  P85=5:44/km
  [verbose bucket details]
2025 cfgK  : LT1=151bpm @ 4:44  |  LT2=163bpm @ 4:00  |  R²=0.990  |  34 buckets  |  587 laps  OL<5:27
2025 cfgD  : LT1=151bpm @ 4:44  |  LT2=163bpm @ 4:00  |  R²=0.990  |  34 buckets  |  587 laps  OL<5:27
```

---

## Expected Results (reference athlete, maxHR=184)

| Window | LT1 | LT2 | R² |
|--------|-----|-----|----|
| 2025 | 151 bpm @ 4:44/km | 163 bpm @ 4:00/km | 0.99 |
| 2026 | 152 bpm @ 4:36/km | 162 bpm @ 3:53/km | 0.99 |
| LIVE 5yr | 153 bpm @ 4:35/km | 162 bpm @ 3:52/km | 0.99 |

If results deviate significantly (>5 bpm LT2 or >15 sec/km LT2 pace), investigate:
1. OL threshold bootstrap — did Phase 1 succeed?
2. PAV output — are buckets merging unexpectedly?
3. Verbose mode — inspect bucket-level HR values and slopes

---

## Notes

- The script reads directly from the database (no HTTP). Run with `pnpm tsx`, not `pnpm ts-node`.
- `asOf` is set to the last day of each year for per-year testing — this is what makes historical
  estimates comparable to what the algorithm would have produced at that point in time.
- The LIVE section uses `new Date()` as `asOf`, matching production behavior exactly.
- Weather temp is included from the database (`weatherTemp` field on Activity), making temp
  correction active in the test script (unlike production — see bug audit).
