
# Bucket Estimator HR Zone Model — Improvement Research

> **Status:** 2026-05-28 — Items 1, 2, 4, 5, 7 implemented. Items 3 and 6 declined. Items 8 and 9 under investigation.
> **Problem:** LT1 and LT2 estimated systematically too low (zones shifted downward)  
> **Model file:** `lib/fitness/zones.ts` → `estimateZonesFromStatisticalAnalysis()`

---

## Current Algorithm Summary (post-implementation)

1. Filter runs: HR 52–96% maxHR, ≥800m, ≥3min, terrain grade < 12%; input = activity averages + lap splits
2. Compute Grade-Adjusted Pace via Minetti (2002) polynomial: `Cmet(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6`; GAP = rawPace / (Cmet(i)/3.6)
3. Apply temperature weight: >30°C skip, 25–30°C ×0.35, 20–25°C ×0.75, else ×1.0
4. Apply recency weight: 90-day half-life (falls back to 180 days if < 40 runs in last 90 days)
5. Apply zone-proximity weight: ×1.5 if HR in 62–85% maxHR; ×0.75 outside (reduces easy-run and VO2max-run influence)
6. Bucket by fixed 15 s/km bins; require ≥10 runs/bucket; weighted median HR per bucket
7. Pool-adjacent-violators for monotonicity
8. Exhaustive piecewise linear search for two breakpoints → LT1/LT2
9. R² threshold ≥ 0.62; sanity checks on HR/pace physiological ranges
10. Require ≥ 6 monotone buckets

---

## Root Causes of Systematic Underestimation

**Volume imbalance:** Easy/recovery runs vastly outnumber threshold runs in any training plan
(typically 80/20 split). This means the slow end of the HR:pace curve is extremely well-fitted
by the regression, while the fast/threshold end is sparse. Sparse endpoints pull the breakpoints
toward the centre of the data — which is in the aerobic zone, not at the true threshold.

**Warm-up contamination:** Whole-activity averages include warm-up km where HR is rising from
rest. A 10km run starting at 100 bpm and reaching steady-state at 150 bpm has an average of
~140 bpm — lower than the true steady-state HR for that pace. Lap splits (now included) remove
this contamination since each lap is already at steady-state.

**Old fitness data:** With a long recency window and potentially years of data, runs from when
the athlete was significantly less fit (lower LT) still contribute and pull estimates down.
Addressed by 90-day half-life with 180-day fallback.

---

## Remaining Items Under Investigation

---

### 5. Multi-PB weighted-best for LT2 estimation ✅ Implemented

**What was changed:** `estimateLTFromRaces()` in `zones.ts` now uses all available PBs instead
of a single-winner priority waterfall.

**Old behaviour:** HM wins → else 10K wins → else 5K wins → else Riegel extrapolation.
A conservative old HM PB would permanently suppress the estimate even with a recent max-effort 10K.

**New behaviour:** All PBs in the 800m–marathon range are converted to implied LT2 pace using
per-distance calibration factors (HM=×1.00, 10K=×1.065, 5K=×1.135, etc.).
Each estimate is weighted by:
- **Reliability** (HM=1.0, 10K=0.85, 5K=0.70, 3K=0.45, 800m=0.20, marathon=0.45)
- **Recency** (18-month half-life — a 2-year-old PB gets ~26% weight)

Candidates are sorted fastest-first. The weighted mean of the fastest candidates covering ≥35%
of total reliability weight is used. This ensures:
- A max-effort recent 10K overrides a conservative old HM (10K gets high enough weight to clear threshold alone)
- A single noisy 3K PB (low reliability) can't dominate — it needs to accumulate to 35% with other PBs

**Why not use actual race HR?**  
`RaceRecord` stores no HR field. Even if we joined to `Activity.averageHeartrate`, a conservative
race would have genuinely lower HR — this would anchor LT2 *lower*, not higher. Pace-derived LT2 is
more robust because we can cross-validate via multiple distances and apply appropriate calibration factors.

---

### 8. Adaptive Bin Width Based on Data Density ⭐⭐

