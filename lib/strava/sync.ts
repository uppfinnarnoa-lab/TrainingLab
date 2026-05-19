import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "./client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapActivity(raw: any, userId: string) {
  return {
    id: String(raw.id),
    userId,
    stravaId: BigInt(raw.id),
    name: raw.name ?? "Untitled",
    description: raw.description ?? null,
    sportType: raw.sport_type ?? raw.type ?? "Unknown",
    startDate: new Date(raw.start_date),
    startDateLocal: new Date(raw.start_date_local),
    timezone: raw.timezone ?? "UTC",
    distance: raw.distance ?? 0,
    movingTime: raw.moving_time ?? 0,
    elapsedTime: raw.elapsed_time ?? 0,
    totalElevationGain: raw.total_elevation_gain ?? 0,
    averageSpeed: raw.average_speed ?? null,
    maxSpeed: raw.max_speed ?? null,
    averageCadence: raw.average_cadence ?? null,
    averageWatts: raw.average_watts ?? null,
    weightedAverageWatts: raw.weighted_average_watts ?? null,
    averageHeartrate: raw.average_heartrate ?? null,
    maxHeartrate: raw.max_heartrate ?? null,
    sufferScore: raw.suffer_score ?? null,
    perceivedExertion: raw.perceived_exertion ?? null,
    workoutType: raw.workout_type ?? null,
    isRace: raw.workout_type === 1,
    mapPolyline: raw.map?.summary_polyline ?? null,
    splitsMetric: raw.splits_metric ?? null,
    laps: raw.laps ?? null,
    bestEfforts: raw.best_efforts ?? null,
  };
}

export async function syncActivities(
  userId: string,
  options: { full?: boolean; since?: Date } = {}
): Promise<{ synced: number; errors: number }> {
  let page = 1;
  let synced = 0;
  let errors = 0;
  const perPage = 200;

  const after = options.since ? Math.floor(options.since.getTime() / 1000) : undefined;

  while (true) {
    const params: Record<string, string> = {
      per_page: String(perPage),
      page: String(page),
    };
    if (after) params.after = String(after);

    let activities;
    try {
      activities = await stravaFetch(userId, "/athlete/activities", params);
    } catch (e) {
      if (e instanceof Error && e.message === "STRAVA_RATE_LIMIT") {
        console.warn("Strava rate limit hit, stopping sync");
        break;
      }
      throw e;
    }

    if (!Array.isArray(activities) || activities.length === 0) break;

    for (const raw of activities) {
      try {
        const data = mapActivity(raw, userId);
        await prisma.activity.upsert({
          where: { stravaId: data.stravaId },
          create: data,
          update: {
            name: data.name,
            description: data.description,
            averageHeartrate: data.averageHeartrate,
            maxHeartrate: data.maxHeartrate,
            sufferScore: data.sufferScore,
            perceivedExertion: data.perceivedExertion,
          },
        });
        synced++;
      } catch {
        errors++;
      }
    }

    if (activities.length < perPage) break;
    page++;

    // Respect rate limit: ~200 req/15min = ~1 req/4.5s
    // For bulk sync we add a small delay every page
    await new Promise((r) => setTimeout(r, 1000));
  }

  await prisma.stravaAccount.update({
    where: { userId },
    data: { lastSyncAt: new Date(), totalSynced: { increment: synced } },
  });

  return { synced, errors };
}
