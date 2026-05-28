# Bucket Estimator HR Zone Model — Improvement Research

> **Status:** 2026-05-28 — Research + critique, awaiting approval for implementation  
> **Problem:** LT1 and LT2 estimated systematically too low (zones shifted downward)  
> **Model file:** `lib/fitness/zones.ts` → `estimateZonesFromStatisticalAnalysis()`

---

## Current Algorithm Summary

1. Filter runs: HR 52–96% maxHR, ≥800m, ≥3min, terrain grade < 12%
2. Compute Grade-Adjusted Pace (GAP) via `rawPace / (1 + grade × 0.033)`
3. Apply temperature weight: >30°C skip, 25–30°C ×0.35, 20–25°C ×0.75, else ×1.0
4. Apply recency weight: 180-day half-life exponential decay
5. Bucket by fixed 15 s/km bins; require ≥10 runs/bucket; weighted median HR per bucket
6. Pool-adjacent-violators for monotonicity
7. Exhaustive piecewise linear search for two breakpoints → LT1/LT2
8. R² threshold ≥ 0.62; sanity checks on HR/pace physiological ranges
9. Require ≥ 6 monotone buckets

---

## Root Causes of Systematic Underestimation

Before evaluating fixes, it helps to understand *why* LT comes out low:

**Volume imbalance:** Easy/recovery runs vastly outnumber threshold runs in any training plan
(typically 80/20 split). This means the slow end of the HR:pace curve is extremely well-fitted
by the regression, while the fast/threshold end is sparse. Sparse endpoints pull the breakpoints
toward the centre of the data — which is in the aerobic zone, not at the true threshold.

**Warm-up contamination:** Whole-activity averages include warm-up km where HR is rising from
rest. A 10km run starting at 100 bpm and reaching steady-state at 150 bpm has an average of
~140 bpm — lower than the true steady-state HR for that pace.

**Old fitness data:** With a 180-day half-life and potentially years of data, runs from when
the athlete was significantly less fit (lower LT) still contribute and pull estimates down.

---

## 10 Improvement Ideas — With Risk/Benefit Analysis

---

### 1. Lap-Split Data Instead of Activity Averages ⭐⭐⭐⭐

**What:** Use individual km-splits (lap data stored in `ActivityLap`) rather than whole-activity
averages. Each lap is already at steady-state (warm-up has happened). A 20km run becomes 20
data points at progressively narrower pace/HR windows.

**Why it helps:** Directly removes warm-up contamination from activity averages. A 5km
tempo at 4:10/km with avgHR 168 bpm becomes five 4:10/km laps at HR 165/167/169/170/170 —
clean steady-state data at the true threshold.

**Risks:**
- Requires `ActivityLap` table to be populated — need to verify coverage
- Pace/HR matching at lap level can be noisy for GPS drift; need min-lap-length filter (~600m)
- Could triple data volume → slower compute; needs re-profiling

**Verdict:** High impact, feasible. Check lap coverage before committing.

---

### 2. Shorten Recency Window to 60–90 Days ⭐⭐⭐⭐

**What:** Replace the 180-day half-life with 60–90 days. Runs older than 6 months get < 10%
weight; most of the signal comes from the last 3 months.

**Why it helps:** An athlete who has improved significantly in 6 months has a higher LT now
than in their historical data. 180-day averaging blends two different fitness states.

**Risks:**
- If the athlete takes a 3-month break (illness, off-season), there may be insufficient recent data
- Need a fallback: if recent data < 40 points, widen window automatically
- Could make the estimate unstable for athletes who recently changed training style

**Verdict:** High impact, low risk if combined with a data-volume fallback. Strong recommendation.

---

### 3. Pace Range Narrowing — Exclude Recovery Runs ⭐⭐⭐⭐

**What:** Raise the minimum GAP filter from 200 s/km to ~280–300 s/km (4:40–5:00/km) and
narrow the upper end to ~370 s/km (6:10/km). Exclude very easy recovery pace entirely.

**Why it helps:** Recovery runs at 6:00+/km are run at HR far below LT1 by design. Including
them adds many data points at the low end of the HR:pace curve, which biases the piecewise
linear fit to put the breakpoint higher on the pace axis (= slower pace = lower HR at LT).

