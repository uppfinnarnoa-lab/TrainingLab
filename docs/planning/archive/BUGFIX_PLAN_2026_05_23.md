# Bug Fix & Feature Plan — 2026-05-23

Covers all issues from Prompt 1 in FUTURE_PLANS.md plus new additions from session.

---

## Part 1 — HR Zone Estimation Redesign

### Background: the article (PMC10765723)
The linked article describes DDFA (Dynamical Detrended Fluctuation Analysis) of RR-interval data during incremental lab exercise. That method requires per-beat ECG data — not applicable here. Our correct approach is statistical analysis of aggregate training data. The article's principle is valid: LT1/LT2 are identified as inflection points in a physiological-response curve. We apply this at the fleet level: pace-HR curve across hundreds of sessions.

---

### Root cause: non-monotonic zones bug

Traced through the full estimation pipeline. **Multiple failure points:**

**Bug 1 — Mixed sources in `estimateLTFromRaces()` (`lib/fitness/zones.ts` line ~227):**
```ts
return {
  lt1HR: lt1HRFromRegression ?? Math.round(maxHR * 0.78),
  lt2HR: lt2HRFromRegression ?? Math.round(maxHR * 0.88),
  ...
};
```
If `paceToHR()` returns null for one value but not the other (e.g. lt2HR from regression = 181 bpm but lt1HR falls just outside `maxHR * 0.99` boundary), the result is **mixed-source**: one value from regression, one from a fixed percentage of a completely different magnitude. Since they come from different models, lt1HR can end up > lt2HR, which when fed to `buildHRZonesFromLT()` produces an inverted Z3: `[lt1, lt2]` where lt1 > lt2.

**Bug 2 — No monotonicity guard in `buildHRZonesFromLT()` (`lib/fitness/zones.ts` line ~239):**
```ts
z3: [lt1, lt2],  // if lt1 ≥ lt2: inverted zone!
```
No validation before building. If lt1 ≥ lt2, Z3 is immediately invalid.

**Bug 3 — Z1 lower bound can exceed upper bound:**
In both `buildHRZonesFromLT()` and `estimateZonesFromStatisticalAnalysis()`:
```ts
z1: [restHR, lt1HR - z2width],
```
If `restHR ≥ lt1HR - z2width` (can happen when statistical analysis returns a low lt1HR estimate while restHR is elevated, e.g. 85 bpm rest HR and lt1HR=88), Z1[0] > Z1[1] — invalid.

**Bug 4 — No final validation before caching:**
`updateHRZones()` in `cache.ts` stores whatever `hrZones` it computed with no final sanity check. A broken `statResult.zones` or a `buildHRZonesFromLT()` result with inverted zones is stored directly.

---

### Redesign: robust statistical zone estimation

**Primary method: improved statistical piecewise analysis (`estimateZonesFromStatisticalAnalysis`)**

This is already the right approach for someone with lots of data. Improvements:

