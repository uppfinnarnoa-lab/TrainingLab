# Races API

## Automatic PB detection (side effect, not its own endpoint)

When `AthleteProfile.pbDetectionMode === "automatic"`, every newly-synced running `Activity` is scanned for PBs and near-PB results by `lib/races/pb-detection.ts`, called from `lib/strava/sync.ts` after a genuinely new activity is created (bulk sync, smart resync, and the Strava webhook path all three call it). Source data is `Activity.bestEfforts` (Strava's own exact per-distance segment times), matched against the canonical distance list in `lib/races/distances.ts`. A result is recorded (`RaceRecord.isManual: false`, `eventName` set to the Strava activity's name) when:

- there is no record at all yet for that distance: only seeded if `Activity.isRace === true` (avoids creating a whole new tracked distance from a casual training segment), or
- there is a record but no **manual** (`isManual: true`) entry yet for that distance: only `Activity.isRace === true` activities can record (improvement or near-PB) — a single auto-detected race-flagged entry isn't a reliable enough anchor on its own (it may be one segment of a much longer race), so non-race training data is blocked entirely until the user has manually entered a real PB for that distance. This is what prevents short, frequently-repeated distances like 800m from flooding with noisy training splits, or
- a manual baseline exists for that distance, and the result is a genuine all-time improvement (any age), or is within `AthleteProfile.pbDetectionTolerancePct`% of the current best **and** the activity happened within the last 365 days (near-PB matches are capped to recent results; all-time improvements are never age-limited).

Only applies to activities synced **after** `pbDetectionMode` was last switched to `"automatic"` (`AthleteProfile.pbDetectionModeChangedAt`) — never retroactively, to avoid flooding the tracker on first activation. See `POST /api/races/scan-history` below for the explicit, user-initiated way to backfill historical results, and `DELETE /api/races/auto-detected` for clearing out auto-detected results (e.g. ones recorded before this rule existed).

---

## GET /api/races

Fetch all race records for the user.

**Auth:** Required

**Response (200):** Array of `RaceRecord`, ordered by `distanceM` asc then `date` desc.

```json
[
  {
    "id": "cuid",
    "distance": "5K",
    "distanceM": 5000,
    "time": 1185,
    "date": "2025-09-14",
    "eventName": "Lidingöloppet",
    "stravaActivityId": "123456789",
    "notes": null,
    "isManual": false
  }
]
```

---

## POST /api/races

Create a race record manually.

**Auth:** Required

**Request:**
```json
{
  "distance":         "string (e.g. '5K', 'Half Marathon')",
  "distanceM":        "number (meters)",
  "time":             "number (seconds)",
  "date":             "YYYY-MM-DD",
  "eventName":        "string | null",
  "stravaActivityId": "string | null",
  "notes":            "string | null",
  "isManual":         "boolean (default: false)"
}
```

**Response (201):** Created `RaceRecord`.

---

## GET /api/races/activities-near?date=YYYY-MM-DD

Find running activities within ±3 days of a date for activity linking.

**Auth:** Required

**Response (200):** Array of nearby activities.
```json
[
  { "stravaId": "12345", "name": "Tisdagsbana", "date": "2025-09-14", "distanceKm": 10.2, "movingTime": 2580 }
]
```

**Filtering:** Excludes activities named as warm-up/cool-down (`warm*`, `cool*`, `WU*`, `CD*`, `uppvärmning*`, `nedvarvning*`, prefix match, case-insensitive). Max 20 results.

---

## POST /api/races/auto-link

Attempt to automatically link unlinked race records to a matching Strava activity.

**Auth:** Required

**Request:** No body.

**Response (200):**
```json
{
  "linked": 3,
  "updates": [
    { "id": "cuid", "stravaActivityId": "123456789" }
  ]
}
```

**Side effects:** For each `RaceRecord` with `stravaActivityId: null`, looks for activities within ±1 day of the race date and within ±20% of `distanceM`; if exactly one candidate matches, sets `RaceRecord.stravaActivityId`. Records with zero or multiple candidates are left unlinked (no ambiguity resolution).

---

## PATCH /api/races/[id]

Update a race record (edit time, date, or event name).

**Auth:** Required

**Request (all optional):**
```json
{
  "time":      "number (seconds)",
  "date":      "YYYY-MM-DD",
  "eventName": "string | null",
  "notes":     "string | null"
}
```

**Response (200):** Updated `RaceRecord`.

---

## DELETE /api/races/[id]

Delete a race record.

**Auth:** Required. **Response (200):** `{ "ok": true }`.

---

## POST /api/races/scan-history

Explicit, user-initiated bulk scan of **all** past running activities for PBs and near-PB results, using the same logic and `pbDetectionTolerancePct` as automatic detection — but bypassing `pbDetectionMode` and the `pbDetectionModeChangedAt` guard entirely, since this endpoint *is* the deliberate, reviewable alternative to automatic backfilling. Activities are processed oldest-first so each result is compared against the true best-so-far at that point in time.

Implemented by `bulkDetectPBs()` ([lib/races/pb-detection.ts](../../lib/races/pb-detection.ts)), not by looping `detectPBsForActivity()` — fetches the user's full `RaceRecord` and `Activity` sets in two queries, replays the decision rule in memory, and writes everything in a single `createMany`. The original loop (an activity refetch plus two queries per qualifying `bestEffort`) was tens of thousands of sequential round trips over a multi-year history and timed out in production.

**Auth:** Required

**Request:** No body.

**Response (200):**
```json
{ "created": 3 }
```

**Side effects:** Creates one `RaceRecord` per qualifying `bestEffort` across the user's entire running history (idempotent — running it twice never duplicates a result already recorded for the same activity + distance).

---

## DELETE /api/races/auto-detected

Bulk-removes every auto-detected (`isManual: false`) `RaceRecord` for the user. Manual entries are never touched. Intended as the recovery action for a distance that accumulated unwanted auto-detected results (e.g. before the manual-baseline rule above existed) — delete, then re-run `POST /api/races/scan-history` to repopulate under the current rule.

**Auth:** Required

**Request:** No body.

**Response (200):**

```json
{ "deleted": 12 }
```
