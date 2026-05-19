import cron from "node-cron";
import { prisma } from "@/lib/db/prisma";
import { syncActivities } from "@/lib/strava/sync";
import { syncGarminDaily } from "@/lib/garmin/sync";
import { backfillWeather } from "@/lib/weather/backfill";

let started = false;

export function startCronJobs() {
  if (started) return;
  started = true;

  // Daily Strava sync at 06:00
  cron.schedule("0 6 * * *", async () => {
    console.log("[cron] Starting daily Strava sync");
    const accounts = await prisma.stravaAccount.findMany({ select: { userId: true, lastSyncAt: true } });
    for (const account of accounts) {
      try {
        const since = account.lastSyncAt ?? undefined;
        const result = await syncActivities(account.userId, { since });
        console.log(`[cron] Strava sync ${account.userId}: ${result.synced} new activities`);
      } catch (e) {
        console.error(`[cron] Strava sync failed for ${account.userId}:`, e);
      }
    }
  });

  // Daily Garmin sync at 08:00 (after overnight data is processed)
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Starting daily Garmin sync");
    const accounts = await prisma.garminAccount.findMany({ select: { userId: true } });
    for (const account of accounts) {
      try {
        await syncGarminDaily(account.userId);
        console.log(`[cron] Garmin sync ${account.userId}: done`);
      } catch (e) {
        console.error(`[cron] Garmin sync failed for ${account.userId}:`, e);
      }
    }
  });

  // Weather backfill at 07:00 — 50 activities per run (gentle on API)
  cron.schedule("0 7 * * *", async () => {
    console.log("[cron] Starting weather backfill");
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      try {
        const updated = await backfillWeather(user.id, 50);
        if (updated > 0) console.log(`[cron] Weather backfill ${user.id}: ${updated} updated`);
      } catch (e) {
        console.error(`[cron] Weather backfill failed for ${user.id}:`, e);
      }
    }
  });

  console.log("[cron] All jobs scheduled");
}
