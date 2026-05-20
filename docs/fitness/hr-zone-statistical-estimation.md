# HR Zone Estimation — Statistical Analysis from Training Data

> **Status:** 2026-05-20 — Research synthesis + implementation plan  
> **Goal:** Derive personalized, non-uniform zone boundaries from 2 800+ activities using
> HR vs pace bucketing and piecewise breakpoint detection. No fixed percentages.

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

## 2. Algorithm — Step by Step

### Step 1: Data collection and filtering

From the Activity table, select all running activities:

```typescript
const runs = activities.filter(a =>
  /run|trail/i.test(a.sportType) &&
  a.distance >= 4000 &&          // ≥ 4km (steady-state HR needed)
  a.movingTime >= 900 &&         // ≥ 15 min
  a.averageHeartrate !== null &&
  a.averageHeartrate > 0 &&
  a.averageSpeed !== null
);
```

**Filter out confounders:**
```typescript
// Exclude interval sessions — whole-activity avgHR is diluted by recovery jogs
const isInterval = /intervall|interval|fartlek|tisdagsbana|bana\b/i.test(a.name ?? "");

// Downweight hot runs (heat elevates HR artificially)
// weatherTemp > 25°C → weight = 0.3; else weight = 1.0
const tempWeight = (a.weatherTemp ?? 15) > 25 ? 0.3 : 1.0;

// Recency weight: recent runs dominate (180-day half-life)
const daysAgo = (Date.now() - a.startDate.getTime()) / 86_400_000;
const recencyWeight = Math.exp(-daysAgo / 180);

const weight = tempWeight * recencyWeight;
```

### Step 2: Grade-Adjusted Pace (GAP)

Normalize pace for elevation. An uphill run at 4:30/km pace at 5% grade is physiologically
like flat 4:00/km. Without this correction, hilly runs skew the HR-pace relationship.

```typescript
// Minetti et al. (2002) cost-of-transport model
function gradeAdjustedPaceSecPerKm(
  paceSecPerKm: number,
  elevGainM: number,
  distM: number,
): number {
  if (distM < 500) return paceSecPerKm;
  const grade = elevGainM / distM;          // e.g. 0.05 = 5%
  const uphillFactor = grade >= 0 ? 1 + grade * 0.033 : 1 + grade * 0.018;
  return paceSecPerKm / uphillFactor;       // faster GAP on uphills
}
```

For whole-activity approximation: `grade = totalElevationGain / distance`.

### Step 3: Optimal bucket width (Freedman-Diaconis Rule)

Instead of an arbitrary 15 sec/km, compute the statistically optimal bucket width:

```typescript
function freedmanDiaconisBinWidth(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const h = 2 * iqr * Math.pow(n, -1/3);
  // Clamp to sensible range for pace data
  return Math.max(10, Math.min(30, Math.round(h)));
}
```

Typical result for 1 600+ runs: **12–18 sec/km buckets**.

### Step 4: Bucket the data

```typescript
interface Bucket {
  paceCenter: number;    // sec/km
  medianHR: number;      // bpm
  count: number;
  stddev: number;
}

function buildBuckets(
  points: Array<{ gap: number; hr: number; weight: number }>,
  binWidth: number,
  minCount: number = 15,
): Bucket[] {
  const map = new Map<number, Array<{ hr: number; w: number }>>();

  for (const p of points) {
    const key = Math.round(p.gap / binWidth) * binWidth;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ hr: p.hr, w: p.weight });
  }

  return [...map.entries()]
    .filter(([, pts]) => pts.length >= minCount)
    .map(([pace, pts]) => {
      // Weighted median HR — more robust than weighted mean
      const sorted = pts.sort((a, b) => a.hr - b.hr);
      const totalW = sorted.reduce((s, p) => s + p.w, 0);
      let cumW = 0;
      let medianHR = sorted[0].hr;
      for (const p of sorted) {
        cumW += p.w;
        if (cumW >= totalW / 2) { medianHR = p.hr; break; }
      }
      const mean = pts.reduce((s, p) => s + p.hr * p.w, 0) / totalW;
      const variance = pts.reduce((s, p) => s + p.w * (p.hr - mean) ** 2, 0) / totalW;
      return { paceCenter: pace, medianHR, count: pts.length, stddev: Math.sqrt(variance) };
    })
    .sort((a, b) => a.paceCenter - b.paceCenter);
}
```

