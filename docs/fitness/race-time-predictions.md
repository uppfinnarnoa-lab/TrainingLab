# Race Time Predictions — Model

> **Purpose**: How `FitnessCache.predictionsJson` (the Stats page "Race Time Predictions" table and the AI coach's `get_fitness_summary` tool) is computed. Implemented 2026-06-24, replacing a single-global-exponent Riegel model — see [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](../planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md) for the original diagnosis and design rationale. Extended 2026-06-24 (same day, follow-up session) to wire in a Critical Speed/W′ vote and long-run-history confidence signal — see [docs/planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](../planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md).

---

## 1. The problem this replaced

Two models used to run in parallel:

1. **"Peak"** — `predictRaceTime(vdot, meters)`: binary-searches Daniels' universal %VO2max-vs-duration table for the time matching one blended VDOT number. Accurate near the distances that dominate that VDOT's own calibration data (for most runners, 1K–5K), but a population-average curve — it has no way to know if a specific runner's endurance profile deviates from average at longer durations.
2. **"Riegel"** — `riegelPredict(t1, d1, d2, exponent)` with `exponent` from `personalizedFatigueExponent()`: fit ONE log-log slope across every `bestEffort` from 1000m to 42195m, then extrapolated that single exponent from one fixed anchor (the PB with the highest implied VDOT — often a Mile) across the entire distance range.

For a runner with a "spikier" profile (strong short, weaker relative long endurance), this produced exactly the complaint: "short a little too slow, long way too fast" for Peak, and an even worse over-correction for Riegel (predicted 10K times +17–30% too slow) — because the regression mixed two different effort regimes (anaerobic/VO2max-dominant short efforts vs. submaximal long-run segments) into one straight line.

## 2. The current model

### `personalizedFatigueExponent(bestEfforts)`

Log-log regression of pace vs. distance, same as before, but **capped at 10K**. Beyond 10K, a `bestEffort` segment is essentially never a genuine maximal flat-road effort — see §3 below for why `Activity.isRace` can't rescue it. Empirically verified per-athlete: implied VDOT from `bestEfforts` stays consistent (53.8–60 in the original validation case) through 10K, then crashes hard beyond it. Falls back to standard Riegel (1.06) if fewer than 3 distinct distances survive the filter.

### `personalizedRacePrediction(targetM, knownPerformances, fallbackExponent)`

The core fix. Instead of one global exponent extrapolated from one fixed anchor, this finds the runner's own real results bracketing `targetM`:

- **Two real results, one below and one above** the target (and far enough apart to avoid amplifying noise into a wild slope): fits a *local* Riegel exponent between just those two points, clamped to `[0.95, 1.25]`. This is a true interpolation — it never mixes physiologically different regimes, because it only ever looks at the two points nearest the target.
- **Only one side has data** (extrapolation): falls back to `fallbackExponent` (the personalized global exponent above, or standard 1.06) applied from that single nearest anchor. Returns `bracketed: false` so the caller knows this is less certain.
- **No real results at all**: returns `null`.

### `buildKnownPerformances(racePBs, bestEfforts)`

Merges two sources into one deduplicated set, keyed by rounded distance:

- `RaceRecord` PBs — trusted at **any** distance only when `isManual: true`. Beyond 10K, an auto-detected (`isManual: false`) entry is excluded entirely *before* it reaches this function — see `lib/fitness/cache.ts::loadRacePBs()` and the equivalent block in `app/(dashboard)/stats/page.tsx`, both of which must apply the same filter.
- `Activity.bestEfforts` — trusted only **≤10K**.

**Why `Activity.isRace` is not used to extend trust beyond 10K:** verified against real data that for at least one athlete using this app, `isRace=true` is set exclusively on orienteering events (forest terrain, navigation stops) — *zero* of that athlete's logged road race PBs come from an `isRace`-flagged `Activity`. Orienteering pace at a given distance reflects terrain and navigation, not road race speed, so trusting "race-flagged" segments beyond 10K would feed in misleadingly slow pace data labeled as if it were a fast road effort.

**`RaceRecord` used to be exempt from this problem unconditionally** ("a separate, user-confirmed table" — true when it only ever held manually-entered PBs). That stopped being true once automatic PB detection shipped (2026-06-24): an `isRace=true` orienteering result can be auto-recorded as a "PB" exactly like any other `Activity`, so the *same* isRace-isn't-road-pace caveat now applies to `RaceRecord` beyond 10K too — gated on `isManual` rather than excluded outright, since a *manually*-entered PB is still the user vouching for it as a real result. Confirmed via real data: two auto-detected orienteering results ("Åland 2-dagars lång!" → 15K, "Natt SM!" → 10 Mile) fed straight into this function before the `isManual` filter existed, dragging the 15K/Half-Marathon/Marathon predictions far too slow (Half Marathon point estimate moved from 2:08:27 to a much more plausible 1:24:04 after filtering them out — see `docs/planning/IMPLEMENTATION_PLAN.md` 2026-06-25 session entry).

### `criticalSpeedVote(targetM, cs)` — third, physiologically-independent vote

Added 2026-06-24 (follow-up academic-research session — see [RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](../planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md)). `estimateCriticalSpeed()` (`lib/fitness/critical-speed.ts`) fits a 2-parameter hyperbolic Monod-Scherrer model from the same `bestEfforts`+`racePBs` pool, returning `csMetersPerSec`, `wPrimeMeters`, and `rSquared` (goodness of fit). This was already computed and cached for display (`FitnessCache.criticalSpeedMs`/`wPrimeMeters`) but never fed into the race-time blend — it now is, gated by `rSquared` so a poor fit contributes little:

| Target distance | How the vote is computed | Confidence |
|---|---|---|
| ≤ 15,000 m (the model's own fitting range, `CS_VOTE_MAX_DIST_HYPERBOLA`) | Raw hyperbola: `(targetM − wPrimeMeters) / csMetersPerSec` | `rSquared` |
| ≤ 22,000 m (covers the Half Marathon row only) | Published fraction-of-CS: `targetM / (csMetersPerSec × 0.973)` — half-marathoners sustain ~97.3% of CS per a 2024/2025 field-testing systematic review | `rSquared × 0.8` (extra assumption layer beyond the directly-fitted hyperbola) |
| > 22,000 m (Marathon) | No vote on the point estimate — the literature's sustainable-%-of-CS spread is too wide by caliber (elite ~95%, population average ~84.8%) to pick one fraction without evidence; see range-widening below instead | n/a |

The CS vote is folded into the existing local/peak blend by taking its share **out of the "peak" portion** (real personal-anchor evidence in the local model is never displaced by it): `wCS = peakShare × confidence × (bracketed ? 0.3 : 0.6)` — it gets more room when the local model is only a one-sided extrapolation (no real bracket), since that's exactly where an independent cross-check is most valuable.

### Marathon-distance range widening (no point-estimate change)

For the Marathon row specifically, `blendedRacePrediction` computes the literature's elite (0.95×CS) and population-average (0.848×CS) bounds and unions them into `predictionRange()`'s band — widening only, never narrowing, and never touching the point estimate itself (there is no real marathon `RaceRecord` to validate a point-estimate change against for the athlete this was built for).

### Long-run-history confidence (`longRunAdequacyWidenFactor`)

Vickers & Vertosick (2016, BMC, N=2,303) found weekly mileage/long-run history predicts marathon-specific fade independently of any PB-derived exponent. `computeRacePredictions()` takes an optional `longestRunLast8wM` (the longest single run in the last 8 weeks, already cheap to compute alongside the existing `avgWeeklyRunKm` 8-week loop at each call site) and, for the Half Marathon/Marathon rows only, widens the range further when that distance falls well short of the target — e.g. a longest recent run under 30% of the target distance widens the band by 40%; at 80%+ coverage it's a no-op. Like the range-widening above, this only ever affects the uncertainty band, never the point estimate.

### `blendedRacePrediction(targetM, vdot, knownPerformances, fallbackExponent, cs?, longestRunLast8wM?)`

Combines the global Daniels curve ("peak"), the local bracket model, and (within its valid range) the CS vote above, weighted by how well-anchored the target distance is:

| Situation | Weight on local model |
|---|---|
| Bracketed (real results on both sides) | 0.85 |
| Single-sided, ratio ≈ 1 (near-exact match to a real result) | up to 0.95 |
| Single-sided, large extrapolation ratio | decays toward floor 0.15 |
| Predicted duration < 3.5 min (outside Daniels' calibrated range) | forced to ≥ 0.9 regardless of the above |

The blended result also widens `predictionRange()`'s ± band proportionally to `(1 - groundedWeight)`, where `groundedWeight` is the combined local+CS share — a long single-sided extrapolation (e.g. predicting a marathon for a runner whose longest real result is a 10K) gets a wide range instead of a falsely sharp number. A `lowConfidenceShort` flag is set when the predicted duration is under 3.5 minutes, since Daniels' %VO2max-vs-duration table (`percentVO2maxFromDuration`) flatlines below that and was never calibrated for sprint-duration efforts — this is surfaced in the UI as a `*` badge and in the AI coach's summary as an inline caveat.

### `computeRacePredictions(vdot, tsb, racePBs, bestEfforts, longestRunLast8wM?)`

The single canonical entry point — builds `buildKnownPerformances()`, derives the fallback exponent via `personalizedFatigueExponent()`, fits Critical Speed via `estimateCriticalSpeed()`, and maps `blendedRacePrediction()` over every `RACE_DISTANCES` entry. **This must be the only implementation called anywhere `predictionsJson` is built** — see the call-site list below. Previously there were three independently hand-duplicated versions that had already drifted apart in different ways (the "Bug 11/14/15" pattern documented in `IMPLEMENTATION_PLAN.md`, which had previously bitten HR-zone estimation for the same reason).

Returns `{ predictions, criticalSpeed }` — not a bare array — so the Critical Speed fit (and its `rSquared`) can be cached for display without being computed twice.

## 3. Call sites

`computeRacePredictions()` is called identically from:
- `lib/fitness/cache.ts` `updateVO2maxAndPaces()` — AUTO path, runs after every Strava sync. Destructures both `predictions` (→ `predictionsJson`) and `criticalSpeed` (→ `FitnessCache.criticalSpeedMs`/`wPrimeMeters`/`criticalSpeedRSquared`/`criticalSpeedEffortsUsed`) — the only path that persists the CS fit, matching the existing convention that CS/decoupling fields are AUTO-path-only.
- `lib/fitness/cache.ts` `updateHRZones()` — MANUAL path, runs on the "Apply zones" button and on profile save. Uses only `predictions`; recomputes CS in-memory for the blend but doesn't persist it.
- `app/(dashboard)/stats/page.tsx` — SLOW PATH, the cache-miss fallback. Same as above.

All three pass `longestRunLast8wM` from the same 8-week-lookback loop each already runs to compute `avgWeeklyRunKm`.

If you change the model, change it once in `lib/fitness/vo2max.ts` — do not re-derive the logic at any of the three call sites above.

## 4. `FitnessCache.predictionsJson` shape

```text
{ label, meters, peak, today, riegel, rangeLo, rangeHi, lowConfidenceShort }[]
```

- `peak` — the blended estimate (despite the name, no longer the raw global-VDOT-curve number alone since 2026-06-24; it's the primary number shown in the UI and the only one read by the AI coach tool).
- `riegel` — the personalized-local-model-only number (`local.timeSec` from `personalizedRacePrediction`) — unaffected by the CS vote, shown as a secondary comparison column.
- `today` — `peak` adjusted for current TSB via `tsbAdjustedRaceTime()`.
- `rangeLo`/`rangeHi` — the ± confidence band, widened when the prediction leans on a long extrapolation, a marathon-distance literature spread, and/or inadequate recent long-run history.
- `lowConfidenceShort` — true when the predicted duration is under 3.5 minutes.

`FitnessCache.criticalSpeedRSquared`/`criticalSpeedEffortsUsed` (AUTO path only) cache the CS/W′ fit quality — surfaced in the AI coach's `get_fitness_summary` tool alongside the existing `criticalSpeedMs`/`wPrimeMeters` line.
