# Races API

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

## PUT /api/races

Auto-import race activities from Strava. Matches activities with `isRace: true` and `sportType` in [Run, TrailRun, VirtualRun] against standard distances (±5% tolerance).

**Auth:** Required

**Response (200):**
```json
{ "imported": 3 }
```

**Side effects:** Creates `RaceRecord` rows for Strava race activities not already imported. Skips if `stravaActivityId` already exists in records.

**Distance matching:** 800m, 1500m, Mile, 3K, 5K, 10K, 15K, Half Marathon, Marathon (±5%). Others stored as `Xkm` custom label.

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
