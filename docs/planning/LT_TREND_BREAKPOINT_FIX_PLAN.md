# LT/AT Rolling Trend — Breakpoint Detection Fix Plan

**Status:** Draft — validated in standalone script against real data, NOT yet implemented in production. One open question below needs the user's input before proceeding.

## Background

After Bug 14/15/16 (combined activities+laps data, OL filter kept race-gated, `updateHRZones()`/`updateVO2maxAndPaces()` unified onto one shared `estimateZonesFromActivities()`), the user pointed out the historical "LT/AT pace development" chart still showed implausible values for older months — e.g. 2021-11 computed as LT2=4:45/km, when the user is confident LT2 hasn't been worse than ~4:10/km since 2021.

## Root cause

`estimateZonesFromStatisticalAnalysis()`'s breakpoint detection (`bp1` = LT2) scans pace buckets from fastest to slowest and picks the first one whose HR-vs-pace slope exceeds 20% of the curve's own max slope — but **deliberately skips bucket index 0** (the fastest bucket) to avoid placing LT2 there when fast-pace data is sparse (a single noisy race lap could otherwise dominate). This heuristic works well for "live" (data-rich, ~7800 points) but fails for sparse historical windows: in 2021-11 (n≈2400), the curve had **two** comparably steep transitions — one at the fastest bucket (4:10→4:30, slope 0.25, real signal, w=36.5) and one further down (4:45→5:05, slope 0.32, the actual max) — and the blind skip-rule always picks the second one, even though the first is better-supported and matches what the user remembers.

This is a property of the core estimator itself, used identically by both the live calibration and the rolling trend — not something the Bug 14/15/16 dataset-construction fix touches.

## Approach validated so far (in `scripts/rolling-lt-test.ts`, against the real local Strava history — 2,023 running activities, 2017–2026)

Per the user's own physiological reasoning: **HR at LT1/LT2 drifts slowly over years even as pace at LT1/LT2 improves with fitness**, and the live (most data-rich) computation is the most trustworthy reference point. Used as a prior to disambiguate sparse historical breakpoints, with three guards:

1. **Pace-drift bound** — for a window `yearsAgo` before now, LT2 pace must fall within `[liveLT2Pace − 5s, liveLT2Pace + maxDrift(yearsAgo)]`, where `maxDrift` is a piecewise-linear fit to the user's own stated bounds (≤10s/km slower at 1yr, ≤25s/km slower at 5yr, with a few seconds of margin). Candidates outside this window are rejected outright — no longer "skip bucket 0 unconditionally," but "skip whichever buckets aren't physiologically plausible for this point in time."
2. **Absolute slope-magnitude floor** (`slopeMax ≥ 0.25`) — rejects months where the curve has no genuinely dominant kink at all (a smooth, ambiguous curve where many transitions pass the *relative* 20%-of-max test only because the curve is flat overall, not because there's a real breakpoint). Calibrated against the live computation (slopeMax≈0.50) and a confirmed-good historical month, 2021-11 (slopeMax≈0.32), vs. a confirmed-ambiguous one (slopeMax≈0.20).
3. **HR sanity check** (unchanged in spirit from before) — final lt1HR/lt2HR must still land within 8bpm of the live anchor.

Any window failing any of these returns `null` — per the user's explicit instruction, a missing month is preferable to a forced wrong one.

### Results after these three guards

| Month | LT2 | LT1 | R² | Note |
|---|---|---|---|---|
| 2021-11 | 4:10/km | 4:56/km | 0.97 | Was 4:45/km before — now matches the user's stated memory |
| 2021-12 | 4:11/km | 4:57/km | 0.98 | |
| 2022-02 | 4:11/km | 4:57/km | 0.96 | |
| 2022-08 | 4:15/km | 5:02/km | 0.98 | |
| 2025-11 | 4:00/km | 4:44/km | 1.00 | |
| 2025-12 | 3:48/km | 4:30/km | 0.99 | |
| 2026-05 | 3:52/km | 4:35/km | 0.99 | |
| 2026-06 (live) | 3:53/km | 4:36/km | 0.99 | anchor — unchanged from current production |

All other months (most of 2022/2023/2024, and most of 2025-01 through 2026-04) currently return null under these guards.

## Open question — needs the user's input before implementing

For several months in the "good data" window the user described (the last ~2 years), e.g. **2025-03** and **2025-04**, the data has a clear, well-supported, high-R² (0.99–1.00) natural breakpoint around **LT2=4:30/km** — consistently, across every algorithm variant tried in this investigation (this isn't an artifact of the new guards; the original unconstrained algorithm found the same 4:30 result). That's **~37s/km slower** than the live anchor (3:53/km), well beyond the user's stated "max ~10s slower a year ago" bound. The new pace-drift guard correctly rejects this as implausible *given that stated bound* — but the underlying data itself is not ambiguous or noisy; it's a clean, confident fit.

Two possibilities:
1. **The user's memory of the drift rate is approximate** and there was a genuine slower period (injury, base-building phase, off-season) around Q1 2025 that they're not recalling precisely — in which case the 4:30 result is *correct* and the drift bound should be loosened (at the cost of being less protective against the kind of misplacement seen in 2021-11).
2. **There's a remaining issue** in how that specific window's dataset is constructed (despite the good R²) that coincidentally produces a plausible-looking but still-wrong fit.

This needs the user's judgment — I can't distinguish between these two from the data alone. Possible resolutions to discuss:
- Loosen the drift bound (e.g. allow more like 20s/km within the first year) and accept that 2021-11-style misplacements might partially return for some other month.
- Keep the strict bound and accept 2025-01–2025-10 showing as gaps in the trend.
- Look at the specific activities driving the 2025-03/04 buckets (training load, any logged illness/injury) to settle which explanation is right.

## What's NOT yet done

- Nothing has been changed in production code (`lib/fitness/zones.ts`, `lib/fitness/cache.ts`) for this specific fix. Only `scripts/rolling-lt-test.ts` (the standalone validation copy) has the new logic.
- Once the open question above is resolved, the plan is:
  1. Add the `anchor` parameter (pace-drift bound + absolute slope floor + HR check) to `estimateZonesFromActivities()` in `lib/fitness/zones.ts`.
  2. In `updateVO2maxAndPaces()`, compute the live result once (asOf=now, full dataset) before the 30-window loop, then pass it as `anchor` to every window except the current one.
  3. `updateHRZones()` doesn't need changes — it's the anchor source, never anchored itself.
  4. Re-verify end-to-end against real local data (same method as Bug 16: run the actual production functions, not just the standalone script).
  5. Document in `IMPLEMENTATION_PLAN.md` and `docs/fitness/hr-zone-statistical-estimation.md`.
  6. User clears `FitnessCache` and re-syncs once more to get a full historical rebuild with the new logic.

## Cleanup done

Temporary debug commands were run via `DEBUG_MONTH=<month>` against `scripts/rolling-lt-test.ts` — no temp files were left behind (output was piped to `/tmp/`, outside the repo). No test users or seeded data remain in the local dev DB beyond the real synced user that was already there before this session.
