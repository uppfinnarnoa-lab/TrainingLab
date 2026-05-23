# TrainingLab — Bug Fixes, Volume-Adjusted Riegel Model & Pace Zones Prompt for Claude Code

You are Claude Code, an agentic developer assistant. Your task is to implement a new volume-adjusted race prediction model, fysiologiskt förankra tempozonerna, fix critical bugs in the PB tracker/stats, and verify the build.

Read `CLAUDE.md` at the root of the workspace first for commands (build, run dev server, etc.) and codebase rules.

---

## Part 1 — New Feature: Volume-Adjusted Race Predictions (Alex Gascón Model)

Based on the article *"I Was Tired of Flawed Race Predictions, So I Built a Model That Actually Understands Runners"* (which critiques fixed-exponent calculators like standard Riegel):

1.  **Calculate Weekly Volume**: In `app/(dashboard)/stats/page.tsx` (both fast and slow paths), calculate the runner's average weekly running volume (in km) over the last 8 weeks.
2.  **Dynamic Exponent**: Implement a volume-adjusted Riegel exponent:
    $$d = 1.18 - (0.0015 \times \text{AvgWeeklyRunningVolumeKm})$$
    Clamp $d$ between $1.05$ (elite/highly-trained) and $1.18$ (beginner/untrained).
3.  **Predict Times**: Predict race times for standard distances using:
    $$T_2 = T_1 \times \left( \frac{D_2}{D_1} \right)^d$$
    Where $T_1$ and $D_1$ are the runner's best anchor PB (closest available distance).
4.  **Register Model**:
    *   Add this model as `"Volume-Adjusted Riegel"` in the predictions dropdown in `components/stats/fitness-metrics.tsx`.
    *   Include its predictions alongside the existing default weighted model and other models.
    *   Ensure when chosen in the dropdown, its values populate the table correctly.

---

## Part 2 — Fysiologiska Tempozoner (Pace Zones)

Anchor the running pace zones directly to fysiologiska trösklar (LT1 and LT2 paces) instead of fixed VDOT percentages:
1.  LT1 and LT2 paces are calculated in `estimateLTFromRaces()` and `estimateZonesFromStatisticalAnalysis()`.
2.  In `lib/fitness/zones.ts`, implement `buildPaceZonesFromLT(lt: LTBoundaries)`:
    *   **Z1 (Recovery)**: Pace slower than Z2 (`> lt1PaceSecPerKm * 1.08`).
    *   **Z2 (Aerobic)**: Pace from `lt1PaceSecPerKm * 1.08` down to `lt1PaceSecPerKm`.
    *   **Z3 (Tempo)**: Pace from `lt1PaceSecPerKm` down to `lt2PaceSecPerKm` (the range between thresholds).
    *   **Z4 (Threshold)**: Pace from `lt2PaceSecPerKm` down to `lt2PaceSecPerKm * 0.95`.
    *   **Z5 (VO2max/Interval)**: Pace faster than `lt2PaceSecPerKm * 0.95`.
3.  Integrate this new pace zone calculation into the cache and statistics views so pace zones can be displayed based on these thresholds.

---

## Part 3 — Bug Fixes

### 1. Auto-Link BigInt Serialization Crash
*   **Location**: `app/api/races/auto-link/route.ts`
*   **Issue**: The auto-link endpoint crashes with a 500 error when returning JSON because `candidates[0].stravaId` is a `BigInt` at runtime, which cannot be serialized by `NextResponse.json` (throws `Do not know how to serialize a BigInt`).
*   **Fix**: Convert `candidates[0].stravaId` to string using `.toString()` in the database return object and in the `updates` array.

### 2. Manual Linking "No Activities Found"
*   **Location**: `app/api/races/activities-near/route.ts`
*   **Issue**: When trying to link activities to a PB manually, the modal says "Inga löppass hittades ±3 dagar från detta datum."
*   **Root Cause**: The API endpoint filters activities strictly by `sportType: { in: ["Run", "TrailRun", "VirtualRun"] }`. TrainingLab supports cycling, skiing, strength, etc., so PBs in other sports find no matching activities.
*   **Fix**: Remove or broaden the `sportType` filter in `activities-near/route.ts` so that it returns activities of *all* sport types near that date, or matches the sport category of the PB record.

### 3. Missing Link in PB Card
*   **Location**: `app/(dashboard)/races/races-client.tsx`
*   **Issue**: When a manual link is successfully created, the main Personbästa (PB) Card at the top of the races page does not show any link to the Strava activity (only the history table rows do).
*   **Fix**: Add an external link icon (e.g. `ExternalLink` from lucide-react) to the PB Card if `pb.stravaActivityId` is set, linking to `https://www.strava.com/activities/${pb.stravaActivityId}`.

### 4. Race Predictions Model Selection Showing No Values
*   **Location**: `lib/fitness/cache.ts` (in `updateHRZones`)
*   **Issue**: In Stats → Fitness, when selecting a model other than "Weighted (default)", the table values become empty.
*   **Root Cause**: In `lib/fitness/cache.ts` inside `updateHRZones()` (manual/AI calibration), the database `upsert` updates `FitnessCache` but completely omits `vo2maxBreakdownJson` and `predictionsJson`. Consequently, after a calibration run, `vo2maxBreakdownJson` and `predictionsJson` are reset to `NULL` in the database cache.
*   **Fix**: Update `updateHRZones()` in `lib/fitness/cache.ts` to compute and include `vo2maxBreakdownJson: vo2maxResult.breakdown ?? {}` and `predictionsJson` in the `create` and `update` blocks of the database upsert, exactly like `updateVO2maxAndPaces` does.

### 5. Layout & Text Polishes in Stats
*   **Location**: `app/(dashboard)/stats/stats-client.tsx`
*   **HRZoneTable Column Order**: Ensure column order in `HRZoneTable` is LT1 (Aerobic Threshold) on the left, and LT2 (Lactate Threshold) on the right (physiological order).
*   **Zon-border label**: Ensure LT1 is described as "Z2/Z3-gräns — lätta pass hålls under denna gräns" (instead of Z1/Z2 border).
*   **Slash commands**: Ensure selecting a slash command in the AI coach chat does not auto-submit/auto-fill example prompts, but instead focuses the input box so the user can type their own prompt.

---

## Part 4 — Verification & Workflow Protocol (MANDATORY)

Once the changes are implemented, you MUST execute the following verification steps before concluding:

1.  **Double-check everything**: Review the changed code files for syntax errors and edge cases.
2.  **Full Bug Audit**: Perform an end-to-end check of the new changes (test auto-linking, manual-linking, model selection in Stats, and pace zone calculations).
3.  **Update Documentation**: Update relevant documentation files in `docs/` (such as `docs/planning/IMPLEMENTATION_PLAN.md` or API files) to reflect the changes.
4.  **Verify compilation**: Run the build verification command (e.g. `pnpm build --no-lint`) to ensure the application compiles cleanly.
5.  **Commit and Push**: Stage and commit the changed files, and push them to the repository.
6.  **Deploy / Run**: Verify that the application starts and runs correctly on the local dev server.