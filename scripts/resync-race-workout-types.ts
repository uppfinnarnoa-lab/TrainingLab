// One-off corrective resync: re-fetches every running activity from the last 90 days from
// Strava so isRace/workoutType/laps reflect Strava's CURRENT values, not whatever was synced
// the first time. Needed because lib/strava/sync.ts didn't refresh these fields on an
// already-existing activity until this fix — see docs/planning/Planerattköra/BUG_AUDIT_2026_06_25.md §2.
// Safe to re-run; syncSingleActivity() is an upsert.
//
// Run with: set -a && source .env.local && set +a && npx tsx scripts/resync-race-workout-types.ts
import { PrismaClient } from "@prisma/client";
import { syncSingleActivity } from "../lib/strava/sync";

const prisma = new PrismaClient();
const BETWEEN_REQ_MS = 350;

async function main() {
  const accounts = await prisma.stravaAccount.findMany({ select: { userId: true } });
  console.log(`Found ${accounts.length} Strava-connected user(s).`);

  for (const { userId } of accounts) {
    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        sportType: { contains: "run", mode: "insensitive" },
      },
      select: { stravaId: true, name: true },
      orderBy: { startDate: "asc" },
    });
    console.log(`User ${userId}: resyncing ${activities.length} activities from the last 90 days.`);

    let done = 0, errors = 0;
    for (const a of activities) {
      try {
        await syncSingleActivity(userId, Number(a.stravaId));
        done++;
      } catch (e) {
        console.error(`  failed: ${a.name} (${a.stravaId}):`, e instanceof Error ? e.message : e);
        errors++;
        if (e instanceof Error && (e.message === "STRAVA_RATE_LIMIT" || e.message === "STRAVA_DAILY_LIMIT")) {
          console.error("  rate limited — stopping this user's run early, re-run the script later to continue.");
          break;
        }
      }
      await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
    }
    console.log(`User ${userId}: done=${done} errors=${errors}`);
  }
}

main().finally(() => prisma.$disconnect());
