import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { RacesClient } from "./races-client";
import { subDays } from "date-fns";

export default async function RacesPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [records, allTimeRecords] = await Promise.all([
    prisma.raceRecord.findMany({
      where: { userId },
      orderBy: [{ distanceM: "asc" }, { date: "desc" }],
    }),
    // For performance-per-half-year chart: last 5 years
    prisma.raceRecord.findMany({
      where: { userId, date: { gte: subDays(new Date(), 5 * 365) } },
      orderBy: [{ distance: "asc" }, { date: "asc" }],
      select: { distance: true, distanceM: true, time: true, date: true },
    }),
  ]);

  // Serialise dates
  const serialised = records.map((r: typeof records[number]) => ({
    ...r,
    date: r.date.toISOString().slice(0, 10),
    stravaActivityId: r.stravaActivityId,
  }));

  // Build performance trend: best time per distance per half-year
  const perfTrend: { distance: string; period: string; time: number }[] = [];
  const byKey = new Map<string, number>();
  for (const r of allTimeRecords) {
    const yr = r.date.getFullYear();
    const half = r.date.getMonth() < 6 ? "H1" : "H2";
    const key = `${r.distance}||${yr}-${half}`;
    if (!byKey.has(key) || byKey.get(key)! > r.time) byKey.set(key, r.time);
  }
  for (const [key, time] of byKey) {
    const [dist, period] = key.split("||");
    perfTrend.push({ distance: dist, period, time });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Races & PBs</h1>
        <p className="text-sm text-muted mt-1">
          Personal records by distance — add manually
        </p>
      </div>
      <RacesClient records={serialised} perfTrend={perfTrend} />
    </div>
  );
}
