import { prisma } from "@/lib/db/prisma";
import { fetchWeather } from "./client";

// Strava stores start_latlng as a JSON array [lat, lon] in some activity data.
// Since we store only the summary polyline, we decode the first point.
// If no GPS data, skip.
function decodeFirstPoint(polyline: string | null): [number, number] | null {
  if (!polyline || polyline.length < 2) return null;
  // Minimal Google polyline decoder — first point only
  let index = 0, lat = 0, lon = 0;
  for (const coord of [true, false]) {
    let result = 0, shift = 0, b: number;
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const delta = result & 1 ? ~(result >> 1) : result >> 1;
    if (coord) lat += delta;
    else lon += delta;
  }
  return [lat / 1e5, lon / 1e5];
}

export async function backfillWeather(userId: string, limit = 100): Promise<number> {
  const activities = await prisma.activity.findMany({
    where: { userId, weatherTemp: null, mapPolyline: { not: null } },
    select: { id: true, startDate: true, mapPolyline: true },
    orderBy: { startDate: "desc" },
    take: limit,
  });

  let updated = 0;
  for (const activity of activities) {
    const coords = decodeFirstPoint(activity.mapPolyline);
    if (!coords) continue;

    try {
      const weather = await fetchWeather(coords[0], coords[1], activity.startDate);
      await prisma.activity.update({
        where: { id: activity.id },
        data: {
          weatherTemp: weather.temp,
          weatherWind: weather.wind,
          weatherPrecip: weather.precip,
          weatherCode: weather.code,
        },
      });
      updated++;
      // Throttle: Open-Meteo allows ~10k req/day; 200ms between requests = ~5 req/s
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // Best-effort, skip on error
    }
  }
  return updated;
}