**Risks:**
- For slower athletes or trail runners whose easy pace is 6:00–7:00/km, this could eliminate
  too much data
- Should be parameterized by maxHR or estimated fitness level — not a hard cutoff
- Focusing only on 4:40–6:10 range could miss athletes who do all training at >6:00/km

**Verdict:** Medium impact. Implement as a soft filter: weight runs by proximity to expected
aerobic zone rather than hard exclusion.

---

### 4. Shorten Recency Window AND Weight by HR Zone ⭐⭐⭐

**What:** Instead of equal weighting within the accepted range, give extra weight to runs
that happen in the 60–80% maxHR range (aerobic zone) and deprioritize runs at < 55% or
> 90% maxHR. The key inflection points are most visible in the moderate aerobic range.

**Why it helps:** The HR:pace relationship has the best signal-to-noise in the aerobic zone.
Very low-HR recovery and very high-HR threshold/VO2max efforts both have high variance.

**Risks:**
- Creates a circular dependency: we need to know the zones to weight by zone
- Could be bootstrapped from % maxHR estimates (e.g., prefer 62–85% maxHR data)
- Moderate additional complexity

**Verdict:** Medium impact. Combine with recency-window shortening (idea 2).

---

### 5. Use Race PBs as Anchors for LT2 ⭐⭐⭐⭐⭐

**What:** After the statistical estimate, apply a hard anchor: LT2 must lie within ±10 bpm
of the HR observed in the athlete's best half-marathon (LT2 ≈ HM race pace ≈ LT2 HR).
If the statistical estimate is outside this range, bias toward the race-derived estimate.

**Why it helps:** Race data gives ground-truth LT2. A 1:32 half-marathon is run *at* LT2
pace. The average HR in that race is the LT2 HR. This is the most direct measurement available.

**Risks:**
- Requires at least one recent (< 2 years) half-marathon or 10K PB
- Race HR data is stored in `maxHeartrate` not `averageHeartrate` for race activities —
  need to check data coverage
- If the athlete has only old PBs, race-derived LT2 may underestimate current fitness

**Verdict:** Very high impact when PB data is available. Already partially implemented via
`estimateLTFromRaces()` — the question is whether the anchoring is aggressive enough in the
blend. See if raising the weight of the race-derived estimate resolves the underestimation.

---

### 6. Cardiac Drift Correction for Long Runs ⭐⭐⭐

**What:** HR drifts upward over long runs (+3–8 bpm per hour at constant pace) due to
thermoregulation and fluid loss. This is called cardiac drift. Long-run averages therefore
overestimate the HR for a given pace. Apply a correction: `correctedHR = avgHR - (duration/3600) × driftRate`.

**Why it helps:** Long easy runs (90–120min) have artificially inflated avgHR, which places
them in a higher HR bucket than a short run at the same pace. This inflates the HR at slow
paces and compresses the apparent range, pushing LT estimates down.

**Risks:**
- Drift rate varies by heat, humidity, and fitness — hard to estimate per-run
- A simple fixed-rate correction (e.g., 4 bpm/hr) may over- or under-correct
- Could introduce more noise than it removes if the constant is wrong

**Verdict:** Medium impact. A flat correction of ~3 bpm/hr is defensible as a heuristic.
Apply only to runs > 60 min.

---

### 7. Tighter Grade Correction — Use Actual Minetti Model ⭐⭐⭐

**What:** Replace the linear grade approximation `rawPace / (1 + grade × 0.033)` with a
proper piecewise Minetti metabolic cost model. The linear approximation overestimates the
pace adjustment at high grades (> 8%), causing hilly run data to cluster at wrong pace bins.

**Why it helps:** A trail run at 5:00/km at 10% grade has a true aerobic equivalent of about
3:40/km (not 4:40/km as the linear model gives). If this run's GAP is miscalculated, its
HR ends up in the wrong bucket, degrading the HR:pace curve.

**Risks:**
- Minetti model is slightly more complex: needs a lookup/interpolation table for metabolic cost
- Only matters for athletes who do significant trail/hilly running
- The Minetti model already exists elsewhere in the codebase (splits-chart, decoupling)
- Inconsistency with other GAP uses could be confusing if not centralized

