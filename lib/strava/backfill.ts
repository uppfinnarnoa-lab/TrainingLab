import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "./client";
import { backfillOneActivityStream } from "./stream-backfill";

const PER_WINDOW     = 170;
const WINDOW_MS      = 15 * 60_000;
const BETWEEN_REQ_MS = 350;

export type Signal = "none" | "pause" | "stop";

export type BackfillEvent =
  | { type: "start";       total: number }
  | { type: "progress";    done: number; total: number; errors: number }
  | { type: "rate_limit";  done: number; total: number; errors: number; waitMs: number }
  | { type: "daily_limit"; done: number; total: number; errors: number; waitMs: number }
  | { type: "paused";      done: number; total: number; errors: number }
  | { type: "resumed";     done: number; total: number; errors: number }
  | { type: "stopped";     done: number; total: number; errors: number }
  | { type: "done";        done: number; total: number; errors: number };

export interface BackfillResult {
  done: number;
  total: number;
  errors: number;
  stoppedAt: "complete" | "stopped";
}

function msUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60_000, midnight.getTime() - now.getTime());
}

// Waits for `ms`, checking signal every 2s. Returns "stopped" if signal demands it.
async function interruptibleWait(
  ms: number,
  getSignal: (() => Signal) | undefined,
  onPause:   () => void,
  onResumed: () => void,
): Promise<"continue" | "stopped"> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const sig = getSignal?.() ?? "none";
    if (sig === "stop") return "stopped";
    if (sig === "pause") {
      onPause();
      while ((getSignal?.() ?? "none") === "pause") {
        await new Promise(r => setTimeout(r, 500));
      }
      if ((getSignal?.() ?? "none") === "stop") return "stopped";
      onResumed();
    }
    await new Promise(r => setTimeout(r, Math.min(2_000, Math.max(0, end - Date.now()))));
  }
  return "continue";
}

