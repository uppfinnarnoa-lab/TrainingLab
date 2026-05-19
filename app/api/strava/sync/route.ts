import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { syncActivities } from "@/lib/strava/sync";
import { updateVO2maxAndPaces } from "@/lib/fitness/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const full = body.full === true;

  const account = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!account) return NextResponse.json({ error: "strava_not_connected" }, { status: 400 });

  const since = full ? undefined : (account.lastSyncAt ?? undefined);

  try {
    const result = await syncActivities(userId, { full, since });
    // Auto-update VO2max + paces after sync — HR zones are NOT updated here,
    // only when user explicitly presses the calibration button.
    updateVO2maxAndPaces(userId).catch(e => console.error("Fitness cache error:", e));
    return NextResponse.json({ ...result, lastSyncAt: new Date() });
  } catch (e) {
    console.error("Sync error:", e);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
