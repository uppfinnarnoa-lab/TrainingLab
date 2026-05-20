import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { syncActivities, resyncRecentActivities } from "@/lib/strava/sync";
import { updateVO2maxAndPaces } from "@/lib/fitness/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const full   = body.full   === true;
  const resync = body.resync === true; // manual button: smart 3-day resync

  const account = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!account) return NextResponse.json({ error: "strava_not_connected" }, { status: 400 });

  try {
    let result;
    if (resync) {
      // Smart resync: fetch last 3 days, re-fetch individual activities if description changed
      result = await resyncRecentActivities(userId, 3);
    } else {
      const since = full ? undefined : (account.lastSyncAt ?? undefined);
      result = await syncActivities(userId, { full, since });
    }

    // Auto-update VO2max + paces after sync (not HR zones — only on button press)
    updateVO2maxAndPaces(userId).catch(e => console.error("Fitness cache error:", e));
    return NextResponse.json({ ...result, lastSyncAt: new Date() });
  } catch (e) {
    console.error("Sync error:", e);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