export async function runHistoricalBackfill(
  userId: string,
  onProgress?: (event: BackfillEvent) => void,
  getSignal?:  () => Signal,
): Promise<BackfillResult> {
  // Needs detail backfill, stream backfill, or both — splitDetailFetched alone used to be a
  // correct "is there anything to do for this activity" gate before streams were added to
  // this backfill (2026-06-26). A user who already completed a full backfill before that
  // change would otherwise have nothing match this query forever, despite never having
  // fetched streams for their history (the `stream` relation is null for every activity
  // until ensureActivityStreams()/this backfill actually fetches one).
  const fetched = await prisma.activity.findMany({
    where:   { userId, OR: [{ splitDetailFetched: false }, { stream: null }] },
    orderBy: { startDate: "desc" },
    select:  { id: true, stravaId: true, name: true, startDate: true, splitDetailFetched: true, stream: { select: { activityId: true } } },
  });

  // Process activities from the last 90 days before older ones so recent data
  // is available quickly even during a long initial backfill.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const pending = [...fetched].sort((a, b) => {
    const aRecent = new Date(a.startDate) >= ninetyDaysAgo;
    const bRecent = new Date(b.startDate) >= ninetyDaysAgo;
    if (aRecent && !bRecent) return -1;
    if (!aRecent && bRecent) return 1;
    return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  });

  const total = pending.length;
  onProgress?.({ type: "start", total });

  let done = 0, errors = 0;
  let windowStart = Date.now();
  let windowCount = 0;

  for (const act of pending) {
    // Signal check at start of each activity
    const sig = getSignal?.() ?? "none";
    if (sig === "stop") {
      onProgress?.({ type: "stopped", done, total, errors });
      return { done, total, errors, stoppedAt: "stopped" };
    }
    if (sig === "pause") {
      onProgress?.({ type: "paused", done, total, errors });
      while ((getSignal?.() ?? "none") === "pause") {
        await new Promise(r => setTimeout(r, 500));
      }
      if ((getSignal?.() ?? "none") === "stop") {
        onProgress?.({ type: "stopped", done, total, errors });
        return { done, total, errors, stoppedAt: "stopped" };
      }
      onProgress?.({ type: "resumed", done, total, errors });
    }

    // Proactive 15-min window limit
    if (windowCount >= PER_WINDOW) {
      const elapsed = Date.now() - windowStart;
      const waitMs  = Math.max(0, WINDOW_MS - elapsed + 5_000);
      onProgress?.({ type: "rate_limit", done, total, errors, waitMs });
      const r = await interruptibleWait(waitMs, getSignal,
        () => onProgress?.({ type: "paused",  done, total, errors }),
        () => onProgress?.({ type: "resumed", done, total, errors }),
      );
      if (r === "stopped") {
        onProgress?.({ type: "stopped", done, total, errors });
        return { done, total, errors, stoppedAt: "stopped" };
      }
      windowStart = Date.now();
      windowCount = 0;
    }

    // Fetch with automatic retry on rate limits
    let retrying = true;
    while (retrying) {
      retrying = false;
      try {
        if (!act.splitDetailFetched) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const full: any = await stravaFetch(userId, `/activities/${act.stravaId}`);

          await prisma.activity.update({
            where: { id: act.id },
            data: {
              name:                 full.name                   ?? undefined,
              description:          full.description            ?? null,
              averageHeartrate:     full.average_heartrate      ?? null,
              maxHeartrate:         full.max_heartrate          ?? null,
              averageSpeed:         full.average_speed          ?? undefined,
              averageCadence:       full.average_cadence        ?? null,
              averageWatts:         full.average_watts          ?? null,
              weightedAverageWatts: full.weighted_average_watts ?? null,
              totalElevationGain:   full.total_elevation_gain   ?? undefined,
              mapPolyline:          full.map?.summary_polyline  ?? null,
              workoutType:          full.workout_type           ?? null,
              isRace:               full.workout_type === 1,
              sufferScore:          full.suffer_score           ?? null,
              perceivedExertion:    full.perceived_exertion     ?? null,
              splitsMetric:         full.splits_metric          || undefined,
              bestEfforts:          full.best_efforts           || undefined,
              laps:                 full.laps                   || undefined,
              splitDetailFetched:   true,
            },
          });
          windowCount++;
          await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
        }

        // Also cache the full stream (time/distance/heartrate/velocity/altitude/cadence) for
        // this activity, if it doesn't have one yet — best-effort: the detail data above is
        // the primary goal of this backfill, so a stream-fetch failure (e.g. no stream data
        // for this activity at all) doesn't fail it. A rate/daily limit must propagate to the
        // same pause/retry handling as the detail fetch above, or the two calls would respond
        // to limits inconsistently.
        if (!act.stream) {
          try {
            await backfillOneActivityStream(userId, act.id, act.stravaId);
            windowCount++; // a request consumed from this window's budget
            await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
          } catch (streamErr) {
            if (streamErr instanceof Error && (streamErr.message === "STRAVA_RATE_LIMIT" || streamErr.message === "STRAVA_DAILY_LIMIT")) {
              throw streamErr;
            }
            console.error(`[backfill] stream fetch failed for ${act.stravaId} (non-fatal):`, streamErr);
          }
        }

        done++;
        windowCount++;
        if (done % 10 === 0 || done === total) {
          onProgress?.({ type: "progress", done, total, errors });
        }
        await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
      } catch (e) {
        if (e instanceof Error && e.message === "STRAVA_DAILY_LIMIT") {
          const waitMs = msUntilMidnightUTC();
          onProgress?.({ type: "daily_limit", done, total, errors, waitMs });
          const r = await interruptibleWait(waitMs, getSignal,
            () => onProgress?.({ type: "paused",  done, total, errors }),
            () => onProgress?.({ type: "resumed", done, total, errors }),
          );
          if (r === "stopped") {
            onProgress?.({ type: "stopped", done, total, errors });
            return { done, total, errors, stoppedAt: "stopped" };
          }
          windowStart = Date.now();
          windowCount = 0;
          retrying = true; // retry this activity after reset
          continue;
        }

        if (e instanceof Error && e.message === "STRAVA_RATE_LIMIT") {
          const elapsed = Date.now() - windowStart;
          const waitMs  = Math.max(WINDOW_MS + 5_000, WINDOW_MS - elapsed + 5_000);
          onProgress?.({ type: "rate_limit", done, total, errors, waitMs });
          const r = await interruptibleWait(waitMs, getSignal,
            () => onProgress?.({ type: "paused",  done, total, errors }),
            () => onProgress?.({ type: "resumed", done, total, errors }),
          );
          if (r === "stopped") {
            onProgress?.({ type: "stopped", done, total, errors });
            return { done, total, errors, stoppedAt: "stopped" };
          }
          windowStart = Date.now();
          windowCount = 0;
          retrying = true; // retry this activity
          continue;
        }

        errors++;
        windowCount++;
        console.error(`[backfill] ${act.stravaId} (${act.name}):`, e);
        await new Promise(r => setTimeout(r, 1_000));
      }
    }
  }

  onProgress?.({ type: "done", done, total, errors });
  return { done, total, errors, stoppedAt: "complete" };
}
