import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "@/lib/strava/client";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const batchSize = Math.min(50, parseInt(searchParams.get("batch") ?? "30"));

  // Count how many need backfilling
  const total = await prisma.activity.count({ where: { userId, description: null } });

  if (total === 0)
    return NextResponse.json({ done: true, updated: 0, remaining: 0 });

  // Fetch a batch of activities that are missing descriptions
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
          description:  full.description  ?? null,
          splitsMetric: full.splits_metric ?? undefined,
          bestEfforts:  full.best_efforts  ?? undefined,
          laps:         full.laps          ?? undefined,
          sufferScore:  full.suffer_score  ?? undefined,
        },
      });
      updated++;
      // Respect Strava rate limit: 200 req/15min → ~4.5s/req — we use 300ms for batches
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[backfill] Failed for ${act.stravaId}:`, e);
      errors++;
    }
  }

  const remaining = total - updated;

  return NextResponse.json({ done: remaining <= 0, updated, errors, remaining, total });
}

// GET: just return count of how many need backfilling
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const total   = await prisma.activity.count({ where: { userId } });
  const missing = await prisma.activity.count({ where: { userId, description: null } });
  return NextResponse.json({ total, missing, done: missing === 0 });
}
