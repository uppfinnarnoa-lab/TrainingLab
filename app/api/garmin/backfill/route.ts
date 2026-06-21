import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGarminDaily } from "@/lib/garmin/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { subDays } from "date-fns";

// A 90-day backfill (sequential, 300ms pacing between days + real Garmin API latency) easily
// runs past nginx's default proxy_read_timeout (~60s) — the connection gets killed mid-run,
// the browser sees a generic failed fetch with zero indication of what happened, and nothing
// in our own code ever actually errored (confirmed: no [garmin] log lines, because nothing
// failed — it just didn't finish in time). Run the loop in the background instead of inside
// the request/response cycle so the HTTP response returns immediately.
async function runBackfill(userId: string, days: number): Promise<void> {
  const now = new Date();
  let synced = 0;
  let empty  = 0;
  let failed = 0;

  for (let i = 0; i < days; i++) {
    try {
      const gotData = await syncGarminDaily(userId, subDays(now, i));
      if (gotData) synced++; else empty++;
    } catch (e) {
      failed++;
      console.error(`[garmin/backfill] day -${i} failed:`, e);
    }
    if (i % 10 === 9 || i === days - 1) {
      console.log(`[garmin/backfill] progress ${i + 1}/${days} — synced=${synced} empty=${empty} failed=${failed}`);
    }
    // Gentle pacing — Garmin's unofficial API is bot-detection-sensitive (see docs/planning/archive/GARMIN_AUTH_REWORK_PLAN.md)
    if (i < days - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[garmin/backfill] done for user ${userId}: ${days} days — synced=${synced} empty=${empty} failed=${failed}`);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const rl = checkRateLimit(`garmin-backfill:${userId}`, 3, 3600);
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited", retryAfter: rl.resetIn }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(365, Number((body as { days?: number })?.days) || 90));

  // Fire-and-forget — see runBackfill() comment for why this can't run inline.
  void runBackfill(userId, days);

  return NextResponse.json({ ok: true, started: true, days });
}
