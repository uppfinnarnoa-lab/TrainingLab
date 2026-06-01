# Implementation Plan — LT & AT Tempo Development Chart

**Status:** Implemented 2026-05-31 (Option B — statistical, incremental)  
**Scope:** `lib/fitness/cache.ts` + new chart component + stats page integration

---

## 1. What We're Building

A statistics chart showing how the athlete's LT pace (lactate threshold = LT2) and
AT pace (aerobic threshold = LT1) have evolved over time — both historically (back-calculation)
and as a short forward projection.

This makes fitness progression visible as a pace trend, not just a VDOT number.

---

## 2. Design Choices

### Granularity: Monthly windows

- **Per-session:** 300+ data points/year, too noisy and computationally expensive
- **Weekly:** 52+ windows × expensive zone estimation = prohibitively slow
- **Monthly:** ~30 windows × 90-day rolling data = manageable, matches existing `vdotTrend` approach

**Recommendation:** Monthly data points, identical cadence to the existing VDOT trend.

### Back-calculation approach: Two options

**Option A — VDOT-derived (free, already computed)**

The existing `vdotTrend` loop already computes VDOT per monthly window. We can derive
LT1/LT2 pace directly from VDOT using the same formulas as `buildPaceZones`:

```typescript
// For each vdotTrend window where VDOT is already computed:
const vO2maxVelocity = vdotToVelocity(vdot); // m/s
const lt2PaceSecPerKm = Math.round(1000 / (vO2maxVelocity * 0.88)); // LT2 ≈ 88% vVO2max
const lt1PaceSecPerKm = Math.round(lt2PaceSecPerKm / 0.844);        // LT1 via VT1/VT2 ratio
```

- **Pros:** Zero additional computation — just add 2 fields to existing `vdotTrend` entries
- **Cons:** Derives pace from race-performance model, not directly from HR training data.
  Less sensitive to true aerobic base shifts (e.g., altitude, heat adaptation)
  that aren't yet visible in race times.

**Option B — Statistical rolling estimation (accurate, more expensive)**

Run `estimateZonesFromStatisticalAnalysis` once per monthly window, producing LT1/LT2 pace
directly from the HR-pace bucket curve — the same way the calibration button works.

```typescript
// New loop similar to vdotTrend, but running zone estimator per window:
for (let i = 0; i < 30; i++) {
  const windowEnd = subDays(now, i * 30);
  const windowLaps = lapRuns.filter(l => l.startDate >= subDays(windowEnd, 90) && l.startDate <= windowEnd);
  const result = estimateZonesFromStatisticalAnalysis(windowLaps, maxHR, restHR, windowEnd);
  if (result) ltPaceTrend.push({ month: format(windowEnd, "yyyy-MM"), lt1Pace: result.lt1PaceSecPerKm, lt2Pace: result.lt2PaceSecPerKm, r2: result.rSquared });
}
```

- **Pros:** Directly observes training physiology. Shows true aerobic adaptation regardless
  of race performance. Includes R² as a confidence indicator per data point.
- **Cons:** ~30 additional zone estimations per `updateVO2maxAndPaces` run. Each estimation
  on the full 5-year dataset takes ~200ms server-side → ~6s extra per sync.
  Optimization: only pass laps from the relevant 90-day window, not all 5 years.

**Recommendation:** Option B for accuracy, with optimization to only pass the window's laps.

### Forward projection (3 months)

Simple linear regression over the last 6 data points → extrapolate 3 months ahead.

```typescript
// On the frontend, compute the projection from the ltPaceTrend array:
const recent = ltPaceTrend.slice(-6);
const slope = linearRegressionSlope(recent.map(p => p.lt2Pace)); // sec/km per month
const projectedMonths = [1, 2, 3].map(m => ({
  month: addMonths(lastDataPoint, m),
  lt2Pace: lastDataPoint.lt2Pace + slope * m,
  projected: true,
}));
```

Projected portion rendered as dashed lines on the chart.

**Note:** This is a simple extrapolation, not a training model prediction. If the trend
was improving, it projects continued improvement. If stable, it projects stable. No CTL/ATL
adjustment for planned training.

---

## 3. Data Structure

Add to `extraVizJson` in `FitnessCache`:

```typescript
ltPaceTrend: Array<{
  month: string;           // "yyyy-MM"
  lt1PaceSecPerKm: number; // AT tempo (LT1)
  lt2PaceSecPerKm: number; // LT tempo (LT2)
  r2?: number;             // confidence — only present with Option B
}>
```

---

## 4. Backend Changes

