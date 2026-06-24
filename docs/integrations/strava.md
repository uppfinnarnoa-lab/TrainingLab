# Integrations

## Strava
- **Purpose**: Primary source for ALL activity data. Activities, GPS, HR, splits, and critically — user-written names and descriptions (used as AI context).
- **Auth**: OAuth 2.0. Tokens stored in `StravaAccount`. Middleware auto-refreshes on expiry.
- **Rate limits**: 200 req/15min, 2000 req/day. Respected in sync logic with automatic backoff.
- **Sync**: Initial full history (paginated, 200/page). Daily incremental cron at 06:00. Historical backfill (split detail) resumes automatically each night at 00:30 UTC until complete. Manual trigger via UI.
- **Webhook**: Optional real-time sync via Strava webhook (requires public URL — already available).
- **Key fields used**: `name`, `description`, `sport_type`, `start_date`, `distance`, `moving_time`, `average_heartrate`, `max_heartrate`, `average_cadence`, `total_elevation_gain`, `suffer_score`, `workout_type`, `splits_metric`, `laps`, `best_efforts`, `map.summary_polyline`
- **Activity streams**: Per-second data fetched on-demand only (single activity detail view), cached after first fetch.
- **Docs**: Strava API v3 — `https://developers.strava.com/docs/reference/`

## Garmin Connect
- **Purpose**: Physiological data ONLY — HRV, sleep, resting HR, Body Battery, readiness. NOT activities.
- **Auth**: Unofficial SSO. Two strategies (tried in order):
  1. **Browser SSO + manual ticket paste (primary)**: User opens Garmin's `/sso/embed` in a new tab (not an iframe — Garmin's service-URL whitelist rejects our domain, so it always breaks out of any iframe/popup framing and shows the raw ticket on its own page instead of redirecting back to us). User copies the displayed `ST-...` ticket and pastes it into the Settings page, which POSTs it to `/api/garmin/exchange-ticket`. `/api/garmin/ticket-receiver` exists but is currently unreachable (kept in case Garmin's whitelist behavior changes).
  2. **Mobile JSON API (server-side fallback)**: `POST sso.garmin.com/mobile/api/login` → JSON `{serviceTicketId: "ST-..."}`. Uses iPhone UA + 2–5 s anti-WAF delay. Falls back further to old `/sso/embed` HTML form.
  - Both paths end with: ST-ticket → OAuth1 via `connectapi.garmin.com/oauth-service/oauth/preauthorized` → OAuth2 via `.../exchange/user/2.0`.
  - Tokens stored AES-256-GCM encrypted in `GarminAccount`. Email/password never persisted.
  - **Note**: garth library deprecated March 2026 — do not use as reference.
- **Sync**: 08:00 (yesterday's HRV/sleep) + 20:00 (today's body battery/steps/readiness).
- **Fields**: resting HR, body battery, respiration, stress, steps, sleep score/duration/stages (deep/light/REM/awake), HRV nightly RMSSD, HRV balance, training readiness, SpO2.
- **Endpoints** (all via `connectapi.garmin.com`): `/usersummary-service/usersummary/daily/{dn}`, `/wellness-service/wellness/dailySleepData/{dn}`, `/hrv-service/hrv/{dn}`, `/metrics-service/metrics/trainingreadiness`, `/wellness-service/wellness/user/daily-wellness/spo2/details`
- **Why not activities**: Strava descriptions are irreplaceable AI context. Garmin activity data is duplicate.
- **Docs**: No official API — reverse-engineered from python-garminconnect and garth (deprecated).

## Open-Meteo (Weather)
- **Purpose**: Historical weather per activity — temperature, wind, precipitation, condition code.
- **Auth**: None — fully free, no API key required.
- **Endpoint**: `https://archive-api.open-meteo.com/v1/archive`
- **Params**: latitude, longitude, date, `hourly=temperature_2m,wind_speed_10m,precipitation,weather_code`
- **Fetch strategy**: Daily cron at 07:00, 50 activities/user per run (throttled, gentle on the API). One request per activity (by GPS start point + date).
- **Fields stored on `Activity`**: `weatherTemp` (°C), `weatherWind` (km/h), `weatherPrecip` (mm), `weatherCode` (WMO int)
- **Performance note**: Fetch is best-effort. Missing weather fields are null — UI handles gracefully.

## Claude API (Anthropic)
- **Model**: `claude-sonnet-4-6` (default). Configurable per user.
- **Key feature**: Prompt caching via `cache_control` on system prompt + base context block. Saves ~80% on repeated input tokens.
- **Cost tracking**: Every response logs `input_tokens`, `output_tokens`, `cache_read_tokens` → estimates cost → stores on `Message.tokensUsed`.
- **Streaming**: API route `/api/coach/chat` streams via SSE. nginx must disable buffering for this route (`proxy_buffering off`) — see `deployment/README.md` §9 for the server block.
- **SDK**: `@anthropic-ai/sdk`
- **Docs**: `https://docs.anthropic.com`

## Gemini Flash (Google AI)
- **Model**: `gemini-2.5-flash` — free tier: 15 RPM, 1M TPM, 1500 RPD.
- **Context caching**: Use Gemini's context cache API for system prompt (equivalent to Claude's prompt caching).
- **Cost tracking**: Free tier tracked by request count per day (shown in UI). Paid tier by token if user upgrades.
- **SDK**: `@google/generative-ai`
- **Docs**: `https://ai.google.dev/docs`

## NVIDIA NIM
- **Model**: `moonshotai/kimi-k2.6` (default — 1T-param multimodal, 256K context; same free, no-card, ongoing rate-limited tier as the other NVIDIA models, OpenAI-compatible endpoint). Other options: Nemotron 70B, Llama 3.3 70B, Llama 3.1 405B, Mistral Large. NVIDIA retires Kimi model IDs outright without redirecting (kimi-k2.5 404'd as of 2026-06); `resolveNvidiaModel()` in `lib/ai/nvidia.ts` falls back to the current default if a user's saved model ID is no longer in `NVIDIA_MODELS`.
- **SDK**: `openai` SDK pointed at `https://integrate.api.nvidia.com/v1` (`lib/ai/nvidia.ts`).

## Groq
- **Model**: `llama-3.3-70b-versatile` (default, OpenAI-compatible endpoint).
- **SDK**: `openai` SDK pointed at `https://api.groq.com/openai/v1` (`lib/ai/groq.ts`). Requires `stream_options` to get usage data back.

## AI Provider Abstraction
All four providers implement the same `AIClient` interface in `lib/ai/client.ts` (`"claude" | "gemini" | "nvidia" | "groq"`). Switching is a user setting in `AISettings.provider`. Never call provider SDKs directly from components — always go through `lib/ai/`.
