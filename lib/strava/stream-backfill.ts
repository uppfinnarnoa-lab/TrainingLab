import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "./client";
import type { ActivityHRStream } from "@/lib/fitness/zones";

const BETWEEN_REQ_MS = 350;
const STREAM_KEYS = "time,distance,heartrate,velocity_smooth,altitude,cadence";

/**
 * Read-only, fetch-free: returns whatever HR streams are ALREADY cached for the given
 * activities. Safe to call from a synchronous request/response path (no Strava API calls,
 * no per-request delay) — use this from updateHRZones() (awaited inside the "Apply zones"
 * button's request) and the stats page's live recompute path. Only ensureActivityStreams()
 * below (called from background-only paths) actually fetches new ones.
 */
export async function loadCachedHRStreams(activityIds: string[]): Promise<Map<string, ActivityHRStream>> {
  const map = new Map<string, ActivityHRStream>();
  if (activityIds.length === 0) return map;
  const rows = await prisma.activityStream.findMany({
    where: { activityId: { in: activityIds } },
    select: { activityId: true, time: true, heartrate: true },
  });
  for (const r of rows) {
    if (Array.isArray(r.heartrate) && r.heartrate.length > 0) {
      map.set(r.activityId, {
        time: Array.isArray(r.time) ? (r.time as number[]) : null,
        heartrate: r.heartrate as number[],
      });
    }
  }
  return map;
}

/**
 * Fetches and caches the full stream set (time/distance/heartrate/velocity/altitude/cadence
 * — same key set as the on-demand GET /api/activities/[id]/streams route) for one activity.
 * Always fetches the SAME full set everywhere a stream gets cached, so a row is never left
 * permanently partial — the on-demand route only checks "is a stream cached at all" before
 * skipping a fresh fetch, so a row missing distance/altitude/etc. would get stuck that way
 * forever once cached. Returns true if a stream was fetched and cached, false if Strava had
 * no heartrate data for this activity (nothing worth caching).
 */
async function fetchAndCacheStream(userId: string, activityId: string, stravaId: bigint): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streams: any = await stravaFetch(userId, `/activities/${stravaId}/streams`, {
    keys: STREAM_KEYS,
    key_by_type: "true",
  });
  const hrData = streams?.heartrate?.data as number[] | undefined;
  if (!hrData || hrData.length === 0) return false;
  await prisma.activityStream.upsert({
    where: { activityId },
    create: {
      activityId,
      time:      streams.time?.data,
      distance:  streams.distance?.data,
      altitude:  streams.altitude?.data,
      heartrate: hrData,
      velocity:  streams.velocity_smooth?.data,
      cadence:   streams.cadence?.data,
    },
    update: {
      time:      streams.time?.data,
      distance:  streams.distance?.data,
      altitude:  streams.altitude?.data,
      heartrate: hrData,
      velocity:  streams.velocity_smooth?.data,
      cadence:   streams.cadence?.data,
    },
  });
  return true;
}

/**
 * Ensures every given activity has a cached stream, fetching from Strava for any that don't
 * yet. Used to upgrade HR-zone time-in-zone (computeZoneTime in lib/fitness/zones.ts) from
 * lap-averages to actual per-second data. Idempotent — skips activities that already have a
 * cached stream, so repeated calls (e.g. every sync) only ever fetch the gap. A single
 * activity's fetch failing doesn't stop the rest; a rate limit stops the whole batch early
 * (the next call picks up wherever this one left off).
 *
 * Makes one Strava API call per missing activity (rate-limited with a delay between each) —
 * only ever call this from a background/fire-and-forget path (updateVO2maxAndPaces(), not
 * awaited by its callers per docs/api/strava.md), never from a synchronous request handler.
 */
export async function ensureActivityStreams(
  userId: string,
  activities: { id: string; stravaId: bigint }[],
): Promise<void> {
  if (activities.length === 0) return;

  const existing = await prisma.activityStream.findMany({
    where: { activityId: { in: activities.map(a => a.id) } },
    select: { activityId: true },
  });
  const have = new Set(existing.map((e: { activityId: string }) => e.activityId));
  const missing = activities.filter(a => !have.has(a.id));
  if (missing.length === 0) return;

  for (const a of missing) {
    try {
      await fetchAndCacheStream(userId, a.id, a.stravaId);
    } catch (e) {
      if (e instanceof Error && (e.message === "STRAVA_RATE_LIMIT" || e.message === "STRAVA_DAILY_LIMIT")) {
        console.warn("[stream-backfill] rate limited, stopping early — will resume next run:", e.message);
        return;
      }
      console.error(`[stream-backfill] failed for activity ${a.id} (strava ${a.stravaId}):`, e);
    }
    await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
  }
}

/**
 * Single-activity version for callers that already have their own rate-limit/retry loop
 * (lib/strava/backfill.ts's historical backfill) — just the fetch-and-cache, no looping or
 * delay of its own. Best-effort: throws on a genuine Strava error (rate limit etc.) so the
 * caller's existing retry logic handles it the same way as the activity-detail fetch does;
 * returns false (not an error) when Strava simply has no HR data for this activity.
 */
export async function backfillOneActivityStream(userId: string, activityId: string, stravaId: bigint): Promise<boolean> {
  return fetchAndCacheStream(userId, activityId, stravaId);
}
