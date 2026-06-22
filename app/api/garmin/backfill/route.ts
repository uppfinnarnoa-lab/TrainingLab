import { auth } from "@/auth";
import { syncGarminDaily } from "@/lib/garmin/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { subDays } from "date-fns";

/**
 * POST — SSE stream: backfill Garmin daily wellness data for the last N days (default/max 2 years).
 *
 * A long sequential backfill (300ms pacing + real Garmin API latency per day) easily runs past
 * nginx's default proxy_read_timeout if done as a single buffered response — streaming progress
 * keeps the connection alive (each chunk resets the read timeout) and gives the client a real
 * progress bar instead of a single eventual JSON blob.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const rl = checkRateLimit(`garmin-backfill:${userId}`, 3, 3600);
  if (!rl.allowed) return Response.json({ error: "rate_limited", retryAfter: rl.resetIn }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(730, Number((body as { days?: number })?.days) || 730));

  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      const now = new Date();
      let synced = 0, empty = 0, failed = 0;

      controller.enqueue(send({ type: "start", total: days }));

      for (let i = 0; i < days; i++) {
        try {
          const gotData = await syncGarminDaily(userId, subDays(now, i));
          if (gotData) synced++; else empty++;
        } catch (e) {
          failed++;
          console.error(`[garmin/backfill] day -${i} failed:`, e instanceof Error ? e.message : e);
        }
        controller.enqueue(send({ type: "progress", done: i + 1, total: days, synced, empty, failed }));
        // Gentle pacing — Garmin's unofficial API is bot-detection-sensitive (see docs/planning/archive/GARMIN_AUTH_REWORK_PLAN.md)
        if (i < days - 1) await new Promise(r => setTimeout(r, 300));
      }

      controller.enqueue(send({ type: "done", done: days, total: days, synced, empty, failed }));
      controller.close();
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
