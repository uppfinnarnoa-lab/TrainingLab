# Race Time Predictions — Model

> **Purpose**: How `FitnessCache.predictionsJson` (the Stats page "Race Time Predictions" table and the AI coach's `get_fitness_summary` tool) is computed. Implemented 2026-06-24, replacing a single-global-exponent Riegel model — see [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](../planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md) for the original diagnosis and design rationale.

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
- `RaceRecord` PBs — user-confirmed, trusted at **any** distance.
- `Activity.bestEfforts` — trusted only **≤10K**.

**Why `Activity.isRace` is not used to extend trust beyond 10K:** verified against real data that for at least one athlete using this app, `isRace=true` is set exclusively on orienteering events (forest terrain, navigation stops) — *zero* of that athlete's logged road race PBs come from an `isRace`-flagged `Activity`. Orienteering pace at a given distance reflects terrain and navigation, not road race speed, so trusting "race-flagged" segments beyond 10K would feed in misleadingly slow pace data labeled as if it were a fast road effort. `RaceRecord` (a separate, user-confirmed table) doesn't have this problem and remains the only trusted source for long distances.

### `blendedRacePrediction(targetM, vdot, knownPerformances, fallbackExponent)`

Combines the global Daniels curve ("peak") with the local model above, weighted by how well-anchored the target distance is:

| Situation | Weight on local model |
|---|---|
| Bracketed (real results on both sides) | 0.85 |
| Single-sided, ratio ≈ 1 (near-exact match to a real result) | up to 0.95 |
| Single-sided, large extrapolation ratio | decays toward floor 0.15 |
| Predicted duration < 3.5 min (outside Daniels' calibrated range) | forced to ≥ 0.9 regardless of the above |

The blended result also widens `predictionRange()`'s ± band proportionally to `(1 - weight)` — a long single-sided extrapolation (e.g. predicting a marathon for a runner whose longest real result is a 10K) gets a wide range instead of a falsely sharp number. A `lowConfidenceShort` flag is set when the predicted duration is under 3.5 minutes, since Daniels' %VO2max-vs-duration table (`percentVO2maxFromDuration`) flatlines below that and was never calibrated for sprint-duration efforts — this is surfaced in the UI as a `*` badge and in the AI coach's summary as an inline caveat.

### `computeRacePredictions(vdot, tsb, racePBs, bestEfforts)`

The single canonical entry point — builds `buildKnownPerformances()`, derives the fallback exponent via `personalizedFatigueExponent()`, and maps `blendedRacePrediction()` over every `RACE_DISTANCES` entry. **This must be the only implementation called anywhere `predictionsJson` is built** — see the call-site list below. Previously there were three independently hand-duplicated versions that had already drifted apart in different ways (the "Bug 11/14/15" pattern documented in `IMPLEMENTATION_PLAN.md`, which had previously bitten HR-zone estimation for the same reason).

## 3. Call sites

`computeRacePredictions()` is called identically from:
- `lib/fitness/cache.ts` `updateVO2maxAndPaces()` — AUTO path, runs after every Strava sync.
- `lib/fitness/cache.ts` `updateHRZones()` — MANUAL path, runs on the "Apply zones" button and on profile save.
- `app/(dashboard)/stats/page.tsx` — SLOW PATH, the cache-miss fallback.

If you change the model, change it once in `lib/fitness/vo2max.ts` — do not re-derive the logic at any of the three call sites above.

## 4. `FitnessCache.predictionsJson` shape

```
{ label, meters, peak, today, riegel, rangeLo, rangeHi, lowConfidenceShort }[]
```

- `peak` — the blended estimate (despite the name, no longer the raw global-VDOT-curve number alone since 2026-06-24; it's the primary number shown in the UI and the only one read by the AI coach tool).
- `riegel` — the personalized-local-model-only number (`local.timeSec` from `personalizedRacePrediction`), shown as a secondary comparison column.
- `today` — `peak` adjusted for current TSB via `tsbAdjustedRaceTime()`.
- `rangeLo`/`rangeHi` — the ± confidence band, widened when the prediction leans on a long extrapolation.
- `lowConfidenceShort` — true when the predicted duration is under 3.5 minutes.
