# Race Time Predictions — Model

> **Purpose**: How `FitnessCache.predictionsJson` (the Stats page "Race Time Predictions" table and the AI coach's `get_fitness_summary` tool) is computed. Implemented 2026-06-24, replacing a single-global-exponent Riegel model — see [docs/planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md](../planning/archive/RACE_ESTIMATE_PERSONALIZATION_PLAN_2026_06_23.md) for the original diagnosis and design rationale. Extended 2026-06-24 (same day, follow-up session) to wire in a Critical Speed/W′ vote and long-run-history confidence signal — see [docs/planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md](../planning/archive/RACE_ESTIMATE_ACADEMIC_RESEARCH_PLAN_2026_06_24.md). Substantially extended again 2026-06-26 — LT2-anchored ceiling for HM/Marathon, mid-race-split detection, tempo-run and interval-lap anchors, UI model selector — see [docs/planning/archive/RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md](../planning/archive/RACE_ESTIMATE_TRAINING_DATA_PLAN_2026_06_26.md).

---

## 1. The problem this replaced

Two models used to run in parallel:

1. **"Peak"** — `predictRaceTime(vdot, meters)`: binary-searches Daniels' universal %VO2max-vs-duration table for the time matching one blended VDOT number. Accurate near the distances that dominate that VDOT's own calibration data (for most runners, 1K–5K), but a population-average curve — it has no way to know if a specific runner's endurance profile deviates from average at longer durations.
2. **"Riegel"** — `riegelPredict(t1, d1, d2, exponent)` with `exponent` from `personalizedFatigueExponent()`: fit ONE log-log slope across every `bestEffort` from 1000m to 42195m, then extrapolated that single exponent from one fixed anchor (the PB with the highest implied VDOT — often a Mile) across the entire distance range.

For a runner with a "spikier" profile (strong short, weaker relative long endurance), this produced exactly the complaint: "short a little too slow, long way too fast" for Peak, and an even worse over-correction for Riegel (predicted 10K times +17–30% too slow) — because the regression mixed two different effort regimes (anaerobic/VO2max-dominant short efforts vs. submaximal long-run segments) into one straight line.

## 2. The bracket/blend model (2026-06-24)

### `personalizedFatigueExponent(bestEfforts)`

Log-log regression of pace vs. distance, capped at 10K — beyond 10K, a `bestEffort` segment is essentially never a genuine maximal flat-road effort (see §3 of the 2026-06-23 plan). Falls back to standard Riegel (1.06) if fewer than 3 distinct distances survive the filter.

### `personalizedRacePrediction(targetM, knownPerformances, fallbackExponent)`

Instead of one global exponent extrapolated from one fixed anchor, finds the runner's own real results bracketing `targetM`:

- **Two real results bracketing the target, on the same side of the anaerobic/aerobic regime boundary** (800m — see §4 below) **and far enough apart to avoid amplifying noise into a wild slope**: fits a *local* Riegel exponent between just those two points, clamped to `[0.95, 1.25]`. A bracket straddling 800m (e.g. a 400m anchor paired with a 5000m anchor) is deliberately **not** treated as a stable interpolation — see §4.
- **Only one side has data** (extrapolation): falls back to `fallbackExponent` (the personalized global exponent, or standard 1.06) — or, when the single anchor itself is under 800m, a literature-based short-regime exponent (1.04) instead, since `fallbackExponent` is fit entirely from 1000m+ data and isn't representative of anaerobic-dominated fatigue. Returns `bracketed: false`.
- **No real results at all**: returns `null`.

### `buildKnownPerformances(racePBs, bestEfforts, lowerTierCandidates?)`

Merges three tiers into one deduplicated set, keyed by rounded distance:

1. **`RaceRecord` PBs** — trusted at **any** distance ≥200m (lowered from 1000m 2026-06-26, see §4) only when `isManual: true` beyond 10K, **and** only the result is the single longest distance among any group sharing the same `stravaActivityId` (see §5 — `buildTrustedRacePBs()`).
2. **`Activity.bestEfforts`** — trusted only in **1000m–10000m**.
3. **Lower-tier candidates** (optional, §6/§7) — tempo-run and interval-lap-derived estimates. Gap-fill only: never compete with tiers 1–2, and excluded entirely from any distance within 1.5× (ratio) of an existing trusted point, since a nearby-but-lower-confidence estimate would otherwise out-compete a closer, higher-quality trusted anchor purely on proximity (verified necessary against real data — see §7).

**Why `Activity.isRace` is not used to extend trust beyond 10K:** verified against real data that for this app's primary athlete, `isRace=true` is set exclusively on orienteering events — terrain/navigation pace, not road pace.

## 3. Critical Speed/W′ vote, marathon range-widening, long-run adequacy (2026-06-24, follow-up session)

`estimateCriticalSpeed()` (`lib/fitness/critical-speed.ts`) fits a 2-parameter hyperbolic Monod-Scherrer model, returning `csMetersPerSec`, `wPrimeMeters`, `rSquared`. `criticalSpeedVote(targetM, cs)` votes the raw hyperbola for `targetM ≤ 15000` (its own fitted range); beyond that, see §6 below (2026-06-26 revision — the half-marathon fixed-fraction branch this function used to have was replaced by the LT2-anchored mechanism).

`longRunAdequacyWidenFactor(longestRunLast8wM, targetM)` (Vickers & Vertosick, 2016, BMC, N=2,303) widens the HM/Marathon **range** when recent long-run history falls short of the target distance — still range-only as of 2026-06-26 (§7's `sustainFraction` is the mechanism that now shifts the point estimate itself).

## 4. Regime-aware short-distance bracketing (2026-06-26)

`buildKnownPerformances()`'s `racePBs` floor was lowered from 1000m to 200m so a genuine sub-1000m PB (e.g. a 400m) can inform short-distance predictions — previously the strongest available evidence of anaerobic speed reserve was thrown away entirely. `bestEfforts` keeps its 1000m floor (sub-1000m segments pulled from inside a longer activity are noisier than a logged PB).

Letting a sub-800m anchor bracket directly against a 1000m+ anchor would fit one exponent across two different physiological regimes (Péronnet & Thibault, 1989: aerobic energy share passes 50% at ~100s/~800m) — the same regime-mixing problem the whole bracket model exists to avoid. `personalizedRacePrediction()` now checks `spansRegimeBoundary(below, above)` (800m) before treating a pair as a stable bracket; a regime-spanning pair falls back to single-anchor extrapolation instead, using a literature short-regime exponent (1.04) when that anchor is itself sub-800m.

## 5. Mid-race-split detection — `buildTrustedRacePBs()` (2026-06-26)

Verified against real data: every manually-entered 3000m "PB" in one athlete's dataset shared its `stravaActivityId` with a longer-distance entry from the same activity (e.g. a 3K/5K/10K trio all from one 10K race, with pace *increasing* steadily from the 3K mark to the finish — the signature of 10K pacing, not a standalone 3K effort). `RaceRecord` rows are grouped by `stravaActivityId`; within a group spanning multiple distances, only the **longest** is kept as a genuine result at its own target distance — shorter ones are mid-race checkpoints, not independent maximal efforts, and are dropped entirely (not just down-weighted — the blend already degrades gracefully to the population curve/CS vote when a distance has no trusted anchor).

`lib/fitness/cache.ts::loadRacePBs()` and the equivalent block in `app/(dashboard)/stats/page.tsx` both call this same function — see `vo2max.ts`'s `RaceRecordForTrust` type.

**Known trade-off, observed in practice:** removing a contaminated-but-recent split can leave only an older, slower-but-genuine PB as a distance's sole trusted anchor (e.g. this athlete's only clean standalone 3K result is from 2021, after the 2026 3K "PB" was correctly identified as a 10K-race split) — predictions at that distance then reflect the stale PB rather than current fitness. This is the intended, conservative trade-off (an honest stale number beats a contaminated fresh one) but is a real limitation: the bracket model has no concept of recency weighting. Not fixed in this round — flagged for a future pass if it recurs.

## 6. LT2-anchored ceiling for Half Marathon/Marathon (2026-06-26)

**The core fix.** Verified against real data: a 38:41 10K runner's blended Marathon point estimate implied **98.6–99.5% of their own statistically-estimated LT2 pace sustained for the full 42.195km** — physiologically impossible at any caliber (literature ceiling for elite marathoners is ~95% of an equivalent threshold speed). Half Marathon, by contrast, checked out fine (97.5%, matching the literature's ~97.3% almost exactly) — the bug was specifically a Marathon-distance gap: nothing previously constrained the point estimate to respect this athlete's own measured aerobic ceiling.

