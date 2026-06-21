// Garmin Connect API client — uses unofficial OAuth2 tokens stored in GarminAccount.
// Call getGarminToken(userId) to get a valid Bearer token (auto-refreshes if needed).

import { prisma } from "@/lib/db/prisma";
import { encrypt, safeDecrypt } from "@/lib/encrypt";
import { reexchangeOAuth2 } from "./auth";

const CONNECT_API = "https://connectapi.garmin.com";

/** Returns a valid Bearer token for userId, re-exchanging it if it's within 60 s of expiry. */
export async function getGarminToken(userId: string): Promise<string> {
  const account = await prisma.garminAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("GARMIN_NOT_CONNECTED");

  const accessToken = safeDecrypt(account.accessToken);
  if (!accessToken) throw new Error("Failed to decrypt Garmin access token");

  // Return current token if it still has > 60 s left
  if (account.expiresAt > new Date(Date.now() + 60_000)) return accessToken;

  // Garmin has no OAuth2 refresh_token grant — re-exchange the long-lived OAuth1
  // token/secret pair for a fresh access token instead (see reexchangeOAuth2).
  const oauth1Token  = safeDecrypt(account.oauth1Token);
  const oauth1Secret = safeDecrypt(account.oauth1Secret);
  if (!oauth1Token || !oauth1Secret) throw new Error("GARMIN_REAUTH_REQUIRED");

  const tokens = await reexchangeOAuth2(oauth1Token, oauth1Secret);

  await prisma.garminAccount.update({
    where: { userId },
    data: {
      accessToken: encrypt(tokens.accessToken),
      expiresAt:   tokens.expiresAt,
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