### Step 5: Find breakpoints — Muggeo's iterative piecewise regression

Find the two pace values where the HR-pace slope changes most significantly.
These correspond to LT1 (aerobic threshold) and LT2 (anaerobic threshold).

```typescript
interface Breakpoint {
  pace: number;   // sec/km — where slope changes
  hr: number;     // bpm at this pace
}

function fitPiecewiseLinear(
  buckets: Bucket[],
): { lt1: Breakpoint; lt2: Breakpoint; rSquared: number } | null {
  if (buckets.length < 6) return null;

  const paces = buckets.map(b => b.paceCenter);
  const hrs = buckets.map(b => b.medianHR);
  const n = buckets.length;

  let bestError = Infinity;
  let bestBp1 = 1, bestBp2 = 3;

  // Exhaustive search over all valid breakpoint pairs (i, j) with i < j
  // O(n²) but n ≤ 30 buckets so fast enough
  for (let i = 1; i < n - 2; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      // Fit 3 linear segments: [0..i], [i..j], [j..n-1]
      const err = segmentError(paces, hrs, 0, i) +
                  segmentError(paces, hrs, i, j) +
                  segmentError(paces, hrs, j, n - 1);
      if (err < bestError) { bestError = err; bestBp1 = i; bestBp2 = j; }
    }
  }

  // Total variance for R²
  const meanHR = hrs.reduce((s, v) => s + v, 0) / n;
  const totalVar = hrs.reduce((s, v) => s + (v - meanHR) ** 2, 0);
  const rSquared = Math.max(0, 1 - bestError / totalVar);

  return {
    lt1: { pace: paces[bestBp1], hr: hrs[bestBp1] },
    lt2: { pace: paces[bestBp2], hr: hrs[bestBp2] },
    rSquared,
  };
}

function segmentError(paces: number[], hrs: number[], from: number, to: number): number {
  if (to - from < 2) return 0;
  const xs = paces.slice(from, to + 1);
  const ys = hrs.slice(from, to + 1);
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0) /
                xs.reduce((s, x) => s + (x - meanX) ** 2, 0.0001);
  const intercept = meanY - slope * meanX;
  return xs.reduce((s, x, i) => s + (ys[i] - (slope * x + intercept)) ** 2, 0);
}
```

### Step 6: Convert pace breakpoints → HR zones

The breakpoints give us **pace** at LT1 and LT2. Convert to HR using the regression:

```typescript
// Use the bucket at LT1 pace → that's LT1 HR
// Then build non-uniform zones around it

function buildNonUniformZones(
  lt1: Breakpoint,
  lt2: Breakpoint,
  maxHR: number,
  restHR: number,
): NonUniformZones {
  // Zone widths based on physiology — not equal
  // Z1 (recovery): below LT1 minus buffer
  // Z2 (aerobic base): LT1-buffer → LT1  ← typically 15-25 bpm wide
  // Z3 (tempo): LT1 → LT2               ← LT1-LT2 gap varies greatly per athlete
  // Z4 (threshold): LT2 → LT2+8 bpm    ← narrow: max sustainable effort
  // Z5 (VO2max): > LT2+8               ← above threshold

  const buffer1 = Math.max(6, Math.round((lt2.hr - lt1.hr) * 0.15));

  return {
    z1: [restHR,          lt1.hr - buffer1] as [number, number],
    z2: [lt1.hr - buffer1, lt1.hr]          as [number, number],
    z3: [lt1.hr,           lt2.hr]          as [number, number],
    z4: [lt2.hr,           lt2.hr + 8]      as [number, number],
    z5: [lt2.hr + 8,       maxHR]           as [number, number],
    // Metadata
    lt1HR:  lt1.hr,
    lt2HR:  lt2.hr,
    lt1PaceSecPerKm: lt1.pace,
    lt2PaceSecPerKm: lt2.pace,
    source: "statistical" as const,
  };
}
```

### Step 7: Bootstrap confidence intervals (optional)

