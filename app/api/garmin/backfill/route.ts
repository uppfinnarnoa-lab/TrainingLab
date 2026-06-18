import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGarminDaily } from "@/lib/garmin/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { subDays } from "date-fns";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const rl = checkRateLimit(`garmin-backfill:${userId}`, 3, 3600);
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited", retryAfter: rl.resetIn }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(365, Number((body as { days?: number })?.days) || 90));

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
    // Gentle pacing — Garmin's unofficial API is bot-detection-sensitive (see docs/planning/archive/GARMIN_AUTH_REWORK_PLAN.md)
    if (i < days - 1) await new Promise(r => setTimeout(r, 300));
  }

  return NextResponse.json({ ok: true, days, synced, empty, failed });
}
