/**
 * Cron-triggered sync endpoint. Call with:
 *   POST /api/cron/sync
 *   Authorization: Bearer <CRON_SECRET from .env.local>
 *
 * Example crontab (midnight local time every day):
 *   0 0 * * * curl -s -X POST https://yourdomain.com/api/cron/sync \
 *               -H "Authorization: Bearer YOUR_CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { syncActivities } from "@/lib/strava/sync";
import { updateVO2maxAndPaces } from "@/lib/fitness/cache";
import { backfillWeather } from "@/lib/weather/backfill";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sync all users that have cron auto-sync enabled
  const configs = await prisma.appConfig.findMany({
    where: { stravaAutoSyncMode: "cron" },
    select: { userId: true },
  });

  const results: { userId: string; synced?: number; error?: string }[] = [];

  for (const { userId } of configs) {
    const account = await prisma.stravaAccount.findUnique({ where: { userId } });
    if (!account) continue;

    try {
      const since = account.lastSyncAt ?? undefined;
      const result = await syncActivities(userId, { since });
      updateVO2maxAndPaces(userId).catch(e => console.error(`[cron] Fitness cache error for user ${userId}:`, e));
      backfillWeather(userId, 50).catch(e => console.error(`[cron] Weather backfill error for user ${userId}:`, e));
      results.push({ userId, synced: result.synced });
    } catch (e) {
      results.push({ userId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
