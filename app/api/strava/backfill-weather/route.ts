/**
 * POST /api/strava/backfill-weather
 *
 * Backfills Open-Meteo weather data for activities that have coordinates
 * but no weatherTemp. Processes in batches with rate-limiting delays.
 * Returns { processed, updated, skipped }.
 */

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { fetchAndSaveWeather } from "@/lib/weather/open-meteo";

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  // Fetch up to 200 activities missing weather but having coordinates
  const activities = await prisma.activity.findMany({
    where: {
      userId,
      weatherTemp: null,
      startLat: { not: null },
      startLng: { not: null },
    },
    select: { id: true, startLat: true, startLng: true, startDate: true },
    orderBy: { startDate: "desc" },
    take: 200,
  });

  let updated = 0;
  const skipped = 0;

  for (const act of activities) {
    if (act.startLat == null || act.startLng == null) continue;
    try {
      await fetchAndSaveWeather(act.id, act.startLat, act.startLng, act.startDate);
      updated++;
      // Open-Meteo free tier: no strict rate limit, but be polite
      await new Promise(r => setTimeout(r, 300));
    } catch {
      // Silently skip — individual fetch failures don't abort the batch
    }
  }

  return Response.json({ processed: activities.length, updated, skipped });
}
