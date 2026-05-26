import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "@/lib/strava/client";

// GET: how many activities still need a detail fetch (for progress display)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const total   = await prisma.activity.count({ where: { userId } });
  const missing = await prisma.activity.count({ where: { userId, splitDetailFetched: false } });
  return NextResponse.json({ total, missing, done: missing === 0 });
}

// POST: backfill activities where splitDetailFetched=false.
// ?stream=true  → SSE progress stream (for UI progress bar)
// default       → single batch of up to 50 (for settings button)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const streamMode = searchParams.get("stream") === "true";

  if (!streamMode) {
    const batchSize = Math.min(50, parseInt(searchParams.get("batch") ?? "30", 10) || 30);
    const total = await prisma.activity.count({ where: { userId, splitDetailFetched: false } });
    if (total === 0) return NextResponse.json({ done: true, updated: 0, remaining: 0 });

    const pending = await prisma.activity.findMany({
      where: { userId, splitDetailFetched: false },
      orderBy: { startDate: "desc" },
      take: batchSize,
      select: { id: true, stravaId: true },
    });

    let updated = 0, errors = 0;
    for (const act of pending) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const full: any = await stravaFetch(userId, `/activities/${act.stravaId}`);
        await prisma.activity.update({
          where: { id: act.id },
          data: {
            description:        full.description        ?? null,
            splitsMetric:       full.splits_metric      || undefined,
            bestEfforts:        full.best_efforts       || undefined,
            laps:               full.laps               || undefined,
            sufferScore:        full.suffer_score       ?? undefined,
            splitDetailFetched: true,
          },
        });
        updated++;
        await new Promise(r => setTimeout(r, 350));
      } catch (e) {
        console.error(`[backfill-splits] ${act.stravaId}:`, e);
        errors++;
      }
    }
    const remaining = total - updated;
    return NextResponse.json({ done: remaining <= 0, updated, errors, remaining, total });
  }

  // ── Streaming SSE path ────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pending = await prisma.activity.findMany({
          where: { userId, splitDetailFetched: false },
          orderBy: { startDate: "desc" },
          select: { id: true, stravaId: true, name: true },
        });

        const total = pending.length;
        controller.enqueue(send({ type: "start", total }));

        let updated = 0, errors = 0;
        // Strava: 100 req/15 min → use 170/15 min burst (same as description backfill)
        const DELAY = 5100;
        let windowStart = Date.now(), windowCount = 0;

        for (const act of pending) {
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
                description:        full.description        ?? null,
                splitsMetric:       full.splits_metric      || undefined,
                bestEfforts:        full.best_efforts       || undefined,
                laps:               full.laps               || undefined,
                sufferScore:        full.suffer_score       ?? undefined,
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
            console.error(`[backfill-splits] ${act.stravaId} (${act.name}):`, e);
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