1. **Stricter outlier filtering before bucketing:**
   - Reject activities where `avgHR > maxHR * 0.96` (sensor artifact territory for steady-state)
   - Reject activities where `avgHR < maxHR * 0.50` (barely aerobic — noise for threshold finding)
   - Reject runs with total elevation gain > 15% of distance (extreme trail — GAP isn't reliable here)
   - Temperature: reject entirely if `weatherTemp > 30°C` (HR inflation makes zone finding unreliable), downweight 28–30°C
   - Keep recency weighting at 180-day half-life (already good)

2. **Better breakpoint validation:**
   - Require breakpoints to be in meaningful pace ranges: bp1 pace must be between 4:30–8:00/km (LT1 is not at sprinting or walking pace)
   - Require bp2 pace to be faster than bp1 (bp2 < bp1 in sec/km — faster pace = higher HR)
   - Require at least 10 bpm separation between lt1HR and lt2HR
   - Require that slope steepens at each breakpoint (each segment's |slope| should increase toward faster paces)

3. **Raise the R² threshold to ≥ 0.75** (from 0.70) for direct application — only apply if data is clearly explaining the HR-pace relationship.

**Secondary method: race-PB estimation (fixed)**

Fix `estimateLTFromRaces()`: if EITHER lt1HRFromRegression OR lt2HRFromRegression is null, use the percentage fallback for BOTH — never mix sources:
```ts
const lt1 = lt1HRFromRegression && lt2HRFromRegression
  ? lt1HRFromRegression
  : Math.round(maxHR * 0.78);
const lt2 = lt1HRFromRegression && lt2HRFromRegression
  ? lt2HRFromRegression
  : Math.round(maxHR * 0.88);
// After mixing: validate lt1 < lt2
if (lt1 >= lt2) fall back to percentage entirely
```

**Tertiary method: fixed percentage (always valid)**
`buildHRZones(maxHR, restHR)` with 80%/89% — unchanged, used as final fallback.

**New: `ensureValidZones(zones, maxHR, restHR)` in `zones.ts`:**
```ts
function ensureValidZones(z: HRZones): boolean {
  return (
    z.z1[0] < z.z1[1] &&
    z.z1[1] <= z.z2[0] &&
    z.z2[0] < z.z2[1] &&
    z.z2[1] <= z.z3[0] &&
    z.z3[0] < z.z3[1] &&
    z.z3[1] <= z.z4[0] &&
    z.z4[0] < z.z4[1] &&
    z.z4[1] <= z.z5[0] &&
    z.z5[0] < z.z5[1]
  );
}
```

**Fix `updateHRZones()` in `cache.ts`:**
After building `hrZones` (from any method), call `ensureValidZones(hrZones)`. If it fails, fall back to `buildHRZones(maxHR, restHR)` (always valid). Log a warning when fallback occurs.

**Fix `buildHRZonesFromLT()`:**
Before building, validate:
```ts
if (lt.lt1HR >= lt.lt2HR) return buildHRZones(maxHR, restHR); // fall back
if (lt.lt1HR - z2width <= restHR) clamp z1 to [restHR, restHR + 1]
```

---

### Issue A — AI coach always uses default zones (not calibrated)
**File:** `lib/ai/context-builder.ts` line 87  
**Current:** `const hrZones = buildHRZones(maxHR, restHR)` — ignores FitnessCache.zones.  
**Fix (after zone redesign above ensures stored zones are always valid):**
```ts
import { buildHRZones, type HRZones } from "@/lib/fitness/zones";
const hrZones: HRZones = fitnessCache?.zones
  ? { ...(fitnessCache.zones as HRZones), maxHR, restHR }
  : buildHRZones(maxHR, restHR);
```
This is safe AFTER the redesign guarantees stored zones are monotonic.

---

### Issue B — Model selection buttons never appear in Stats → Fitness
**Files:** `prisma/schema.prisma`, `lib/fitness/cache.ts`, `app/(dashboard)/stats/page.tsx`  
**Bug:** `FitnessCache` has no `vo2maxBreakdownJson` field. Fast path always has only `"Weighted (default)"` in `fastModelVdots` → `Object.keys(modelVdots).length === 1` → buttons hidden.  
**Fix:**
1. Add `vo2maxBreakdownJson Json?` to `FitnessCache` in `prisma/schema.prisma`
2. Run `pnpm prisma migrate dev --name add-fitness-cache-breakdown`
3. In `cache.ts` `updateVO2maxAndPaces()` → add `vo2maxBreakdownJson: vo2maxResult.breakdown ?? {}` to `sharedFields`
4. In `stats/page.tsx` fast path → read and merge breakdown from cache into `fastModelVdots`

---

### Issue C — LT1/LT2 display order wrong in HRZoneTable
**File:** `app/(dashboard)/stats/stats-client.tsx` lines ~611–624  
**Bug:** LT2 shown left column, LT1 right. Should be LT1 left, LT2 right (physiological order: lower threshold first).  
**Fix:** Swap the two columns.

---

### Issue D — Wrong zone-border description in stat-zones panel
**File:** `app/(dashboard)/stats/stats-client.tsx` line ~724  
**Bug:** LT1 described as "Z1/Z2-gräns". LT1 = Z2/Z3 border (bottom of Z3 = top of Z2).  
**Fix:** Change to "Z2/Z3-gräns — lätta pass hålls under denna gräns".

---

## Part 2 — AI Chat / Slash Command Fixes

### Issue F — Slash command inserts example prompt instead of letting user type
**File:** `components/coach/ChatInterface.tsx`  
**Bug:** `selectTool(example)` calls `setInput(example)` — the full example prompt is inserted into the textarea. The user wants to type their own prompt after selecting a command.  
**Fix:** Change `selectTool()` to NOT insert the example. Instead, just close the menu and focus the textarea with an empty input. The tool description in the menu is sufficient context. Change `setInput(example)` to `setInput("")` (or clear to previous state if already non-empty).  
Actually better: insert just a brief trigger text that matches the tool, so the user knows what command they're working with but can type their own prompt. Simplest fix: `setInput("")` and focus — the menu already showed what the tool does.

---

### Issue G — search_activities example prompt finds recent runs not Tuesday runs
**File:** `components/coach/ChatInterface.tsx` line ~378  
**Bug:** Example "Hitta mina senaste tisdagsbanor" triggers `search_activities` but the AI searches broadly for recent runs rather than specifically Tuesday runs. After fix F (examples are no longer auto-inserted), this is less critical as a functional bug, but the display example should still be accurate.  
**Fix:** Change example to something unambiguous: "Hitta alla mina löppass från maj 2025" — this exercises date range search which is what the tool is actually good at.

---

## Part 3 — Races Page Fixes

### Issue H — Remove vägfilter (smart filter) from races page
**File:** `app/(dashboard)/races/races-client.tsx`  
**Bug:** The "Vägfilter" toggle hides race results >35% slower than the PB for that distance. This incorrectly hides OL (orienteering) and terrain results that are legitimately slower than road PBs. The user wants all results always shown.  
**Fix:**
- Remove `smartFilter` state and `FILTER_THRESHOLD` constant
- Remove `filteredRecords` computation — use `records` directly everywhere
- Remove the filter toggle button from the UI
- Remove `hiddenCount` display

---

### Issue I — PR linking: bulk auto-link + unlink button
**Existing state:** Manual linking exists in the add/edit modal via `/api/races/activities-near`. No automatic linking on save/import.

**New requirements:**
1. **Bulk auto-link existing PRs**: scan all `RaceRecord` rows with `stravaActivityId = null` and match them to Strava activities by date (±1 day, same rough distance).
2. **Unlink button**: in the race table, show an unlink (×) button when `stravaActivityId` is set. Clicking it clears the link.
3. **No automatic future linking**: keep the current model (manual only). The bulk auto-link is a one-time operation triggered by a button.

**Implementation:**
- New API route: `POST /api/races/auto-link` — for each unlinked `RaceRecord`, query `Activity` table for activities within ±1 day of the race date, with distance within ±20% of race distance. If exactly one candidate: link it. If none or multiple: skip. Returns a summary `{ linked: N, skipped: N }`.
- In `races-client.tsx`:
  - Add "Koppla aktiviteter" button (with Link2 icon) in the header actions area
  - On click: POST to `/api/races/auto-link`, show result toast
  - Add unlink button (X icon) in each row's action area when `r.stravaActivityId` is set
  - On unlink click: PATCH `/api/races/{id}` with `{ stravaActivityId: null }`
  - Update local state after both operations
- `PATCH /api/races/[id]/route.ts` already exists — confirm it accepts `stravaActivityId: null`

---

## Part 4 — Planner Enhancements

### Issue J — Drag-and-drop templates onto calendar days
**Files:** `components/planner/TemplateCard.tsx`, `components/planner/PlannerCalendar.tsx`, `app/(dashboard)/planner/planner-client.tsx`  
**Current state:** No drag-and-drop. Templates are added to a date via a modal (click day → builder opens → select template).  
**Fix (HTML5 drag-and-drop):**

1. **TemplateCard**: add `draggable={true}` and `onDragStart={(e) => e.dataTransfer.setData("templateId", template.id)}` 
2. **PlannerCalendar day cell**: 
   - Add `onDragOver={(e) => e.preventDefault()}` (to allow drop)
   - Add `onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("templateId"); if (id) onTemplateDrop(id, key); }}`
   - Add visual drop-target highlight: `isDragOver` state with `onDragEnter`/`onDragLeave`
3. **PlannerCalendar Props**: add `onTemplateDrop?: (templateId: string, date: string) => void`
4. **planner-client.tsx**: pass `onTemplateDrop={handleAddTemplateToDate}` to `PlannerCalendar`. Note: `handleAddTemplateToDate` currently uses `builderDate` — need to refactor to accept an explicit date parameter `handleAddTemplateToDate(templateId, date)`.

---

### Issue K — Up to 5 sessions per day, shrinking to fit
**File:** `components/planner/PlannerCalendar.tsx` lines ~189–199, `components/planner/WorkoutPill.tsx`  
**Current state:** Shows max 3 sessions inline, "+N" for the rest.  
**Fix:**
1. Change `dayWorkouts.slice(0, 3)` → `dayWorkouts.slice(0, 5)`
2. Change `dayWorkouts.length > 3` overflow indicator → `dayWorkouts.length > 5`
3. Pass `compact={dayWorkouts.length > 3}` or `tiny={dayWorkouts.length > 5}` to `WorkoutPill` when there are many sessions
4. In `WorkoutPill`: add a `compact` prop that reduces font size and padding (e.g., `text-[9px]` instead of `text-xs`, `py-0.5 px-1` instead of `py-1 px-1.5`)
5. The day cell's `min-h-[88px]` may need to increase slightly for 5 pills — can use `min-h-[104px]` or `auto` when many workouts

---

## Implementation Order

Execute in this order to minimize re-work:

1. `lib/fitness/zones.ts` — add `ensureValidZones()`, fix `buildHRZonesFromLT()`, fix `estimateLTFromRaces()` mixed-source, improve `estimateZonesFromStatisticalAnalysis()`
2. `prisma/schema.prisma` — add `vo2maxBreakdownJson Json?` to FitnessCache (migration needed)
3. `lib/fitness/cache.ts` — save breakdown + add final zone validation in `updateHRZones()`
4. `lib/ai/context-builder.ts` — use calibrated zones from cache
5. `app/(dashboard)/stats/page.tsx` — read breakdown from cache in fast path
6. `app/(dashboard)/stats/stats-client.tsx` — fix LT1/LT2 display order + stat-zone description
7. `components/coach/ChatInterface.tsx` — fix slash command behavior + improve examples
8. `app/(dashboard)/races/races-client.tsx` — remove smart filter, add unlink button, add auto-link button
9. `app/api/races/auto-link/route.ts` — new route for bulk auto-linking
10. `components/planner/TemplateCard.tsx` — add draggable
11. `components/planner/PlannerCalendar.tsx` — add drop targets + 5-session support
12. `components/planner/WorkoutPill.tsx` — add compact prop
13. `app/(dashboard)/planner/planner-client.tsx` — wire drag-drop handler

---

## Files to Change

| File | What changes |
|---|---|
| `lib/fitness/zones.ts` | Add `ensureValidZones()`, fix `buildHRZonesFromLT()`, fix `estimateLTFromRaces()`, improve `estimateZonesFromStatisticalAnalysis()` |
| `prisma/schema.prisma` | Add `vo2maxBreakdownJson Json?` to FitnessCache |
| `lib/fitness/cache.ts` | Save `vo2maxBreakdownJson`; add final `ensureValidZones()` call in `updateHRZones()` |
| `lib/ai/context-builder.ts` | Use calibrated zones from FitnessCache |
| `app/(dashboard)/stats/page.tsx` | Read breakdown from cache in fast path |
| `app/(dashboard)/stats/stats-client.tsx` | Fix LT1/LT2 column order + stat-zone border label |
| `components/coach/ChatInterface.tsx` | Fix slash command (don't insert example) + improve examples list |
| `app/(dashboard)/races/races-client.tsx` | Remove smart filter, add unlink button, add auto-link button |
| `app/api/races/auto-link/route.ts` | **New file** — bulk auto-link endpoint |
| `app/api/races/[id]/route.ts` | Confirm PATCH accepts `stravaActivityId: null` |
| `components/planner/TemplateCard.tsx` | Add `draggable` + `onDragStart` |
| `components/planner/PlannerCalendar.tsx` | Drop zone on day cells + show up to 5 sessions |
| `components/planner/WorkoutPill.tsx` | Add `compact` size prop |
| `app/(dashboard)/planner/planner-client.tsx` | Wire drag-drop + fix `handleAddTemplateToDate` signature |

---

## What is NOT changing

- `estimateLTFromRaces()` core logic — only the source-consistency fix
- Race modal linking UI — already works, keeping it
- Automatic linking on new PR entry — stays manual only
- AI tools definitions in `lib/ai/tools.ts` — no changes needed
- `buildHRZones()` (fixed percentage method) — stays as valid fallback
- VO2max estimation logic — no changes needed

---

*Written: 2026-05-23 — await user approval before implementing*