`FitnessCache.statZonesJson` (`lib/fitness/zones.ts`'s `estimateZonesFromActivities()` — a statistical breakpoint analysis of training pace/HR data, completely independent of race PBs) already estimates `lt2PaceSecPerKm` with its own `rSquared`. This is frequently a **more reliable** threshold estimate than the CS/W′ regression (verified: for this athlete, statZones R²=0.99 vs. CS R²=0.582 — the CS regression's 10–15K input range was contaminated by deliberately submaximal "LT!" sessions, see §8) but was never read by the race predictor at all.

`pickThresholdSource(lt2, cs)` now prefers `statZonesJson`'s LT2 pace when its `rSquared ≥ 0.7` (`LT2_VOTE_MIN_RSQUARED`), falling back to CS pace otherwise. Applies **only for targetM ≥ 21097m (Half Marathon and beyond)** — below that, running at or above LT2 pace is physiologically normal (LT2/MLSS sustainability is roughly 30–60 min, which covers 10K and usually 15K for this kind of runner; constraining shorter distances against it would be wrong).

- **Vote**: `thresholdAnchoredVote()` computes `targetPace = thresholdPace / sustainFraction(targetM)` and folds it into the blend exactly where `criticalSpeedVote` used to vote for HM (≤22000m) — `criticalSpeedVote` itself no longer has a fraction-of-CS branch beyond 15000m; this supersedes it for HM and, new in this round, **also votes for Marathon**, which previously had no point-estimate vote of any kind beyond range-widening.
- **Hard ceiling**: after the full blend, `thresholdCeilingTimeSec()` is recomputed and the blended time is clamped up to it if the blend would otherwise be faster — i.e. the point estimate can never imply exceeding this athlete's own measured/estimated threshold-sustainable pace for that duration, regardless of what every other component of the blend produced. `predictionRange()`'s `rangeLo` is clamped to the same floor.
- Where `statZonesJson` is `null` or has insufficient `rSquared` (new users, sparse data), `pickThresholdSource()` falls back to CS pace; if CS is also unavailable, the vote/ceiling are skipped entirely (`null`) and behavior degrades to the pre-2026-06-26 blend.

