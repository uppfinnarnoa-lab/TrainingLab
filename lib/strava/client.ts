import { prisma } from "@/lib/db/prisma";
import { getCredentials } from "@/lib/config";
import { generateOAuthState } from "@/lib/oauth-state";
import { encrypt, safeDecrypt } from "@/lib/encrypt";

const STRAVA_BASE = "https://www.strava.com/api/v3";
const TOKEN_URL   = "https://www.strava.com/oauth/token";

// Deduplicates concurrent refresh requests for the same userId so only one
// network call goes to Strava when parallel requests all see an expired token.
const refreshingTokens = new Map<string, Promise<string>>();

export async function getStravaAuthUrl(userId: string, redirectUri: string): Promise<string> {
  const creds = await getCredentials(userId);
  if (!creds.stravaClientId) throw new Error("STRAVA_NOT_CONFIGURED");
  const params = new URLSearchParams({
    client_id:     creds.stravaClientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "read,activity:read_all",
    state:         generateOAuthState(userId),
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeStravaCode(userId: string, code: string, redirectUri: string) {
  const creds = await getCredentials(userId);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     creds.stravaClientId,
      client_secret: creds.stravaClientSecret,
      code,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshStravaToken(userId: string): Promise<string> {
  const existing = refreshingTokens.get(userId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const [account, creds] = await Promise.all([
      prisma.stravaAccount.findUnique({ where: { userId } }),
      getCredentials(userId),
    ]);
    if (!account) throw new Error("No Strava account");

    if (account.expiresAt > new Date(Date.now() + 60_000))
      return safeDecrypt(account.accessToken) ?? account.accessToken;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     creds.stravaClientId,
        client_secret: creds.stravaClientSecret,
        refresh_token: safeDecrypt(account.refreshToken) ?? account.refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
    const data = await res.json();

    await prisma.stravaAccount.update({
      where: { userId },
      data: {
        accessToken:  encrypt(data.access_token),
        refreshToken: encrypt(data.refresh_token),
        expiresAt:    new Date(data.expires_at * 1000),
      },
    });
    return data.access_token as string;
  })().finally(() => refreshingTokens.delete(userId));

  refreshingTokens.set(userId, refreshPromise);
  return refreshPromise;
}

export async function stravaFetch(userId: string, path: string, params?: Record<string, string>) {
  const token = await refreshStravaToken(userId);
  const url = new URL(`${STRAVA_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const usage = res.headers.get("X-RateLimit-Usage") ?? "";
    const limit = res.headers.get("X-RateLimit-Limit") ?? "";
    const [, dailyUsage] = usage.split(",").map(Number);
    const [, dailyLimit] = limit.split(",").map(Number);
    if (dailyLimit > 0 && dailyUsage >= dailyLimit) throw new Error("STRAVA_DAILY_LIMIT");
    throw new Error("STRAVA_RATE_LIMIT");
  }
  if (!res.ok) throw new Error(`Strava API error: ${res.status} ${path}`);
  return res.json();
}
