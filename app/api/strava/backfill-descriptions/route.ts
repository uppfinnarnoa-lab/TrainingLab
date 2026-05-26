import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "@/lib/strava/client";

// GET: return how many activities are missing descriptions
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const total   = await prisma.activity.count({ where: { userId } });
  const missing = await prisma.activity.count({ where: { userId, description: null } });
  return NextResponse.json({ total, missing, done: missing === 0 });
}

// POST: backfill ALL missing descriptions, streaming progress via SSE
// Handles Strava rate limits internally (200 req/15min)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // Check if request wants a streaming response
  const { searchParams } = new URL(req.url);
  const streamMode = searchParams.get("stream") === "true";

  if (!streamMode) {
    // Non-streaming: do one batch of 30 (legacy mode for the Settings button)
    const batchSize = Math.min(50, parseInt(searchParams.get("batch") ?? "30", 10) || 30);
    const total = await prisma.activity.count({ where: { userId, description: null } });
    if (total === 0) return NextResponse.json({ done: true, updated: 0, remaining: 0 });

    const missing = await prisma.activity.findMany({
      where: { userId, description: null },
      orderBy: { startDate: "desc" },
      take: batchSize,
      select: { id: true, stravaId: true },
    });

    let updated = 0, errors = 0;
    for (const act of missing) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const full: any = await stravaFetch(userId, `/activities/${act.stravaId}`);
        await prisma.activity.update({
          where: { id: act.id },
          data: {
            description:       full.description  ?? null,
            splitsMetric:      full.splits_metric || undefined,
            bestEfforts:       full.best_efforts  || undefined,
            laps:              full.laps          || undefined,
            sufferScore:       full.suffer_score  ?? undefined,
            splitDetailFetched: true,
          },
        });
        updated++;
        await new Promise(r => setTimeout(r, 350));
      } catch (e) {
        console.error(`[backfill] ${act.stravaId}:`, e);
        errors++;
      }
    }
    return NextResponse.json({ done: updated >= total, updated, errors, remaining: total - updated, total });
  }

  // Streaming mode: fetch ALL missing activities, streaming progress as SSE
  // Each individual activity fetch respects Strava's 200 req/15min rate limit
  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const missing = await prisma.activity.findMany({
          where: { userId, description: null },
          orderBy: { startDate: "desc" },
          select: { id: true, stravaId: true, name: true },
        });

        const total = missing.length;
        controller.enqueue(send({ type: "start", total }));

        let updated = 0, errors = 0;
        // Strava rate limit: 200 req/15min = 1 per 4.5s
        // We use 5s delay between requests (safe margin)
        const DELAY = 5100;
        // Allow burst for first 150 within 15min window
        let windowStart = Date.now(), windowCount = 0;

        for (const act of missing) {
          // Rate limiting: max 170 per 15-minute window
          if (windowCount >= 170) {
            const elapsed = Date.now() - windowStart;
            const waitMs  = Math.max(0, 15 * 60_000 - elapsed);
            if (waitMs > 0) {
              controller.enqueue(send({ type: "rate_limit", waitMs, updated, total }));
              await new Promise(r => setTimeout(r, waitMs));
            }
            windowStart = Date.now();
            windowCount = 0;
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const full: any = await stravaFetch(userId, `/activities/${act.stravaId}`);
            await prisma.activity.update({
              where: { id: act.id },
              data: {
                description:       full.description  ?? null,
                splitsMetric:      full.splits_metric || undefined,
                bestEfforts:       full.best_efforts  || undefined,
                laps:              full.laps          || undefined,
                sufferScore:       full.suffer_score  ?? undefined,
                splitDetailFetched: true,
              },
            });
            updated++;
            windowCount++;

            if (updated % 10 === 0 || updated === total) {
              controller.enqueue(send({ type: "progress", updated, total, errors }));
            }

            await new Promise(r => setTimeout(r, DELAY));
          } catch (e) {
            errors++;
            windowCount++;
            console.error(`[backfill] ${act.stravaId} (${act.name}):`, e);
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        controller.enqueue(send({ type: "done", updated, errors, total }));
        controller.close();
      } catch (e) {
        controller.enqueue(send({ type: "error", message: String(e) }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
