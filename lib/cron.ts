import cron from "node-cron";
import { prisma } from "@/lib/db/prisma";
import { syncActivities } from "@/lib/strava/sync";
import { backfillRunner } from "@/lib/strava/backfill-runner";
import { syncGarminDaily } from "@/lib/garmin/sync";
import { backfillWeather } from "@/lib/weather/backfill";

let started = false;

export function startCronJobs() {
  if (started) return;
  started = true;

  // Daily Strava sync at 06:00 — incremental, 1-2 API calls
  cron.schedule("0 6 * * *", async () => {
    const accounts = await prisma.stravaAccount.findMany({ select: { userId: true, lastSyncAt: true } });
    for (const account of accounts) {
      try {
        const since = account.lastSyncAt ?? undefined;
        const result = await syncActivities(account.userId, { since });
        if (result.synced > 0)
          console.log(`[cron] Strava sync ${account.userId}: ${result.synced} new activities`);
      } catch (e) {
        console.error(`[cron] Strava sync failed for ${account.userId}:`, e);
      }
    }
  });

  // Garmin sync at 08:00 — syncs YESTERDAY so overnight sleep/HRV data is ready
  cron.schedule("0 8 * * *", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    console.log("[cron] Starting Garmin morning sync (yesterday's sleep/HRV)");
    const accounts = await prisma.garminAccount.findMany({ select: { userId: true } });
    for (const account of accounts) {
      try {
        await syncGarminDaily(account.userId, yesterday);
        console.log(`[cron] Garmin morning sync ${account.userId}: done`);
      } catch (e) {
        console.error(`[cron] Garmin morning sync failed for ${account.userId}:`, e);
      }
    }
  });

  // Garmin sync at 20:00 — syncs TODAY so daily steps/stress/body-battery/readiness
  // accumulated during the day are captured. Also re-syncs yesterday in case any
  // fields arrived late (e.g. training readiness sometimes lags a few hours).
  cron.schedule("0 20 * * *", async () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    console.log("[cron] Starting Garmin evening sync (today + yesterday catch-up)");
    const accounts = await prisma.garminAccount.findMany({ select: { userId: true } });
    for (const account of accounts) {
      try {
        await syncGarminDaily(account.userId, today);
        await syncGarminDaily(account.userId, yesterday);
        console.log(`[cron] Garmin evening sync ${account.userId}: done`);
      } catch (e) {
        console.error(`[cron] Garmin evening sync failed for ${account.userId}:`, e);
      }
    }
  });

  // Historical activity backfill at 00:30 UTC (just after Strava's daily limit resets at midnight)
  // Goes through backfillRunner.startIfIdle() — cannot run concurrently with a user-triggered
  // backfill for the same account. A daily-limit hit ends the run immediately; this tick picks
  // it up the next night from where it left off.
  cron.schedule("30 0 * * *", async () => {
    const accounts = await prisma.stravaAccount.findMany({ select: { userId: true } });
    for (const account of accounts) {
      const remaining = await prisma.activity.count({
        where: { userId: account.userId, OR: [{ splitDetailFetched: false }, { stream: null }] },
      });
      if (remaining === 0) continue;
      const started = backfillRunner.startIfIdle(account.userId);
      console.log(`[cron] Historical backfill ${account.userId}: ${remaining} remaining, started=${started}`);
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
