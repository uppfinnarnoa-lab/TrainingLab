# Sport Colors — Data Flow

How activity colors are resolved throughout the app.

## The Chain

```
prisma.SportCategory.color          ← sport-level base color
prisma.WorkoutType.color            ← type-level override (null = inherit sport color)
prisma.SportCategory.workoutFlagTypeId ← FK to a WorkoutType for Strava "workout" flag
```

The resolver in `lib/planner/colors.ts` handles all color decisions:

1. **Race** → `findSharedRaceType(sports).color` (the shared "Race" WorkoutType the user can recolor)
2. **Strava generic "workout" flag** (workoutType ∈ {3, 12}) → `sport.workoutFlagTypeId` if set → that type's color
3. **Named bucket** (customTypeName or `inferTypeName(workoutType)`) → first WorkoutType whose `.name` matches a bucket regex (`TYPE_BUCKET_PATTERNS`)
4. **Easy/default** → sport's own `.color` (no bucket match)
5. **Static fallback** → `workoutColor()` static palette (runs before user has visited Settings)

## Key Functions

| Function | File | Purpose |
|---|---|---|
| `resolveActivityColor()` | `lib/planner/colors.ts:161` | Full resolution for Activities/History pages |
| `workoutColor()` | `lib/planner/colors.ts:39` | Static-palette fallback (sport+type name strings) |
| `matchSportCategory()` | `lib/planner/colors.ts:123` | Find user's SportCategory for a Strava sport string (exported) |
| `inferTypeName()` | `lib/planner/colors.ts:85` | Map Strava workoutType int → bucket name |
| `GENERIC_WORKOUT_TYPES` | `lib/planner/colors.ts:77` | Set{3, 12} — Strava's generic workout flag integers |

## Pages That Use `resolveActivityColor`

- `app/(dashboard)/activities/page.tsx` → `ActivityList` → per activity row + sport filter buttons
- `app/(dashboard)/history/page.tsx` → `HistoryClient` → calendar pills + expanded list
- `app/(dashboard)/activities/[id]/page.tsx` → detail header pill
- `components/activity/TypePicker.tsx` → inline type override badge

All pass a `SportCategory[]` fetched via `prisma.sportCategory.findMany({ include: { workoutTypes: ... } })` — no explicit `select`, so all fields including `workoutFlagTypeId` are included automatically.

## Workout Flag Type (§10.2)

`SportCategory.workoutFlagTypeId` lets the user say "when Strava marks an activity as a generic workout, use this workout type's color". Configured in Settings → Sports as a per-sport dropdown.

Constraint: the referenced `WorkoutType` must belong to the same sport (enforced in `PATCH /api/sports`).

If `workoutFlagTypeId` is null, the app falls back to `inferTypeName(workoutType)` → regex bucket (currently maps `workoutType=3` to the "intervall" bucket).

## Auto-Create on Sync (§10.4)

`ensureSportCategoryExists(userId, sportType, seen)` in `lib/strava/sync.ts` creates a stub `SportCategory` (gray color, "run" icon, order 999) when a Strava sync encounters an unknown `sport_type`. It also attaches a shared Race type so the new sport is immediately usable in the planner.

The `seen: Set<string>` prevents redundant DB lookups within a single sync run.

Called from: `syncActivities`, `resyncRecentActivities`, `syncSingleActivity`.

## Race Detection

`RACE_WORKOUT_TYPES = new Set([1, 11])` in `lib/strava/sync.ts`:
- 1 = Race
- 11 = Virtual Race

`mapActivity()` sets `isRace = RACE_WORKOUT_TYPES.has(raw.workout_type)`. Previously only `=== 1`.