**Verdict:** Medium impact for trail runners. Low risk — the model already exists.
Centralize GAP computation to a shared function.

---

### 8. Adaptive Bin Width Based on Data Density ⭐⭐

**What:** Instead of a fixed 15 s/km bin, compute the Freedman-Diaconis optimal bin width:
`binWidth = 2 × IQR(pace) × n^(-1/3)`. This gives narrower bins where data is dense
(typically around the athlete's main training pace) and wider bins in sparse regions.

**Why it helps:** With a fixed 15 s/km bin, the zone around LT (where the curve kinks)
may have the kink fall between bins, causing the piecewise fit to miss it or place it in
the wrong bin. Adaptive bins improve resolution at the threshold pace.

**Risks:**
- Adaptive bins require more data to be robust; too narrow a bin → fewer points → noisy median
- Result is harder to debug visually
- Benefit is marginal if the fixed 15 s/km bin already captures the kink well

**Verdict:** Low-medium impact. The current 15 s/km bin is already quite well-tuned.
Only worth implementing if other fixes don't resolve the underestimation.

---

### 9. Segment-Count Selection via BIC ⭐⭐

**What:** Instead of always fitting a 3-segment (2-breakpoint) model, also fit 2-segment and
4-segment models and select by Bayesian Information Criterion (BIC). Some athletes' HR:pace
curves are more linear (one threshold) or have three distinct transitions.

**Why it helps:** Forcing 2 breakpoints when the data only supports 1 can misplace both
breakpoints, compressing them into a region where there isn't a clear kink and generating
a plausible-but-wrong result.

**Risks:**
- Adds significant algorithmic complexity
- A 4-segment model would need a clear physiological interpretation
- High risk of overfitting on small datasets
- Not the root cause of systematic underestimation

**Verdict:** Low impact for the current problem. The systematic bias suggests a data quality
issue, not a model structure issue.

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
- Marginal gain over existing distance-based filtering (long runs already tend to have
  steady pace)

**Verdict:** Low-medium impact. Worth trying if lap data isn't available.

---

## Priority Ranking

| # | Idea | Expected Impact | Implementation Effort | Recommended |
|---|---|---|---|---|
| 5 | Race PB anchoring (stronger weight) | Very High | Low | ✅ Implement first |
| 2 | Shorten recency to 60–90 days + fallback | High | Low | ✅ Implement |
| 1 | Lap-split data instead of activity averages | High | Medium | ✅ After checking data coverage |
| 3 | Exclude recovery pace (narrow range) | Medium-High | Low | ✅ Implement (soft filter) |
| 6 | Cardiac drift correction | Medium | Low | Consider |
| 7 | Proper Minetti GAP model (centralize) | Medium (trail runners) | Medium | Consider |
| 4 | Weight by proximity to aerobic zone | Medium | Low | Combine with #2 |
| 10 | Strava workout type labels | Low-Medium | Low | Low priority |
| 8 | Adaptive bin width (FD) | Low-Medium | Medium | Last resort |
| 9 | BIC segment-count selection | Low | High | Not recommended |

---

## Immediate Actionable Changes (Low-Risk)

These can be implemented without approval of the full research plan:

1. **Shorten recency half-life from 180 to 90 days** — one line change, fallback to 180 days if data < 40 points
2. **Raise minimum GAP from 200 to 260 s/km** — excludes fastest VO2max-only paces, reduces noise at the fast end
3. **Apply cardiac drift correction**: subtract `max(0, (movingTimeSec / 3600 - 1.0) × 3.5)` from avgHR before bucketing
4. **Investigate race PB anchoring weight** — check if current `estimateLTFromRaces()` result is given enough weight vs. statistical result in `cache.ts`

---

## Note on Breakpoint Direction

The piecewise linear model sorts pace **ascending** (fast=low s/km first). The breakpoints are:
- `bp1` (lower index, faster pace) = **LT2**
- `bp2` (higher index, slower pace) = **LT1**

If the data is dominated by easy-pace runs, the piecewise fit will fit the slow end well and
place the first breakpoint further right (slower), pushing LT2 estimated pace *slower* than
actual — which means a lower HR at LT2. This confirms the root-cause analysis: more easy data
= lower LT estimates.
