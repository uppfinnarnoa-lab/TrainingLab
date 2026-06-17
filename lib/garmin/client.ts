// Garmin Connect API client — uses unofficial OAuth2 tokens stored in GarminAccount.
// Call getGarminToken(userId) to get a valid Bearer token (auto-refreshes if needed).

import { prisma } from "@/lib/db/prisma";
import { encrypt, safeDecrypt } from "@/lib/encrypt";
import { refreshGarminTokens } from "./auth";

const CONNECT_API = "https://connectapi.garmin.com";

/** Returns a valid Bearer token for userId, refreshing it if it's within 60 s of expiry. */
export async function getGarminToken(userId: string): Promise<string> {
  const account = await prisma.garminAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("GARMIN_NOT_CONNECTED");

  const accessToken = safeDecrypt(account.accessToken);
  if (!accessToken) throw new Error("Failed to decrypt Garmin access token");

  // Return current token if it still has > 60 s left
  if (account.expiresAt > new Date(Date.now() + 60_000)) return accessToken;

  // Refresh
  const refreshToken = safeDecrypt(account.refreshToken);
  if (!refreshToken) throw new Error("Failed to decrypt Garmin refresh token");

  const tokens = await refreshGarminTokens(refreshToken);

  await prisma.garminAccount.update({
    where: { userId },
    data: {
      accessToken:  encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt:    tokens.expiresAt,
    },
  });

  return tokens.accessToken;
}

/** Fetch a Garmin Connect API endpoint for the given userId. */
export async function garminConnectFetch(
  userId: string,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const token = await getGarminToken(userId);
  const url   = new URL(`${CONNECT_API}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Garmin Connect API error: ${res.status} ${path}`);
  return res.json();
}
