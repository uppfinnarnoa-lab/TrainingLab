// Google Calendar OAuth + REST client — raw fetch, no SDK (matches lib/strava/client.ts
// and lib/garmin/* conventions in this codebase). See docs/integrations/google-calendar.md.
import { prisma } from "@/lib/db/prisma";
import { getCredentials } from "@/lib/config";
import { generateOAuthState } from "@/lib/oauth-state";
import { encrypt, safeDecrypt } from "@/lib/encrypt";

const AUTH_URL      = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL     = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export class GoogleCalendarNotFoundError extends Error {}

// Deduplicates concurrent refresh requests for the same userId, same pattern as
// lib/strava/client.ts's refreshStravaToken.
const refreshingTokens = new Map<string, Promise<string>>();

export async function getGoogleAuthUrl(userId: string, redirectUri: string): Promise<string> {
  const creds = await getCredentials(userId);
  if (!creds.googleClientId) throw new Error("GOOGLE_NOT_CONFIGURED");
  const params = new URLSearchParams({
    client_id:     creds.googleClientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         GOOGLE_CALENDAR_SCOPE,
    access_type:   "offline", // required to receive a refresh_token
    prompt:        "consent", // required to receive a refresh_token on every grant, not just the first
    state:         generateOAuthState(userId),
  });
  return `${AUTH_URL}?${params}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export async function exchangeGoogleCode(userId: string, code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const creds = await getCredentials(userId);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     creds.googleClientId,
      client_secret: creds.googleClientSecret,
      code,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshGoogleToken(userId: string): Promise<string> {
  const existing = refreshingTokens.get(userId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const [account, creds] = await Promise.all([
      prisma.googleCalendarAccount.findUnique({ where: { userId } }),
      getCredentials(userId),
    ]);
    if (!account) throw new Error("No Google Calendar account");

    if (account.expiresAt > new Date(Date.now() + 60_000))
      return safeDecrypt(account.accessToken) ?? account.accessToken;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     creds.googleClientId,
        client_secret: creds.googleClientSecret,
        refresh_token: safeDecrypt(account.refreshToken) ?? account.refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // invalid_grant: the user revoked access, or (Google "Testing" mode) the
      // refresh token expired after ~7 days — either way, only reconnecting fixes it.
      if (res.status === 400 && text.includes("invalid_grant")) {
        await prisma.googleCalendarAccount.update({ where: { userId }, data: { needsReconnect: true } });
      }
      throw new Error(`Google token refresh failed: ${res.status} ${text}`);
    }
    const data: GoogleTokenResponse = await res.json();

    // Google does not reissue refresh_token on a normal refresh — keep the existing one.
    await prisma.googleCalendarAccount.update({
      where: { userId },
      data: {
        accessToken: encrypt(data.access_token),
        expiresAt:   new Date(Date.now() + data.expires_in * 1000),
        needsReconnect: false,
      },
    });
    return data.access_token;
  })().finally(() => refreshingTokens.delete(userId));

  refreshingTokens.set(userId, refreshPromise);
  return refreshPromise;
}

/**
 * Calls the Calendar API v3 REST endpoint. Throws GoogleCalendarNotFoundError on a
 * 404 (caller decides how to handle a missing event) and retries 5xx/429 twice with
 * a short linear backoff before giving up.
 */
export async function googleCalendarFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<unknown> {
  const token = await refreshGoogleToken(userId);
  const res = await fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (res.status === 404) throw new GoogleCalendarNotFoundError(`Google Calendar 404: ${path}`);
  if ((res.status >= 500 || res.status === 429) && attempt < 2) {
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    return googleCalendarFetch(userId, path, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`Google Calendar API error: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null; // DELETE has no response body
  return res.json();
}
