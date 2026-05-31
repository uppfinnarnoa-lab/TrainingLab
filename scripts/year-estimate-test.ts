/**
 * One-off test: run statistical zone estimator on 2023, 2024, 2025 data separately.
 * Delete after use.
 */
import { PrismaClient } from "@prisma/client";
import { estimateZonesFromStatisticalAnalysis } from "../lib/fitness/zones";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user");

  const cache = await prisma.fitnessCache.findUnique({
    where: { userId: user.id },
    select: { maxHR: true, restHR: true },
  });
  const maxHR = cache?.maxHR ?? 184;
  const restHR = cache?.restHR ?? 45;

  const olFilter = (name: string) =>
    !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer|\bmoc\b|stafett/i.test(name) &&
    !/indoor|inomhus/i.test(name) &&
    !/virtualrun/i.test(name);

  type LapRow = {
    average_heartrate?: number;
    distance: number;
    moving_time: number;
    total_elevation_gain?: number;
  };

  const years = [2023, 2024, 2025];

  for (const year of years) {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end   = new Date(`${year}-12-31T23:59:59Z`);

    const acts = await prisma.activity.findMany({
      where: {
        userId: user.id,
        startDate: { gte: start, lte: end },
        sportType: { contains: "run", mode: "insensitive" },
        isRace: false,
      },
      select: {
        name: true,
        sportType: true,
        startDate: true,
        laps: true,
        isRace: true,
        weatherTemp: true,
      },
    });

    type Act = typeof acts[number];

    const laps = (acts as Act[])
      .filter(a => olFilter(a.name) && Array.isArray(a.laps))
      .flatMap(a =>
        (a.laps as LapRow[]).filter(l =>
          l.average_heartrate && l.distance >= 800 && l.moving_time >= 180
        ).map(l => ({
          avgHR: l.average_heartrate!,
          distanceM: l.distance,
          movingTimeSec: l.moving_time,
          totalElevationGain: l.total_elevation_gain ?? 0,
          startDate: a.startDate,
          isRace: a.isRace ?? false,
          weatherTemp: a.weatherTemp,
        }))
      );

    const result = estimateZonesFromStatisticalAnalysis(laps, maxHR, restHR);

    if (!result) {
      console.log(`${year}: insufficient data (${laps.length} laps)`);
    } else {
      console.log(
        `${year}: LT1=${result.lt1HR} bpm @ ${secPerKm(result.lt1PaceSecPerKm)}  |  ` +
        `LT2=${result.lt2HR} bpm @ ${secPerKm(result.lt2PaceSecPerKm)}  |  ` +
        `R²=${result.rSquared.toFixed(3)}  |  ${result.bucketCount} buckets  |  ${laps.length} laps`
      );
    }
  }
}

function secPerKm(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}/km`;
}

main().finally(() => prisma.$disconnect());
