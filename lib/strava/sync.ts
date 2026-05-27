import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "./client";
import { fetchAndSaveWeather } from "@/lib/weather/open-meteo";

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
    splitDetailFetched: false, // overridden to true when fetched from detail endpoint
    startLat: Array.isArray(raw.start_latlng) && raw.start_latlng.length >= 2 ? (raw.start_latlng[0] as number) : null,
    startLng: Array.isArray(raw.start_latlng) && raw.start_latlng.length >= 2 ? (raw.start_latlng[1] as number) : null,
  };
}

export async function syncActivities(
  userId: string,
  options: { full?: boolean; since?: Date } = {}
): Promise<{ synced: number; errors: number; rateLimited?: "STRAVA_RATE_LIMIT" | "STRAVA_DAILY_LIMIT" }> {
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
      if (e instanceof Error && (e.message === "STRAVA_RATE_LIMIT" || e.message === "STRAVA_DAILY_LIMIT")) {
        console.warn("Strava rate limit hit during sync:", e.message);
        return { synced, errors, rateLimited: e.message as "STRAVA_RATE_LIMIT" | "STRAVA_DAILY_LIMIT" };
      }
      throw e;
    }

    if (!Array.isArray(activities) || activities.length === 0) break;

    for (const raw of activities) {
      try {
        const stravaId = BigInt(raw.id);
        const exists = await prisma.activity.findUnique({
          where: { stravaId },
          select: { stravaId: true },
        });

        let fullRaw = raw;
        let detailFetched = false;
        if (!exists) {
          // New activity — fetch individually to get description, splits, best efforts
          try {
            fullRaw = await stravaFetch(userId, `/activities/${raw.id}`);
            detailFetched = true;
            await new Promise(r => setTimeout(r, 300)); // rate limit safety
          } catch {
            fullRaw = raw;
          }
        }

        const data = { ...mapActivity(fullRaw, userId), splitDetailFetched: detailFetched };
        const saved = await prisma.activity.upsert({
          where: { stravaId: data.stravaId },
          create: data,
          update: {
            name: data.name,
            description: data.description,
            averageHeartrate: data.averageHeartrate,
            maxHeartrate: data.maxHeartrate,
            sufferScore: data.sufferScore,
            perceivedExertion: data.perceivedExertion,
            startLat: data.startLat,
            startLng: data.startLng,
          },
        });
        // Fetch weather from Open-Meteo for new activities that have coordinates
        if (!exists && saved.startLat != null && saved.startLng != null && saved.weatherTemp == null) {
          fetchAndSaveWeather(saved.id, saved.startLat, saved.startLng, saved.startDate).catch(() => {});
        }
        synced++;
      } catch (e) {
        console.error("Activity upsert failed for stravaId", raw.id, e);
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

/**
 * Smart resync: fetch activities from last N days via paginated list,
 * then re-fetch each one individually to get updated description/notes/splits.
 * Used when user clicks the manual Sync button.
 */
export async function resyncRecentActivities(
  userId: string,
  days = 3,
): Promise<{ synced: number; updated: number; errors: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const after = Math.floor(since.getTime() / 1000);

  // Step 1: get list of recent activities from Strava
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRaw: any[] = await stravaFetch(userId, "/athlete/activities", { after: String(after), per_page: "30" });
  if (!Array.isArray(listRaw)) return { synced: 0, updated: 0, errors: 0 };

  let synced = 0, updated = 0, errors = 0;

  for (const summary of listRaw) {
    try {
      // Step 2: fetch full individual activity (includes description, splits, best efforts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const full: any = await stravaFetch(userId, `/activities/${summary.id}`);
      const data = mapActivity(full, userId);

      const existing = await prisma.activity.findUnique({
        where: { stravaId: data.stravaId },
        select: { description: true },
      });

      if (!existing) {
        // New activity — create it
        await prisma.activity.create({ data });
        synced++;
      } else if (existing.description !== data.description) {
        // Description has been updated — sync the new text and other fields
        await prisma.activity.update({
          where: { stravaId: data.stravaId },
          data: {
            name: data.name,
            description: data.description,
            splitsMetric: data.splitsMetric,
            bestEfforts: data.bestEfforts,
            sufferScore: data.sufferScore,
            perceivedExertion: data.perceivedExertion,
          },
        });
        updated++;
      }

      // Small delay to stay within Strava rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`[resync] Failed for activity ${summary.id}:`, e);
      errors++;
    }
  }

  await prisma.stravaAccount.update({
    where: { userId },
    data: { lastSyncAt: new Date(), totalSynced: { increment: synced } },
  });

  return { synced, updated, errors };
}

/**
 * Sync a single activity by its Strava ID.
 * Used by the webhook handler on activity.create / activity.update events.
 */
export async function syncSingleActivity(userId: string, stravaActivityId: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const full: any = await stravaFetch(userId, `/activities/${stravaActivityId}`);
  const data = { ...mapActivity(full, userId), splitDetailFetched: true };

  const saved = await prisma.activity.upsert({
    where: { stravaId: data.stravaId },
    create: data,
    update: {
      name: data.name,
      description: data.description,
      splitsMetric: data.splitsMetric,
      laps: data.laps,
      bestEfforts: data.bestEfforts,
      averageHeartrate: data.averageHeartrate,
      maxHeartrate: data.maxHeartrate,
      sufferScore: data.sufferScore,
      perceivedExertion: data.perceivedExertion,
      startLat: data.startLat,
      startLng: data.startLng,
    },
  });

  if (saved.startLat != null && saved.startLng != null && saved.weatherTemp == null) {
    fetchAndSaveWeather(saved.id, saved.startLat, saved.startLng, saved.startDate).catch(() => {});
  }
}

/**
 * Delete an activity from the DB when Strava pushes a delete event.
 */
export async function deleteStravaActivity(userId: string, stravaActivityId: number): Promise<void> {
  await prisma.activity.deleteMany({
    where: { userId, stravaId: BigInt(stravaActivityId) },
  });
}
