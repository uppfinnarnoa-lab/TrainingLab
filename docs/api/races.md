# Races API

## Automatic PB detection (side effect, not its own endpoint)

When `AthleteProfile.pbDetectionMode === "automatic"`, every newly-synced running `Activity` is scanned for PBs and near-PB results by `lib/races/pb-detection.ts`, called from `lib/strava/sync.ts` after a genuinely new activity is created (bulk sync, smart resync, and the Strava webhook path all three call it). Source data is `Activity.bestEfforts` (Strava's own exact per-distance segment times), matched against the canonical distance list in `lib/races/distances.ts`. A result is recorded (`RaceRecord.isManual: false`, `eventName` set to the Strava activity's name) when:

- it beats or is within `AthleteProfile.pbDetectionTolerancePct`% of the current best for that distance, or
- there is no current best yet AND `Activity.isRace === true` (a flagged-race requirement that applies only to seeding the *first* record on a never-before-tracked distance).

Only applies to activities synced **after** `pbDetectionMode` was last switched to `"automatic"` (`AthleteProfile.pbDetectionModeChangedAt`) — never retroactively, to avoid flooding the tracker on first activation. See `POST /api/races/scan-history` below for the explicit, user-initiated way to backfill historical results.

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

**Auth:** Required

**Request:** No body.

**Response (200):**
```json
{
  "created": 3,
  "records": [
    { "id": "cuid", "distance": "5K", "distanceM": 5000, "time": 1185, "date": "2025-09-14T00:00:00.000Z", "eventName": "Tuesday track session", "stravaActivityId": "123456789", "notes": null, "isManual": false }
  ]
}
```

**Side effects:** Creates one `RaceRecord` per qualifying `bestEffort` across the user's entire running history (idempotent — running it twice never duplicates a result already recorded for the same activity + distance).