**File:** `lib/fitness/cache.ts` — `updateVO2maxAndPaces()`

### Option A (VDOT-derived) — minimal change

Extend the existing `vdotTrend` loop to also store LT paces:

```typescript
// Inside the existing vdotTrend loop:
const lt2PaceSecPerKm = Math.round(1000 / (vdotToVelocity(v.vdot) * 0.88));
const lt1PaceSecPerKm = Math.round(lt2PaceSecPerKm / 0.844);
ltPaceTrend.push({ month, lt1PaceSecPerKm, lt2PaceSecPerKm });
```

Note: `vdotToVelocity` is private in `zones.ts` — would need to be exported, or the formula
duplicated/inlined.

### Option B (Statistical) — new computation block

After the existing `vdotTrend` block, add:

```typescript
const ltPaceTrend: { month: string; lt1PaceSecPerKm: number; lt2PaceSecPerKm: number; r2: number }[] = [];
{
  // Reuse laps already built for updateHRZones (statLapRuns)
  // but this runs in updateVO2maxAndPaces which doesn't have statLapRuns
  // → need to build laps inline or factor into a shared helper
  const olFilter = (a: ActLight) => ... // name-only OL filter (no pace threshold for historical)
  const allLaps = buildLapRuns(acts, olFilter);

  for (let i = 0; i < 30; i++) {
    const windowEnd = subDays(now, i * 30);
    const windowStart = subDays(windowEnd, 90);
    const windowLaps = allLaps.filter(l => l.startDate >= windowStart && l.startDate <= windowEnd);
    if (windowLaps.length < 40) continue;
    const result = estimateZonesFromStatisticalAnalysis(windowLaps, maxHR, restHR, windowEnd);
    const month = format(windowEnd, "yyyy-MM");
    if (result && !ltPaceTrend.find(x => x.month === month)) {
      ltPaceTrend.push({ month, lt1PaceSecPerKm: result.lt1PaceSecPerKm, lt2PaceSecPerKm: result.lt2PaceSecPerKm, r2: result.rSquared });
    }
  }
  ltPaceTrend.sort((a, b) => a.month.localeCompare(b.month));
}
```

**Performance consideration:** Each window only processes laps from its 90-day window,
not all 5 years. With ~100 laps/month typical, 90-day windows have ~300 laps — estimation
takes <50ms. Total addition: ~1.5s per sync. Acceptable.

---

## 5. Frontend Changes

### New component: `components/charts/LTPaceTrendChart.tsx`

- **Chart type:** Line chart (Recharts `LineChart`)
- **X-axis:** Month labels (last 24–30 months + 3 projected)
- **Y-axis:** Pace in min/km (inverted — faster = higher on chart, since min/km is smaller
  for faster pace; OR display as inverted axis so "better" = up)
- **Two lines:**
  - AT (LT1) — dashed or lighter line
  - LT (LT2) — solid, primary line
- **Projected section:** Dashed line, visually distinct (opacity or dash pattern)
- **Tooltip:** Show both LT1/LT2 pace + R² confidence (if available)
- **Reference line:** Current calibrated LT1/LT2 as horizontal dashed lines for comparison

**Y-axis note:** Display paces as readable (e.g. "4:30") not raw seconds. Invert axis
so faster pace (lower sec/km) appears higher — more intuitive ("going up = improving").

### Stats page integration

Add the chart as a new card in the stats dashboard, logically adjacent to the VDOT trend
or the zone calibration card. Suggested placement: after "VO2max / VDOT trend".

---

## 6. Implementation Order

1. Backend (Option B recommended):
   - Add `vdotToVelocity` export to `zones.ts` (or inline the formula in `cache.ts`)
   - Add `ltPaceTrend` computation to `updateVO2maxAndPaces`
   - Add `ltPaceTrend` to `extraVizJson` shape
2. Frontend:
   - Create `LTPaceTrendChart.tsx`
   - Add projection computation (client-side, from the stored array)
   - Wire into stats page

---

## 7. Open Questions

- **Option A vs B:** VDOT-derived is cheaper but less accurate. Statistical is better but adds
  ~1.5s to sync. Confirm preference before implementing.
- **Y-axis direction:** "Faster = up" (inverted sec/km) vs "lower number = down" (natural).
  Runner intuition says "getting faster" should go up → inverted axis recommended.
- **Historical depth:** 24 months (matching intensityProfile) or 30 months (matching vdotTrend)?
- **Projection:** 3 months forward is suggested; could be user-configurable.

---

*Plan written: 2026-05-31*
