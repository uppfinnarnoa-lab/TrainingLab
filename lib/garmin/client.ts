import { prisma } from "@/lib/db/prisma";
import { getCredentials } from "@/lib/config";
import { generateOAuthState } from "@/lib/oauth-state";

const GARMIN_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/token";
const GARMIN_BASE      = "https://apis.garmin.com/wellness-api/rest";

export async function getGarminAuthUrl(userId: string, redirectUri: string): Promise<string> {
  const creds = await getCredentials(userId);
  if (!creds.garminClientId) throw new Error("GARMIN_NOT_CONFIGURED");
  const params = new URLSearchParams({
    client_id:     creds.garminClientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "WELLNESS",
    state:         generateOAuthState(userId),
  });
  return `https://connect.garmin.com/oauth2Confirm?${params}`;
}

export async function exchangeGarminCode(userId: string, code: string, redirectUri: string) {
  const creds = await getCredentials(userId);
  const credentials = Buffer.from(`${creds.garminClientId}:${creds.garminClientSecret}`).toString("base64");

  const res = await fetch(GARMIN_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Garmin token exchange failed: ${res.status}`);
  return res.json();
}

async function refreshGarminToken(userId: string): Promise<string> {
  const [account, creds] = await Promise.all([
    prisma.garminAccount.findUnique({ where: { userId } }),
    getCredentials(userId),
  ]);
  if (!account) throw new Error("No Garmin account");
  if (account.expiresAt > new Date(Date.now() + 60_000)) return account.accessToken;

  const credentials = Buffer.from(`${creds.garminClientId}:${creds.garminClientSecret}`).toString("base64");
  const res = await fetch(GARMIN_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken }),
  });
  if (!res.ok) throw new Error(`Garmin token refresh failed: ${res.status}`);
  const data = await res.json();

  await prisma.garminAccount.update({
    where: { userId },
    data: {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token ?? account.refreshToken,
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
    },
  });
  return data.access_token;
}

export async function garminFetch(userId: string, path: string, params?: Record<string, string>) {
  const token = await refreshGarminToken(userId);
  const url = new URL(`${GARMIN_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Garmin API error: ${res.status} ${path}`);
  return res.json();
}