## 7. Personalized sustain fraction (2026-06-26)

`sustainFraction(targetM, longestRunLast8wM)` replaces the single fixed `HM_CS_FRACTION` constant with a distance-tiered literature base (HM ≈ 0.973, Marathon ≈ 0.848 — population-average, not elite, matching this kind of athlete's profile per the 2026-06-23 diagnosis) plus a small (`MAX_PERSONAL_SUSTAIN_ADJUSTMENT = ±0.04`) nudge from `personalSustainAdjustment()`: good longest-recent-run coverage of the target distance (≥70%) nudges the sustainable fraction up; poor coverage (≤25%) nudges it down. Same Vickers & Vertosick (2016) evidence `longRunAdequacyWidenFactor` already used for range-widening, now also informing the point estimate itself — capped small so it can only fine-tune the literature base, never dominate it.

## 8. Shared bestEffort trust window for Critical Speed (2026-06-26)

`estimateCriticalSpeed()`'s `bestEfforts` cap was lowered from 15000m to 10000m (`BESTEFFORT_MAX_DIST`), matching the cap `buildKnownPerformances()`/`personalizedFatigueExponent()` already use — `racePBs` keep a separate, wider 15000m cap (`RACEPB_MAX_DIST`), since they're already gated to `isManual`-only beyond 10K upstream. Verified necessary: when the bestEffort cap was 15000m, the only "fastest available" 10–15K segments for this athlete turned out to be deliberately submaximal "LT!" threshold sessions, not maximal efforts — the same contamination class BUG_AUDIT_2026_06_25 had already excluded from `RaceRecord`, one level deeper. Confirmed this degraded the CS fit's own R² relative to the independent `statZonesJson` estimate (§6).

## 9. Tempo-run and interval-lap anchors (2026-06-26)

Two new lower-priority tiers feed `buildKnownPerformances()`'s `lowerTierCandidates` parameter — both gap-fill only (§2, tier 3) and were tuned twice after initial real-data validation surfaced concrete problems (documented below, not just designed-then-shipped):

### `extractTempoRunAnchors(runs, maxHR)`

`vo2maxFromSubmaxEffort()` already existed (Åstrand-Ryhming-style submax HR/pace extrapolation) but was never called anywhere. Converts the **single best** qualifying tempo/threshold run (HR 82–92% maxHR, distance 10000–25000m, duration ≥40min, not interval/race-named) into one equivalent maximal-effort anchor at its own distance via `predictRaceTime(vEst, distanceM)`.

**Deliberately returns at most one point, not a per-distance-bucket sweep.** An earlier version bucketed every qualifying run into its own ~1000m bucket (producing up to 17 estimated points spanning 3000–20000m) — verified against real data that several independently-estimated submax points, each already carrying ~10-15% uncertainty, land close enough together to form a tight, falsely-confident bracket *with each other* (one such bracket alone moved the 15K prediction from a sane ~59min to 1:15min). A single anchor can only ever extrapolate, never form a misleadingly precise interpolation out of two unreliable estimates.

### `extractIntervalLapCandidates(activities)`

Mines `Activity.laps` (synced from Strava, previously unused for race prediction) for interval-named sessions, extracting genuine fast work-rep evidence that `isQualitySession()`/`looksLikeIntervals()` correctly exclude from whole-activity pace analysis (diluted by recovery jogs) but that nothing previously rescued at the per-lap level.

Tuned twice after real-data validation:

1. **GPS/lap-noise floor**: laps faster than `MIN_PLAUSIBLE_PACE_SEC_PER_KM` (135 s/km, ~7.4 m/s) are rejected outright — verified necessary: a 631m "lap" timed at 33s (implying 68 km/h) passed the original session-median-relative filter because GPS/lap-button noise can land on either side of a session's own median pace.
2. **One candidate per session, not per lap**: keeps only the single fastest qualifying lap per activity (plus a `MIN_PLAUSIBLE_VDOT_FOR_INTERVAL_REP = 40` floor via `vdotFromRace` as a backstop). An earlier version kept every lap beating 92% of its session's median pace, producing ~250 candidates densely clustered 300–1300m with individual quality varying by 20+ implied VDOT points — `buildKnownPerformances()`'s nearest-point bracket selection has no way to weigh source confidence, so this density actively out-competed a much more relevant, only slightly farther, high-confidence trusted PB (e.g. a nearby 791m interval-lap estimate beat a 400m race PB for an 800m target purely on proximity, dragging the 800m prediction from ~2:38 to ~3:24).

## 10. `blendedRacePrediction(targetM, vdot, knownPerformances, fallbackExponent, cs?, longestRunLast8wM?, lt2?)`

Combines the global Daniels curve (`danielsRaw` — renamed from the old, confusingly-overloaded local variable `peak`), the local bracket model, and a single physiological vote (`criticalSpeedVote` ≤15000m, or `thresholdAnchoredVote` ≥21097m — §6; nothing votes in the 15000–21097m gap, matching pre-2026-06-26 behavior), weighted by how well-anchored the target distance is:

| Situation | Weight on local model |
|---|---|
| Bracketed (real results on both sides) | 0.85 |
| Single-sided, ratio ≈ 1 (near-exact match to a real result) | up to 0.95 |
| Single-sided, large extrapolation ratio | decays toward floor 0.15 |
| Predicted duration < 3.5 min (outside Daniels' calibrated range) | forced to ≥ 0.9 regardless of the above |

After the weighted blend, the §6 hard ceiling is applied (HM/Marathon only). The blended result also widens `predictionRange()`'s ± band proportionally to `(1 - groundedWeight)`. A `lowConfidenceShort` flag is set when the predicted duration is under 3.5 minutes.

Also returns `models: Record<string, number>` — every individual component's own time estimate at this distance (`"Daniels (population)"`, `"Riegel (your PBs)"` when a local prediction exists, `"Critical Speed / Threshold"` when a vote exists) — see §11.

## 11. TSB no longer double-counted (2026-06-26)

`estimateVO2max()` used to include a `model7Vdot = tsbAdjustedVdot(model1Vdot, tsb)` entry in its weighted blend (the basis for `vdot`/"peak"), and `computeRacePredictions()` separately applied `tsbAdjustedRaceTime(peak, tsb)` for the "Today" column — i.e. TSB shifted the result twice, in the same direction, compounding at extreme TSB values. `estimateVO2max()` no longer takes a `tsb` parameter or computes `model7Vdot` at all; "peak"/the base VDOT blend is now TSB-neutral, and `tsbAdjustedRaceTime()` (the "Today" column) is the only place TSB has any effect.

## 12. UI model selector (2026-06-26)

The Stats page's Race Time Predictions table is now **Distance | [Model ▾] | Estimate (personalized) | Today (TSB)** — the composite ("Estimate") and TSB-adjusted ("Today") columns always show regardless of selection; the dropdown (default: "Riegel (your PBs)") only ever changes the leftmost data column, reading from each row's `models` map. This replaced an older selector (population-VDOT-breakdown buttons, e.g. "HR-form signal"/"Volume-Adjusted Riegel" run through a bare `predictRaceTime()` with no bracket/CS/LT2 logic at all) that, when a non-default model was picked, hid the composite and Today columns entirely instead of just swapping one column — `lib/fitness/cache.ts`'s `predictionsJson` is the only source for the new selector's options, so it always reflects exactly the same model family the blend itself uses.

## 13. Call sites

`computeRacePredictions(vdot, tsb, racePBs, bestEfforts, longestRunLast8wM?, lt2?, lowerTierCandidates?)` is called identically from:

- `lib/fitness/cache.ts` `updateVO2maxAndPaces()` — AUTO path, runs after every Strava sync. `lt2` is read from the **existing cached** `statZonesJson` (never recomputed here — that field is calibration-only, see its own doc comment) for `lt2`/`lowerTierCandidates`, built from the same `activities`/`laps` already loaded for this call. Destructures both `predictions` (→ `predictionsJson`) and `criticalSpeed` (→ `FitnessCache.criticalSpeedMs`/etc.) — the only path that persists the CS fit.
- `lib/fitness/cache.ts` `updateHRZones()` — MANUAL path, runs on the "Apply zones" button. Uses the **freshly-computed** `statResult` from this same call (more current than the AUTO path's cached read) for `lt2`.
- `app/(dashboard)/stats/page.tsx` — SLOW PATH, the cache-miss fallback. Same as AUTO path's `lt2` source (reads `fitnessCache.statZonesJson`).

All three pass `longestRunLast8wM` from the same 8-week-lookback loop each already runs to compute `avgWeeklyRunKm`, and build `lowerTierCandidates` by merging `extractTempoRunAnchors()` + `extractIntervalLapCandidates()` over their own already-loaded running activities.

`loadRacePBs()` (cache.ts) and the equivalent inline block in `stats/page.tsx` both call `buildTrustedRacePBs()` (§5) — never hand-roll the isManual/stravaActivityId filter independently.

If you change the model, change it once in `lib/fitness/vo2max.ts` (or `critical-speed.ts` for the CS regression itself) — do not re-derive the logic at any of the three call sites above.

## 14. `FitnessCache.predictionsJson` shape

```text
{ label, meters, peak, today, riegel, rangeLo, rangeHi, lowConfidenceShort, models }[]
```

- `peak` — the blended estimate (despite the name, the primary number shown in the UI and the only one read by the AI coach tool).
- `riegel` — the personalized-local-model-only number (`local.timeSec` from `personalizedRacePrediction`), shown as a secondary comparison column — **not** subject to the §6 hard ceiling (only the primary `peak` is).
- `today` — `peak` adjusted for current TSB via `tsbAdjustedRaceTime()` — the only TSB effect anywhere in this pipeline (§11).
- `rangeLo`/`rangeHi` — the ± confidence band; for HM/Marathon, `rangeLo` is clamped to the same §6 hard ceiling as `peak`.
- `lowConfidenceShort` — true when the predicted duration is under 3.5 minutes.
- `models` — every individual component's own estimate at this distance (§10), keyed by display name — feeds the UI model selector (§12). Optional in the TypeScript shape (older cached rows from before 2026-06-26 won't have it until their next sync/calibration).

`FitnessCache.criticalSpeedRSquared`/`criticalSpeedEffortsUsed` (AUTO path only) cache the CS/W′ fit quality — surfaced in the AI coach's `get_fitness_summary` tool alongside the existing `criticalSpeedMs`/`wPrimeMeters` line. `FitnessCache.statZonesJson` (calibration-only, written by `updateHRZones()`) is the source of the §6 LT2 anchor for all three call sites.
