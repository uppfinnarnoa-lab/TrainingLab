// Resolve integration credentials: DB first, env vars as fallback.
// This lets users configure everything via the Settings UI.

import { prisma } from "@/lib/db/prisma";
import { safeDecrypt } from "@/lib/encrypt";

export interface AppCredentials {
  stravaClientId:     string;
  stravaClientSecret: string;
  garminClientId:     string;
  garminClientSecret: string;
}

// Per-userId cache — avoids a DB hit on every API call
const _cache = new Map<string, { creds: AppCredentials; at: number }>();
const CACHE_TTL_MS = 30_000;

export async function getCredentials(userId: string): Promise<AppCredentials> {
  const hit = _cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.creds;

  // Try user's own config first, then fall back to the admin's config
  let config = await prisma.appConfig.findUnique({ where: { userId } });
  if (!config) {
    // Non-admin users use the shared admin-level API credentials
    const adminUser = await prisma.user.findFirst({ where: { isAdmin: true }, select: { id: true } });
    if (adminUser && adminUser.id !== userId) {
      config = await prisma.appConfig.findUnique({ where: { userId: adminUser.id } });
    }
  }

  const creds: AppCredentials = {
    stravaClientId:     config?.stravaClientId || process.env.STRAVA_CLIENT_ID || "",
    stravaClientSecret: (safeDecrypt(config?.stravaClientSecret) ?? config?.stravaClientSecret) || process.env.STRAVA_CLIENT_SECRET || "",
    garminClientId:     config?.garminClientId || process.env.GARMIN_CLIENT_ID || "",
    garminClientSecret: (safeDecrypt(config?.garminClientSecret) ?? config?.garminClientSecret) || process.env.GARMIN_CLIENT_SECRET || "",
  };

  _cache.set(userId, { creds, at: Date.now() });
  return creds;
}

// Invalidate cache when credentials are updated
export function invalidateCredentialsCache() {
  _cache.clear();
}