```typescript
function bootstrapBreakpointCI(
  buckets: Bucket[],
  iterations = 500,
): { lt1Ci: [number, number]; lt2Ci: [number, number] } {
  const lt1s: number[] = [], lt2s: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from({ length: buckets.length },
      () => buckets[Math.floor(Math.random() * buckets.length)]);
    const result = fitPiecewiseLinear(sample.sort((a, b) => a.paceCenter - b.paceCenter));
    if (result) { lt1s.push(result.lt1.hr); lt2s.push(result.lt2.hr); }
  }
  lt1s.sort((a, b) => a - b); lt2s.sort((a, b) => a - b);
  const lo = Math.floor(iterations * 0.025), hi = Math.floor(iterations * 0.975);
  return {
    lt1Ci: [lt1s[lo], lt1s[hi]],
    lt2Ci: [lt2s[lo], lt2s[hi]],
  };
}
```

---

## 3. Validation

Cross-check the estimated LT2 against race PBs:

```
Expected: LT2_pace ≈ HM_race_pace (direct, most accurate)
Expected: LT2_pace ≈ 10K_pace × 1.065
Expected: LT2_HR   ≈ HR at HM race pace
```

If the statistical LT2 is > 8 bpm off from the race-PB-derived LT2, flag it and use the
race-PB method instead. The statistical method needs sufficient data in the LT2 pace range.

**Minimum data requirements:**
- At least 8 pace buckets with ≥ 15 runs each
- Buckets must span from Z1 pace to above Z4 pace
- If athlete runs only easy (no threshold work), deflection won't be visible

---

## 4. Integration into TrainingLab

### Where it fits:
- `lib/fitness/zones.ts` — new function `estimateZonesFromStatisticalAnalysis()`
- Called from `lib/fitness/cache.ts` in `updateHRZones()` as an additional source
- UI: new section in Stats → Zones tab — "Statistical zone analysis"
  Shows the HR-pace scatter plot with bucket medians, fitted piecewise line, and detected breakpoints

### Priority vs. existing methods:
```
1. Manual override (AthleteProfile.maxHeartRate) → always wins
2. Statistical analysis (this method) — if R² > 0.85 and ≥ 8 valid buckets
3. Race PB-derived (current method) — if good race data available
4. Fixed percentages (fallback)
```

### New UI component: `ZoneCalibrationChart`
- Scatter plot: x = GAP (sec/km), y = avgHR (bpm)
- Each point = one run (colour-coded by date/recency)
- Overlaid: bucket medians as large dots
- Piecewise regression line shown
- Vertical dotted lines at LT1 and LT2
- Zone labels on Y-axis (right side)
- R² shown as confidence indicator
- 95% CI bands around LT1/LT2 estimates

---

## 5. Expected Zone Widths (per athlete type)

For an athlete with LT1 = 155 bpm, LT2 = 170 bpm, maxHR = 190:

| Zone | Range | Width | Notes |
|---|---|---|---|
| Z1 Recovery | 40–149 bpm | 109 bpm | Wide — everything below LT1 buffer |
| Z2 Aerobic | 149–155 bpm | 6 bpm | Narrow — just before LT1 |
| Z3 Tempo | 155–170 bpm | 15 bpm | LT1→LT2 gap — varies greatly per athlete |
| Z4 Threshold | 170–178 bpm | 8 bpm | Narrow — max sustainable |
| Z5 VO2max | 178–190 bpm | 12 bpm | Above LT2 |

For a "flat" athlete (LT1 = 150, LT2 = 163, maxHR = 183):
- Z3 = 150–163 = only 13 bpm wide (narrow tempo zone)
- Z1 = very wide (110 bpm) — most easy running

**The key point:** Z3 width = LT2 − LT1, which varies from 8 to 25+ bpm across athletes.
Traditional 5-equal-zone models always get this wrong.

---

## 6. Known Limitations

| Issue | Impact | Mitigation |
|---|---|---|
| Whole-activity avgHR diluted by warm-up/CD | Underestimates intensity | Exclude sessions < 15 min; filter intervals |
| Heat elevates HR by 8–15 bpm | Shifts curve up → overestimates LT1 | Downweight runs > 25°C |
| HR drift on long runs | Late-run HR higher than steady-state | Focus on short/medium runs (< 90 min) |
| Athlete varies pace within a run | avgPace ≠ steady-state pace | No clean fix without lap data |
| Sparse data in Z4-Z5 | Breakpoint 2 unstable | Cross-validate against race PBs |

---

*Last updated: 2026-05-20*