**What:** Instead of a fixed 15 s/km bin, compute the Freedman-Diaconis optimal bin width:
`binWidth = 2 × IQR(pace) × n^(-1/3)`. This gives narrower bins where data is dense
(typically around the athlete's main training pace) and wider bins in sparse regions.

**Why it helps:** With a fixed 15 s/km bin, the zone around LT (where the curve kinks)
may have the kink fall between bins, causing the piecewise fit to miss it or place it in
the wrong bin. Adaptive bins improve resolution at the threshold pace.

**Investigation findings (2026-05-28):**
- FD bin width for typical activity data (n≈300, IQR≈40 s/km): `2×40×300^(-1/3) ≈ 11.5 s/km` — slightly narrower than the current 15
- With lap data added (n≈800+), FD bin shrinks to ~8 s/km → 200–391 range gives ~24 buckets → marginal runs may fall below MIN_COUNT=10, increasing null-returns
- For very sparse data (n≈100), FD gives ~17 s/km, close to current value
- FD bin should be clipped to [10, 20] s/km to prevent degenerate configurations
- **Verdict:** With lap data now included, the effective data density has increased. If LT underestimation persists after items 1/2/4/7, try FD bins with a [10, 20] clamp. Only worth testing if a real regression shows the fixed 15 s/km bin misses the kink.

---

### 9. Segment-Count Selection via BIC ⭐⭐

**What:** Instead of always fitting a 3-segment (2-breakpoint) model, also fit 2-segment and
4-segment models and select by Bayesian Information Criterion (BIC). Some athletes' HR:pace
curves are more linear (one threshold) or have three distinct transitions.

**Why it helps:** Forcing 2 breakpoints when the data only supports 1 can misplace both
breakpoints, compressing them into a region where there isn't a clear kink and generating
a plausible-but-wrong result.

**Investigation findings (2026-05-28):**
- BIC = n × ln(SSR/n) + k × ln(n) where k = effective parameters
- 1-segment: k=2, would return null (no LT); 2-segment: k=3; 3-segment (current): k=4
- The `segErr` function is already usable for all segment counts — extension is feasible
- However, 1-segment selection would mean no result at all, increasing null-return rate
- The systematic underestimation is a data-quality/weighting issue (too many easy runs), not a model-structure issue — BIC doesn't fix that
- Athletes with very few hard runs might see the fit choose 2-segment instead of 3, which could accidentally place a single breakpoint at a better LT2 location
- **Verdict:** Not recommended until items 1/2/4/5/7 are validated. The systematic bias is not caused by wrong segment count.

---

### 10. External Calibration: Use RPE/Type Labels From Strava ⭐⭐⭐

**What:** Strava activities have a `workoutType` field (0=default, 1=race, 2=long run, 3=workout).
Long runs (type 2) are run at LT1 pace by design; workouts (type 3) may have threshold segments.
Add `workoutType` to the bucket estimator data, and weight long-run data more heavily for LT1
detection, workout data for LT2.

**Why it helps:** If we know a run is intentionally a "long run at easy pace," its HR:pace
data is highly informative for LT1. Currently this signal is mixed with all other run types.

**Risks:**
- `workoutType` data coverage: many athletes don't label runs correctly in Strava
- "Long run" label doesn't guarantee constant easy pace (may include surges)
- Marginal gain over zone-proximity weighting (already added in item 4)

**Verdict:** Low-medium impact. Zone-proximity weighting (item 4, now implemented) provides
similar signal without relying on label coverage. Revisit only if labels are consistently set.

---

## Priority Ranking (updated)

| # | Idea | Expected Impact | Implementation Effort | Status |
|---|---|---|---|---|
| 5 | Multi-PB weighted-best for LT2 | High | Medium | ✅ Implemented |
| 8 | Adaptive bin width (FD, clamped) | Low-Medium | Medium | Wait — validate 1/2/4/5/7 first |
| 9 | BIC segment-count selection | Low | High | Not recommended |
| 10 | Strava workout type labels | Low-Medium | Low | Low priority |

---

## Note on Breakpoint Direction

The piecewise linear model sorts pace **ascending** (fast=low s/km first). The breakpoints are:
- `bp1` (lower index, faster pace) = **LT2**
- `bp2` (higher index, slower pace) = **LT1**

If the data is dominated by easy-pace runs, the piecewise fit will fit the slow end well and
place the first breakpoint further right (slower), pushing LT2 estimated pace *slower* than
actual — which means a lower HR at LT2. This confirms the root-cause analysis: more easy data
= lower LT estimates. Items 1 (lap splits), 2 (90-day recency), and 4 (zone-proximity weight)
all directly address this volume-imbalance bias.
