# Garmin Connect Auth Rework Plan
*Created: 2026-06-17*

## Problem

All our server-side Garmin SSO approaches fail because:

1. **garth library is deprecated** (March 27, 2026 — matin/garth). Garmin changed their auth flow.
   The `/sso/embed` HTML form flow we copied from garth no longer creates new logins.

2. **Our specific failure**: Server returns `auth_failed` (not `server_blocked`), meaning the
   POST to `/sso/embed` returns HTTP 200 or non-403 response with unrecognized content —
   likely a CAPTCHA page or `embed=false` confusion.

3. **Root cause**: Garmin's Cloudflare layer detects datacenter IP + non-genuine TLS fingerprint.
   Node.js fetch cannot impersonate a real browser's TLS (no curl_cffi equivalent in JS).

4. **OAuth redirect loop**: `/sso/signin?service=https://our-url` is rejected by Garmin's
   service URL whitelist — only `connect.garmin.com` is allowed.

## What Actually Works (June 2026)

From research into python-garminconnect (cyberjunky — actively maintained):

- **Mobile JSON API**: `POST sso.garmin.com/mobile/api/login` → JSON `{serviceTicketId: "ST-..."}`
  Returns credentials in structured JSON, no CSRF parsing needed.
- **TLS fingerprint rotation** via `curl_cffi` (Python-only) gives multiple attempts.
- **Anti-WAF delays**: 3–8 s between GET and POST helps significantly.
- **None of these bypass datacenter detection completely** — they just give more tries.

## Solution Architecture

### Primary: Browser-side SSO (guaranteed to bypass bot-detection)

The fundamental problem is that Garmin detects datacenter IPs. The guaranteed fix is to run
the SSO login in the **user's own browser** (their home IP, genuine browser TLS fingerprint).

**Flow:**
```
Settings page (React)
  → User clicks "Connect with Garmin"
  → Component shows hidden iframe:
       src="https://sso.garmin.com/sso/embed
            ?embedWidget=true
            &service=https://training.helgars.se/api/garmin/ticket-receiver
            &gauthHost=https://sso.garmin.com
            &clientId=GarminConnect
            &id=gauth-widget
            &locale=en_US"
  → User logs in inside iframe (their browser, their IP, genuine TLS)
  → On success, Garmin redirects iframe to:
       https://training.helgars.se/api/garmin/ticket-receiver?ticket=ST-...
  → ticket-receiver returns minimal HTML:
       <script>window.parent.postMessage({garminTicket: "ST-..."}, "*")</script>
  → Settings page postMessage listener receives ticket
  → Settings page POSTs ticket to /api/garmin/exchange-ticket (server-side)
  → Server exchanges ST-ticket → OAuth1 → OAuth2 (not bot-detected — pure API)
  → Tokens stored encrypted in GarminAccount
  → Settings page shows "✓ Connected as [name]"
```

**Why this works:**
- Garmin SSO runs in the user's real browser (home IP, genuine TLS fingerprint, real cookies)
- `/sso/embed` IS designed for third-party iframe embedding
- Token exchange (OAuth1/OAuth2) is a pure server-to-server API call — different detection rules
- No credentials touch our server at all

**Unknowns / contingencies:**
- If Garmin's embed endpoint sets `X-Frame-Options: SAMEORIGIN` → iframe fails silently.
  Mitigation: render a fallback button pointing to a popup window instead.
- If Garmin rejects our `service=` URL in embed mode (whitelist) → ticket-receiver won't be called.
  Mitigation: also listen for postMessage from sso.garmin.com (Garmin's embed widget may post back directly).

### Secondary: Mobile JSON API (server-side fallback)

Replace the broken HTML form flow with the new mobile endpoint.

**New flow:**
```
GET  sso.garmin.com/mobile/sso/en/sign-in  → session cookies
POST sso.garmin.com/mobile/api/login
     ?clientId=GCM_ANDROID_DARK&locale=en-US
      &service=https://mobile.integration.garmin.com/gcm/android
     body: {"username": email, "password": password, "rememberMe": false, "captchaToken": ""}
     UA:   Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15...

Response (HTTP 200 JSON):
  {serviceTicketId: "ST-...", responseStatus: {type: "SUCCESSFUL"}}
  or {responseStatus: {type: "INVALID_USERNAME_PASSWORD"}}
  or {responseStatus: {type: "MFA_REQUIRED"}}
  or HTTP 403/429 (bot-detected)

→ Exchange ST-ticket → OAuth1 (connectapi.garmin.com/oauth-service/oauth/preauthorized)
→ OAuth1 → OAuth2 (connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0)
```

**Anti-WAF measures:**
- 2–5 s random delay between GET sign-in page and POST credentials
- iPhone UA header on both requests
- Retry up to 3 times on 429 (with exponential backoff)

This fallback is provided for users who:
- Can't see the iframe (iframe blocked by X-Frame-Options)
- Prefer not to log into Garmin in our UI

---

## Implementation Steps

### 1. New: `/api/garmin/ticket-receiver` endpoint
- Returns 200 with tiny HTML: `<script>window.parent.postMessage({garminTicket: params.ticket}, "*")</script>`
- Also handles `?error=...` from Garmin

### 2. New: `/api/garmin/exchange-ticket` endpoint  
- POST `{ticket: "ST-..."}` from browser (requires valid session)
- Calls `ticketToOAuth1(ticket, jar)` → `oauth1ToOAuth2(...)` → stores encrypted in GarminAccount
- Returns `{ok: true, displayName}`

### 3. Update `GarminConnectSection` component
- Remove blue "Connect with Garmin" link (broken OAuth redirect)
- Add iframe-based SSO component (hidden until user clicks button)
- Listen for `message` event from `sso.garmin.com`
- On message received: POST to `/api/garmin/exchange-ticket`
- Collapsible manual form remains as fallback

### 4. Update `lib/garmin/auth.ts` server-side
- Add mobile JSON API login flow (`/mobile/api/login`)
- Use as fallback if iframe approach isn't used
- Add delays and retries for bot-detection mitigation

### 5. Update `docs/integrations/strava.md` Garmin section

---

## Files to Change

| File | Change |
|---|---|
| `app/api/garmin/ticket-receiver/route.ts` | New: returns HTML with postMessage |
| `app/api/garmin/exchange-ticket/route.ts` | New: exchanges ST-ticket for tokens |
| `app/(dashboard)/settings/garmin-connect.tsx` | Rewrite: iframe SSO + postMessage listener |
| `lib/garmin/auth.ts` | Add mobile JSON API flow, export `ticketToOAuth1` |
| `docs/integrations/strava.md` | Update Garmin section |

---

## What to Archive

Move current broken approach notes to `docs/planning/archive/`.
The IMPLEMENTATION_PLAN.md session entries stay (they're history, not plans).
