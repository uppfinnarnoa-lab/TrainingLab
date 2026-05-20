# TrainingLab — Analytics & Estimation Improvement Plan

> **Status:** 2026-05-20  
> **Purpose:** Research-backed implementation plan for new statistics features and improved fitness estimation.  
> Based on web research synthesis + your 2 800+ activity dataset.

---

## Table of Contents

1. [New Statistics & Visualisations](#1-new-statistics--visualisations)
2. [VDOT & Race Pace Estimation Improvements](#2-vdot--race-pace-estimation-improvements)
3. [HR Zone Estimation from Large Dataset](#3-hr-zone-estimation-from-large-dataset)
4. [Priority & Implementation Order](#4-priority--implementation-order)

---

## 1. New Statistics & Visualisations

All metrics below are computable from existing data (distance, time, avg HR, max HR, pace, elevation, name, date, Garmin HRV/sleep).

### 1A. Aerobic Efficiency & Economy

| Metric | Computation | Display | Why it matters |
|---|---|---|---|
| **Aerobic Efficiency Index (AEI)** | avg speed (m/min) ÷ avg HR · only easy runs (Z1–Z2) | Line chart, monthly trend | Rising AEI = heart delivers more per pump = aerobic adaptation |
| **Cardiac Drift / Decoupling (Pa:HR)** | (pace:HR ratio first half) vs (pace:HR ratio second half) of runs > 60 min | Scatter per long run, trend line | < 5% = aerobically fit for that duration; > 10% = aerobic deficit |
| **Running Economy proxy** | Standardised pace at 75% maxHR across 6-week rolling window | Line chart | Improving RE = you go faster at same HR |
| **Stride efficiency** | avg speed ÷ avg cadence (steps/min) · running only | Monthly trend | Proxy for stride length efficiency |

**Implementation note:** AEI requires filtering to easy runs. Use `avgHR < maxHR * 0.78` as Z2 ceiling. Cardiac drift requires splitting `movingTime` into halves — approximated using first and second half of `splitsMetric` if available, otherwise skipped.

---

### 1B. Polarised Training Distribution (Seiler 80/20)

Research consensus: elite endurance athletes do ~80% below LT1, ~5–10% at LT2, ~15% above LT2.

| Metric | Computation | Display |
|---|---|---|
| **Zone time distribution** | Classify each activity by avgHR into Seiler's 3 zones (Z1 < LT1, Z2 = LT1–LT2, Z3 > LT2) · sum minutes per zone | Donut per last 4 weeks |
| **Polarisation score** | (Z1% / 80) weighted compliance · penalise Z2 overload | Single 0–100 score + "80/20" badge |
| **Junk miles detector** | Sessions where 40–75% time is Z2 (moderate — not easy, not hard) | Warning badge when > 20% of volume is Z2 |

**Implementation note:** Use cached LT1/LT2 HR from FitnessCache. Each activity classified to one zone based on avgHR. Short runs (< 15 min) excluded from zone analysis.

---

### 1C. Injury Risk & Load Spikes

| Metric | Computation | Display |
|---|---|---|
| **ACWR (Acute:Chronic Workload Ratio)** | 7-day TSS sum ÷ 28-day rolling avg TSS | Gauge: 0.8–1.3 green, > 1.5 red |
| **Ramp rate** | (this week TSS − last week TSS) / last week TSS × 100 | Warning badge if > 10% single-week jump |
| **Injury risk score** | ACWR × 0.5 + (rampRate > 10% ? 0.3 : 0) + (HRV declining 7d ? 0.2 : 0) | Gauge 0–100 on dashboard |

**Research finding:** ACWR > 1.5 is the single strongest predictor of overuse injury in runners (Gabbett 2016). A 10%+ weekly ramp rate doubles injury probability.

---

### 1D. Year-over-Year & Seasonal Analysis

| Metric | Computation | Display |
|---|---|---|
| **YoY volume heatmap** | Sum km per week × year, grid | Calendar heatmap (same as GitHub) |
| **YoY load curve** | Overlay CTL from each of the last 3 years | Multi-line chart, weeks 1–52 on X |
| **Peak CTL date** | argmax of CTL per year | Annotated on load chart |
| **PR progression per year** | Best time per distance per calendar year | Multi-line chart on Races page |
| **Active streak** | Consecutive days with ≥ 1 activity | Stat card on dashboard |

---

### 1E. Weather & Environmental Correlations

| Metric | Computation | Display |
|---|---|---|
| **Temp sensitivity** | Linear regression: temp → pace delta (sec/km) across all runs | "You run X sec/km slower per 5°C above 15°C" |
| **Dew point / humidity adjustment** | If weatherCode available: flag sessions with temp > 20°C + humidity | Yellow badge on activity if hot/humid |
| **Time-of-day analysis** | Group activities by hour → avg pace at each hour (easy runs only) | Bar chart, shows morning vs evening performance |

---

### 1F. Long-Run Specific Analytics

| Metric | Computation | Display |
|---|---|---|
| **Long-run fatigue index** | Pace km 1–5 vs pace km -5 to finish · requires splitsMetric | Scatter per long run |
| **HR drift per long run** | avgHR first 30% vs last 30% of movingTime | Listed on long run activity detail |
| **Distance specialty profile** | (Marathon pace) / (5K pace) ratio | "Sprinter" ↔ "Endurance" label on Fitness tab |

---

### 1G. Recovery Dashboard (from Garmin)

| Metric | Computation | Display |
|---|---|---|
| **7-day HRV trend** | Rolling 7-day HRV · colour-coded vs 5-week baseline | Sparkline on dashboard |
| **Sleep + HRV correlation** | Pearson r between previous night sleep hours and next-day HRV | Displayed as "sleep quality matters X% for your HRV" |
| **Readiness score** | HRV (40%) + TSB (30%) + sleep score (20%) + restHR trend (10%) | 0–100 gauge on dashboard |
| **Resting HR trend** | 12-week rolling resting HR from Garmin | Line chart on dashboard |

---

## 2. VDOT & Race Pace Estimation Improvements

### 2A. Grade-Adjusted Pace (GAP) in HR-Pace Regression

**Problem:** The current HR-pace regression uses flat-equivalent pace. Hilly runs show a slow avg pace but a high HR, which flattens the regression slope and underestimates VO2max.

**Fix:** Compute GAP using elevation data per split:
```
GAP_sec_per_km = pace × (1 / (1 + grade × 0.033))
```
where `grade = totalElevationGain / distanceM`.

This is a whole-activity approximation. For the HR-pace regression, replace `avgPaceSecPerKm` with `gapSecPerKm` when building regression points:

```typescript
function gradeAdjustedPace(paceSecPerKm: number, elevGainM: number, distM: number): number {
  if (distM < 1000) return paceSecPerKm;
  const grade = elevGainM / distM; // fraction, e.g. 0.02 = 2%
  return paceSecPerKm / (1 + grade * 0.033);
}
```

**Expected improvement:** 10–15% more accurate LT estimation for runners with > 30% hilly sessions.

---

### 2B. Riegel Formula as Second Race Predictor

**Research finding:** VDOT is more accurate than Riegel for 5K–HM for trained runners (±2–3%). But Riegel is more reliable for cross-distance extrapolation (5K → marathon) when training base for marathon is uncertain.

**Implementation:** Show BOTH predictions side-by-side in the Fitness tab predictions table:

```
Distance | VDOT prediction | Riegel (from best PB) | Confidence
5K       | 18:25           | 18:21                 | High
10K      | 38:12           | 38:45                 | High  
HM       | 1:24:30         | 1:25:10               | Medium
Marathon | 3:01            | 2:59                  | Low — add 8-10 min buffer
```

**Riegel formula:**
```typescript
function riegelPredict(t1Sec: number, d1M: number, d2M: number, exponent = 1.06): number {
  return t1Sec * Math.pow(d2M / d1M, exponent);
}
// Use best available PB as T1/D1
// Exponent: 1.04 for advanced, 1.06 standard, 1.08 beginners
```

**Marathon note:** Add a static +8 min warning when predicting marathon from ≤ HM PB ("This assumes sufficient long-run base").

---

### 2C. Race Prediction Confidence Intervals

Instead of a single number, show a range:

```
5K: 18:25 ± 0:30  (VDOT ±2.5% empirical error)
10K: 38:12 ± 1:10
```

```typescript
function confidenceRange(predictedSec: number, distM: number): { low: number; high: number } {
  const pct = distM >= 21000 ? 0.05 : distM >= 10000 ? 0.03 : 0.025;
  return { low: Math.round(predictedSec * (1 - pct)), high: Math.round(predictedSec * (1 + pct)) };
}
```

---

### 2D. Heat & Elevation Race Adjustments

Show adjusted predictions when weather data is available for an upcoming race:

```
Race: Stockholm Marathon (May, 18°C forecast)
Base prediction: 3:01:00
Heat adjustment (+5°C above 10°C baseline): +3:00
Adjusted: 3:04:00
```

Adjustments (research-backed):
- Temperature: +5 sec/km per 5°C above 10°C (flat adjustment per km)
- Net elevation: +3 sec/km per 100m net gain per km of race

---

## 3. HR Zone Estimation from Large Dataset

### 3A. Statistical LT Detection — HR vs GAP Regression

Current approach: LT2 from race PBs → HR zones fixed. This works well when PBs are recent.

**Improved approach:** Detect LT2 deflection point statistically from 2 800+ activities:

```
Step 1: Group all easy-to-moderate runs by 10 sec/km pace buckets
Step 2: Compute median avgHR per bucket (filter: distance > 4km, not intervals)
Step 3: Fit polynomial (degree 2) to (GAP, avgHR) relationship
Step 4: Compute second derivative → find inflection → LT2 candidate HR
Step 5: Cross-validate against race-PB-derived LT2 (they should agree within 5 bpm)
```

**Expected accuracy:** ±4–7 bpm vs. lab lactate test (Garmin's own device shows ±6–7 bpm, so this is equivalent).

**Implementation in `zones.ts`:**
```typescript
export function estimateLTFromDeflection(
  activities: { gapSecPerKm: number; avgHR: number }[],
  maxHR: number
): number | null {
  // Bucket by 15 sec/km, median HR per bucket
  // Fit quadratic, find inflection point
  // Return HR at deflection, or null if insufficient data
}
```

This becomes an additional source for LT2 alongside the race-PB method.

---

### 3B. Zone Width Personalisation

**Research finding:** Zone boundaries are not symmetric. The non-uniform zones already implemented (Z1/Z2 narrow, Z3 wide, Z4/Z5 narrow) are correct. But the WIDTH should vary per athlete based on their HR-pace relationship slope.

Athletes with steep HR-pace slopes (HR rises quickly with pace) have narrow zones. Flat slopes → wide zones.

**Implementation:** After computing the regression slope, adjust zone widths:
```
steep slope (> 0.4 bpm/sec·km):  z2 = 6 bpm wide, z4 = 6 bpm wide
normal slope (0.2–0.4):           z2 = 8 bpm, z4 = 7 bpm  (current defaults)
flat slope (< 0.2):               z2 = 10 bpm, z4 = 8 bpm
```

---

### 3C. Activity-Level HR Zone Classification Improvement

Currently, each activity is classified to a zone based on avgHR alone. This misclassifies interval sessions (high avgHR but most time is Z1 recovery jog).

**Better classification:** For activities matching `looksLikeIntervals()`:
- Classify as Z3/Z4 based on `maxHeartrate` rather than `avgHR`
- Or assign a split: 50% Z1 (warm-up/recovery) + 50% Z4/Z5 (interval segments)

This improves polarisation score accuracy for interval-heavy training weeks.

---

## 4. Priority & Implementation Order

| # | Feature | Effort | Impact | Data needed |
|---|---|---|---|---|
| 1 | **ACWR injury risk gauge** (1C) | Low | High — actionable daily | TSS history (already have) |
| 2 | **AEI trend line** (1A) | Low | High — shows fitness gains | avgHR + pace (already have) |
| 3 | **Polarisation score** (1B) | Medium | High — training quality | LT1/LT2 from cache |
| 4 | **YoY volume heatmap** (1D) | Low | Medium — fun + motivating | All activities |
| 5 | **Riegel predictions + confidence intervals** (2B, 2C) | Low | Medium — better race planning | Race PBs (already have) |
| 6 | **GAP in HR regression** (2A) | Medium | Medium — more accurate VO2max | totalElevationGain (already have) |
| 7 | **Readiness score + HRV trend on dashboard** (1G) | Medium | High — daily decision making | Garmin data |
| 8 | **Temperature sensitivity profile** (1E) | Medium | Medium — fun insight | weatherTemp (already have for many activities) |
| 9 | **Statistical LT deflection detection** (3A) | High | Medium — validation/cross-check | All runs with avgHR |
| 10 | **Zone width personalisation** (3B) | Low | Low — refinement | Regression slope (already computed) |

**Suggested next session:** Implement items 1–5 (all low/medium effort, high impact). These add four new cards/charts to the Stats page and improve the Fitness tab predictions.

---

*Last updated: 2026-05-20*
