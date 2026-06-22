# Weather API

## POST /api/weather/backfill

Backfills historical weather (Open-Meteo) for the user's activities that have GPS data but no weather yet.

**Auth:** Required

**Request:**
```json
{ "limit": "number (optional, default: 100, capped at 500)" }
```

**Response (200):**
```json
{ "updated": 87 }
```

**Response (error):**
```json
{ "error": "unauthorized" }
```

**Side effects:**
- Selects up to `limit` activities with `weatherTemp: null` and a non-null `mapPolyline`, newest first.
- Decodes the first point of the encoded polyline to get lat/lon (activities without GPS are skipped — `mapPolyline: null` excludes them at the query level).
- Calls Open-Meteo (`fetchWeather`) per activity for its start date/coords, with a 200ms delay between requests.
- Writes `weatherTemp`, `weatherWind`, `weatherPrecip`, `weatherCode` to each updated activity.
- Best-effort: a failed fetch for one activity is skipped silently and does not abort the batch.
