# Race Time Predictions — Model

> **Status:** 2026-06-26 — **Implemented and live** in `lib/fitness/vo2max.ts` (+ `critical-speed.ts` for the CS/W′ regression)
> **Function:** `computeRacePredictions()` → `blendedRacePrediction()` per `RACE_DISTANCES` entry
> **Consumers:** Stats page "Race Time Predictions" table (`components/stats/fitness-metrics.tsx`) and the AI coach's `get_fitness_metrics` tool

---

## 1. Core Idea

A population-average curve (Daniels' VDOT table) and a single global Riegel exponent both assume a runner's endurance profile matches "the average runner" through the *entire* distance range. Real runners are spikier than that — strong at one end, comparatively weaker at the other — so a single curve or a single exponent is wrong somewhere for almost everyone.

**The correct approach:** treat every distance's prediction as a blend of independent, physiologically distinct votes, each weighted by how directly it's grounded in *this* runner's own real, verified results — and hard-bound the long end by a measured physiological ceiling no blend should ever be allowed to exceed.

---

## 2. The Four Votes, As Implemented

### 2.1 Daniels population curve (`predictRaceTime(vdot, meters)`)

Binary-searches Daniels' universal %VO2max-vs-duration table for the time matching one blended VDOT number (`estimateVO2max()` — 7+ sub-models, race PBs weighted with age-decay, HR-form drift, volume-adjusted Riegel, etc.). Accurate near whatever distances dominate that VDOT's own calibration data; has no way to know if this runner's profile deviates from average elsewhere. Always available (every other vote can be `null`); the fallback of last resort.

### 2.2 Local bracket/Riegel model (`personalizedRacePrediction()`)

Finds the runner's own real results bracketing the target distance:

- **Two real results on the same side of the ~800m anaerobic/aerobic regime boundary** (Péronnet & Thibault, 1989 — aerobic energy share passes 50% at ~100s/~800m), far enough apart to avoid amplifying noise (`ratio ≥ 1.02`): fits a *local* Riegel exponent between just those two points, clamped to `[0.95, 1.25]`.
- **Bracket spans the 800m boundary, or only one side has data:** falls back to a personalized global exponent (`personalizedFatigueExponent()`, log-log fit over 1000–10000m bestEfforts) — or a literature short-regime exponent (1.04) when the single anchor itself is sub-800m.
- **No real results near the target at all:** `null`.

Real evidence pool — `buildKnownPerformances(racePBs, bestEfforts, lowerTierCandidates?)`, three tiers, gap-fill only (a lower tier never overrides a higher one, and is excluded entirely within 1.5× ratio of an already-trusted point — see §3.3):

1. **`RaceRecord` PBs** (≥200m; `isManual` required beyond 10K) — see §2.4 for the split-detection that gates this tier.
2. **`Activity.bestEfforts`** (1000–10000m only — beyond that, a segment is essentially never a genuine maximal flat-road effort).
3. **Tempo-run anchors** (`extractTempoRunAnchors()`) and **interval-lap anchors** (`extractIntervalLapCandidates()`) — see §2.5.

### 2.3 Critical Speed/W′ vote (`criticalSpeedVote()`, ≤15000m) and LT2-anchored vote (`thresholdAnchoredVote()`, ≥21097m)

`estimateCriticalSpeed()` fits a 2-parameter hyperbolic Monod-Scherrer model from the same bestEfforts+racePBs pool — a physiologically distinct signal from the log-log Riegel exponent. Valid range ~2–25 minutes (Running Writings, 2024): overestimates short sprints (no force-velocity limit) and wrongly implies "infinite endurance" just below CS for long efforts, so it only votes for `targetM ≤ 15000` (its own fitted range).

For `targetM ≥ 21097` (Half Marathon, Marathon — beyond LT2/MLSS's ~30–60min sustainability window, where running at-or-above-threshold-pace stops being physiologically normal), `pickThresholdSource()` prefers `FitnessCache.statZonesJson`'s LT2 pace (a statistical breakpoint analysis of training pace/HR data, **independent of race PBs**) over CS pace whenever its `rSquared ≥ 0.7` — frequently the better-fit estimate (see §3.1). `thresholdAnchoredVote()` then computes `targetPace = thresholdPace / sustainFraction(targetM)`.

`sustainFraction(targetM, longestRunLast8wM)`: literature base (HM ≈ 0.973, Marathon ≈ 0.848 — population-average, not elite) plus a small (±0.04 max) nudge from recent long-run coverage of the target distance (Vickers & Vertosick, 2016, BMC, N=2,303: long-run history predicts marathon-specific fade independently of any PB-derived exponent).

### 2.4 Mid-race-split detection (`buildTrustedRacePBs()`)

A logged "PB" can be a checkpoint time inside a *longer* race, not an independent maximal effort at its own distance — verified concretely: a 3000m "PB" that shared its `stravaActivityId` with a 10000m PB from the same activity, with pace *increasing* steadily from the 3K mark to the finish (the signature of 10K pacing, not an all-out 3K). `RaceRecord` rows are grouped by `stravaActivityId`; within a group, an entry is kept only if its ratio to the group's longest distance is **≤ 1.8** — close enough that even fully-conservative pacing implies only a minor (Riegel-estimated ~3–4%) distortion (e.g. a 3K split inside a 5K race, ratio 1.67 — kept), while a split from a much longer race (e.g. a 5K split inside a 10K, ratio 2.0 — measured to add **zero** new information beyond the 10K's own average pace) is excluded.

### 2.5 Tempo-run and interval-lap anchors

Two lower-confidence tiers feed `buildKnownPerformances()`'s gap-fill-only third tier:

- **`extractTempoRunAnchors()`** — `vo2maxFromSubmaxEffort()` (Åstrand-Ryhming-style submax HR/pace extrapolation) converts the **single best** qualifying tempo run (HR 82–92% maxHR, 10000–25000m, ≥40min) into one equivalent maximal-effort anchor via `predictRaceTime()`. Deliberately one point, not a per-distance sweep — several independently-estimated submax points (each ~10-15% SEE) can form a tight, falsely-confident bracket *with each other* instead of with real data.
- **`extractIntervalLapCandidates()`** — mines `Activity.laps` for the single fastest qualifying lap per interval-named session (300–2000m, ≥40s, faster than a hard plausibility floor of 135 s/km to reject GPS/lap-button noise, faster than 92% of the session's own median pace, implied VDOT ≥40 as a sanity backstop).

---

## 3. Why Specific Fixes Were Needed

### 3.1 The marathon point estimate could imply exceeding this athlete's own measured threshold pace

Verified against real data: a 38:41 10K runner's blended Marathon estimate implied **98.6–99.5% of their own statistically-estimated LT2 pace held for the full 42.195km** — physiologically impossible at any caliber (elite ceiling ~95%). Half Marathon checked out fine (97.5%, matching the literature's ~97.3% almost exactly) — the gap was specifically Marathon, which previously had **no point-estimate vote at all**, only range-widening.

Root cause: the CS/W′ regression (R²=0.582 for this athlete) is meaningfully less reliable than the independent statistical LT2 estimate (R²=0.99) — the CS regression's 10–15K input range was contaminated by deliberately submaximal threshold sessions (named "LT!" — i.e. genuinely controlled, sub-maximal lactate-threshold work, not max effort), the same contamination class already excluded from the bracket model beyond 10K but never applied to the CS fit's own `bestEfforts` cap (now aligned: `estimateCriticalSpeed()`'s bestEfforts cap lowered from 15000m to 10000m to match).

**Fix:** §2.3's hard ceiling — after the full blend, the result is clamped up to `thresholdCeilingTimeSec()` if it would otherwise be faster. The range's lower bound is clamped identically.

### 3.2 TSB was applied twice in the same direction

`estimateVO2max()` used to include `model7Vdot = tsbAdjustedVdot(model1Vdot, tsb)` in its weighted blend (the basis for the base VDOT), and `tsbAdjustedRaceTime()` separately adjusted the "Today" column from that already-TSB-shifted base — compounding at extreme TSB values. Removed entirely from the blend; `estimateVO2max()` no longer takes a `tsb` parameter. `tsbAdjustedRaceTime()` (the "Today" column) is now the only place TSB has any effect anywhere in this pipeline.

### 3.3 Two new evidence tiers were found broken by real-data validation, and fixed before shipping

Both §2.5 tiers were *not* shipped as first designed — a first real-data validation run produced dramatically worse predictions (800m regressed from 2:38 to 3:24; 15K from ~59min to 1:16) before the current, tighter form was reached:

- **GPS/lap-button noise:** a 631m "lap" timed at 33s (implying 68 km/h) passed the original session-median-relative filter, because noise can land on either side of a session's own median pace. Fixed with the absolute pace-plausibility floor (§2.5).
- **Over-dense bucketing formed false brackets:** the first version of `extractTempoRunAnchors()` produced up to 17 estimated points spanning 3000–20000m (one per 1000m bucket); several of these, each carrying its own ~10-15% uncertainty, landed close enough together to bracket *each other* into a falsely-precise interpolation. Fixed by returning a single best anchor only.
- **Density beat proximity over confidence:** `personalizedRacePrediction()`'s nearest-point bracket selection has no way to weigh source confidence — a mediocre lower-tier estimate landing closer to a target than a high-confidence trusted PB would simply win on proximity. Fixed by excluding any lower-tier candidate within 1.5× ratio of an already-trusted distance (§2.2).

### 3.4 A correctly-fixed contamination revealed a *different*, smaller real bug — recency

§2.4's split-detection correctly excluded a fresh-but-contaminated 3000m split, but the binary "keep only the group's longest" rule was blunter than necessary: a split from a race only modestly longer (e.g. 3K inside a 5K, ratio 1.67) carries far less pacing distortion than one from a much longer race (3K inside a 10K, ratio 3.33) — confirmed by computing the Riegel-implied pacing gap at each ratio (~3-4% vs ~7-9%) and by direct measurement (a 5K-inside-10K split's pace matched the 10K's own Riegel-predicted halfway pace almost exactly — zero new information). The ratio-bounded keep rule (§2.4) replaced the binary one, recovering a materially fresher *and* faster anchor (a 2026 result instead of a 2021 one) for the same distance.

---

## 4. Call Sites

`computeRacePredictions(vdot, tsb, racePBs, bestEfforts, longestRunLast8wM?, lt2?, lowerTierCandidates?)` is the single canonical entry point, called identically from three places — **if you change the model, change it once here; never re-derive the logic at a call site** (see "Bug 11/14/15" in `IMPLEMENTATION_PLAN.md` for what happened the last time this wasn't followed):

- `lib/fitness/cache.ts` `updateVO2maxAndPaces()` — AUTO path, every Strava sync (fire-and-forget background job). `lt2` reads the **existing cached** `statZonesJson` (calibration-only field, never recomputed here).
- `lib/fitness/cache.ts` `updateHRZones()` — MANUAL path, the "Apply zones" button (awaited/synchronous). `lt2` uses the **freshly-computed** `statResult` from this same call.
- `app/(dashboard)/stats/page.tsx` — SLOW PATH, cache-miss fallback. Same `lt2` source as AUTO path.

All three build `lowerTierCandidates` by merging `extractTempoRunAnchors()` + `extractIntervalLapCandidates()` over their own already-loaded activities, and call `buildTrustedRacePBs()` (never a hand-rolled isManual/stravaActivityId filter) for `racePBs`.

**`FitnessCache.predictionsJson` shape:** `{ label, meters, peak, today, riegel, rangeLo, rangeHi, lowConfidenceShort, models }[]` — `models: Record<string, number>` (added 2026-06-26) holds every individual vote's own time at that distance (`"Daniels (population)"`, `"Riegel (your PBs)"`, `"Critical Speed / Threshold"`), feeding the Stats page's "Compare against" selector. Optional in the TypeScript shape — a `FitnessCache` row computed before this field existed has none until its next sync/calibration; the UI falls back to the always-present `riegel` field for the default selection rather than rendering blank.

---

## 5. Confidence and Known Limitations

**High confidence:** any distance within or adjacent to this runner's own race-confirmed range (currently roughly 400m–10K for the reference athlete) — the bracket model echoes real, verified results almost exactly there, by design.

**Medium confidence:** Half Marathon, and Marathon specifically because of the LT2 hard ceiling (§3.1) — bounded by a real physiological measurement even when the local bracket extrapolation alone would have been unbounded.

**Known, accepted limitation — recency in the bracket model:** `buildKnownPerformances()`/`personalizedRacePrediction()` have no general concept of *when* a known performance was set. §2.4's ratio-bounded split rule incidentally improves recency too (a fresher in-range split can now compete with — and beat — a stale standalone PB at the same distance), but this is a side effect, not a designed mechanism. A distance whose only available evidence (after all the tiers above) happens to be old will still use it as confidently as if it were from last week. Tested and explicitly *not* fixed in this round with a general recency-preference mechanism (`preferFreshSince` filtering, `verifiedClean`/`date` fields on `KnownPerformance`) — see [docs/planning/Planerattköra/RACE_ESTIMATE_RECENCY_WEIGHTING_PLAN_2026_06_26.md](../planning/Planerattköra/RACE_ESTIMATE_RECENCY_WEIGHTING_PLAN_2026_06_26.md) for the researched-but-not-yet-implemented general fix, and for why a naive "prefer freshest" rule isn't safe on its own (it can resurface exactly the kind of mid-race-split contamination §2.4 already excludes, via `Activity.bestEfforts`, which doesn't yet have the same ratio-based protection `RaceRecord` does).

**Known, accepted limitation — single-user calibration:** every threshold (the 1.8 ratio cutoff, the 0.7 LT2 R² gate, the 1.5 lower-tier exclusion ratio, the 135 s/km noise floor) was calibrated and validated against one real athlete's data. They're reasoned from first principles (Riegel-implied pacing gaps, physical speed limits) where possible, not arbitrary, but a structurally different second user (e.g. far sparser PB coverage, or a different specialization profile) would need the same real-data validation pass repeated before trusting the same constants.

---

## 6. Standalone Validation Scripts

None are kept in the repo long-term — every validation pass in this model's history has used a throwaway script (`scripts/_tmp_*.ts`, written, run against real local dev data, then deleted) rather than a committed test harness, because the validation target each time was "does this match one specific real athlete's actual results," not a general regression suite. Recreate the pattern as needed: load `RaceRecord`/`Activity` for the test user, call `buildTrustedRacePBs()`/`buildKnownPerformances()`/`computeRacePredictions()` directly, and compare against known real PBs.

---

*Last updated: 2026-06-26 (full rewrite into this reference format — LT2-anchored hard ceiling for HM/Marathon replacing the old fixed-fraction-of-CS vote; mid-race-split detection via stravaActivityId grouping, later refined from a binary "keep longest" rule to a ratio-bounded one after real-data validation showed the binary rule discarded a usefully-close, fresher split along with the genuinely contaminated ones; two new lower-confidence evidence tiers, each found broken by real-data validation and fixed before shipping; TSB double-counting removed; UI model selector reworked to swap one column instead of hiding the composite/Today columns, with a graceful fallback for pre-migration cache rows. Previous version (2026-06-24/2026-06-25 history) consolidated into §3's "why" narrative rather than kept as a chronological log — see `docs/planning/archive/` for the full session-by-session history if needed.)*
