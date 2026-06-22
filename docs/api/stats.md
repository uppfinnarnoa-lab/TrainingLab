# Stats API

## GET /api/stats

Comprehensive fitness/stats dashboard payload: HR/pace zones, VO2max, training load curve, weekly volumes, zone distribution, overview totals (this week/month/YTD + YoY), race predictions, and sparklines.

**Auth:** Required

**Request:** No body / params.

**Response (200):**
```json
{
  "hrZones": {
    "z1": [45, 130], "z2": [130, 142], "z3": [142, 162],
    "z4": [162, 170], "z5": [170, 185],
    "maxHR": 185, "restHR": 45
  },
  "paceZones": {
    "easy": [330, 410], "marathon": [280, 310], "threshold": [255, 270],
    "interval": [225, 240], "repetition": [205, 215],
    "vdot": 52.3
  },
  "vo2max": {
    "value": 58.1,
    "vdot": 52.3,
    "confidence": "high",
    "method": "string describing blended model",
    "breakdown": { "modelName": 51.2 }
  },
  "todayLoad": { "date": "2025-10-20", "tss": 42, "atl": 38.2, "ctl": 51.4, "tsb": 13.2 },
  "loadCurve": [
    { "date": "2025-07-08", "tss": 0, "atl": 0, "ctl": 0, "tsb": 0 }
  ],
  "weeklyVolumes": {
    "2025-10-13": { "Running": { "km": 42.1, "timeSec": 14760 }, "Cycling": { "km": 80.0, "timeSec": 9600 } }
  },
  "zoneSeconds": { "z1": 3600, "z2": 7200, "z3": 1800, "z4": 600, "z5": 120 },
  "overview": {
    "thisWeek":  { "km": 42.1, "timeSec": 14760, "count": 5, "elevationM": 320 },
    "thisMonth": { "km": 160.5, "timeSec": 56000, "count": 18, "elevationM": 1200 },
    "ytd":       { "km": 1800.0, "timeSec": 620000, "count": 200, "elevationM": 14000 },
    "lyWeek":    { "km": 38.0, "timeSec": 13500, "count": 4, "elevationM": 280 },
    "lyMonth":   { "km": 150.0, "timeSec": 52000, "count": 17, "elevationM": 1100 },
    "lyYtd":     { "km": 1700.0, "timeSec": 590000, "count": 190, "elevationM": 13500 }
  },
  "predictions": [
    { "label": "5K", "meters": 5000, "peak": 1185, "today": 1190 }
  ],
  "sparklines": [38.0, 40.2, 35.5, 42.0, 39.8, 44.1, 41.0, 42.1],
  "maxHR": 185,
  "restHR": 45
}
```

**Response (error):**
```json
{ "error": "unauthorized" }
```

**Side effects:** None — pure read, no DB writes.

**Notes on computation:**
- Pulls last 730 days of activities, last 30 days of `GarminDailySummary`, and `AthleteProfile`.
- `maxHR`/`restHR` prefer `AthleteProfile` values, fall back to `estimateMaxHR()` (98th-percentile of observed max HR) and latest Garmin resting HR (default 50).
- `vo2max`/`paceZones` come from `estimateVO2max()` (blended pace+HR model) and `buildPaceZones()` (Daniels VDOT tables).
- `todayLoad`/`loadCurve`: TSS computed per-activity via TRIMP (`computeTSS`), then ATL (7-day)/CTL (42-day)/TSB built over a full trailing year for proper EWMA warm-up (`buildLoadCurve`); `loadCurve` in the response is sliced to the last 16 weeks (112 days) for chart display.
- `weeklyVolumes`/`zoneSeconds` cover the last 12 weeks only; sport names are normalized via `normalizeSport()` (e.g. any `*Ride*`/`*Cycl*` → `"Cycling"`).
- `overview`/YoY: `lyWeek`/`lyMonth`/`lyYtd` are the same windows shifted back exactly 364/full-year days for week-aligned comparison.
- `predictions`: one entry per `RACE_DISTANCES` (800m through Marathon) — `peak` is the VDOT-implied time, `today` is `peak` adjusted by current TSB via `tsbAdjustedRaceTime()`.
- `sparklines`: 8 values, oldest to newest, weekly total km across all sports.
