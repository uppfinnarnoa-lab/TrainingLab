import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "@/lib/strava/client";

const PER_WINDOW     = 170; // stay under Strava's 200 req/15-min limit
const WINDOW_MS      = 15 * 60_000;
const BETWEEN_REQ_MS = 350;

/** GET — current backfill progress */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [total, done] = await Promise.all([
    prisma.activity.count({ where: { userId } }),
    prisma.activity.count({ where: { userId, splitDetailFetched: true } }),
  ]);

  return NextResponse.json({ total, done, remaining: total - done });
}

/** POST — SSE stream: fetch individual detail for every unfetched activity */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pending = await prisma.activity.findMany({
          where: { userId, splitDetailFetched: false },
          orderBy: { startDate: "asc" },
          select: { id: true, stravaId: true, name: true },
        });

        const total = pending.length;
        controller.enqueue(send({ type: "start", total }));

        let done = 0, errors = 0;
        let windowStart = Date.now();
        let windowCount = 0;

        for (const act of pending) {
          // Wait out the 15-minute window when approaching the limit
          if (windowCount >= PER_WINDOW) {
            const elapsed = Date.now() - windowStart;
            const waitMs  = Math.max(0, WINDOW_MS - elapsed + 5_000);
            controller.enqueue(send({ type: "rate_limit", waitMs, done, total, errors }));
            await new Promise(r => setTimeout(r, waitMs));
            windowStart = Date.now();
            windowCount = 0;
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const full: any = await stravaFetch(userId, `/activities/${act.stravaId}`);

            await prisma.activity.update({
              where: { id: act.id },
              data: {
                name:                  full.name                   ?? undefined,
                description:           full.description            ?? null,
                averageHeartrate:      full.average_heartrate      ?? null,
                maxHeartrate:          full.max_heartrate          ?? null,
                averageSpeed:          full.average_speed          ?? undefined,
                averageCadence:        full.average_cadence        ?? null,
                averageWatts:          full.average_watts          ?? null,
                weightedAverageWatts:  full.weighted_average_watts ?? null,
                totalElevationGain:    full.total_elevation_gain   ?? undefined,
                mapPolyline:           full.map?.summary_polyline  ?? null,
                workoutType:           full.workout_type           ?? null,
                isRace:                full.workout_type === 1,
                sufferScore:           full.suffer_score           ?? null,
                perceivedExertion:     full.perceived_exertion     ?? null,
                splitsMetric:          full.splits_metric          || undefined,
                bestEfforts:           full.best_efforts           || undefined,
                laps:                  full.laps                   || undefined,
                splitDetailFetched:    true,
              },
            });

            done++;
            windowCount++;
            if (done % 10 === 0 || done === total) {
              controller.enqueue(send({ type: "progress", done, total, errors }));
            }

            await new Promise(r => setTimeout(r, BETWEEN_REQ_MS));
          } catch (e) {
            if (e instanceof Error && e.message === "STRAVA_RATE_LIMIT") {
              // Daily limit hit — stop gracefully; user resumes tomorrow
              controller.enqueue(send({ type: "daily_limit", done, total, errors }));
              controller.close();
              return;
            }
            errors++;
            windowCount++;
            console.error(`[backfill-history] ${act.stravaId} (${act.name}):`, e);
            await new Promise(r => setTimeout(r, 1_000));
          }
        }

        controller.enqueue(send({ type: "done", done, errors, total }));
        controller.close();
      } catch (e) {
        controller.enqueue(send({ type: "error", message: String(e) }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
