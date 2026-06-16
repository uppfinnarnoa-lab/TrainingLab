import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ActivityList } from "./activity-list";

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; page?: string; sort?: string; minKm?: string; maxKm?: string; racesOnly?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const params = await searchParams;

  const page = Math.max(1, parseInt(params.page ?? "1"));
  const perPage = 30;
  const sort = params.sort ?? "date_desc";
  const minKm = params.minKm ? parseFloat(params.minKm) * 1000 : undefined;
  const maxKm = params.maxKm ? parseFloat(params.maxKm) * 1000 : undefined;
  const racesOnly = params.racesOnly === "1";

  const where = {
    userId,
    ...(params.sport ? { sportType: params.sport } : {}),
    ...(minKm !== undefined && maxKm !== undefined
      ? { distance: { gte: minKm, lte: maxKm } }
      : minKm !== undefined
      ? { distance: { gte: minKm } }
      : maxKm !== undefined
      ? { distance: { lte: maxKm } }
      : {}),
    ...(racesOnly ? { isRace: true } : {}),
  };

  const orderBy =
    sort === "dist_desc" ? { distance: "desc" as const }
    : sort === "dist_asc"  ? { distance: "asc" as const }
    : sort === "pace_asc"  ? { averageSpeed: "desc" as const }
    : sort === "pace_desc" ? { averageSpeed: "asc" as const }
    : { startDate: "desc" as const };

  const [activities, total, sports] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        description: true,
        sportType: true,
        startDate: true,
        distance: true,
        movingTime: true,
        totalElevationGain: true,
        averageHeartrate: true,
        averageSpeed: true,
        isRace: true,
        weatherTemp: true,
        workoutType: true,
        customTypeName: true,
      },
    }),
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where: { userId },
      select: { sportType: true },
      distinct: ["sportType"],
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Activities</h1>
          <p className="text-sm text-muted mt-1">{total.toLocaleString()} total activities</p>
        </div>
      </div>

      <ActivityList
        activities={activities.map((a: (typeof activities)[number]) => ({
          ...a,
          startDate: a.startDate.toISOString(),
        }))}
        total={total}
        page={page}
        perPage={perPage}
        sports={sports.map((s: { sportType: string }) => s.sportType).sort()}
        selectedSport={params.sport}
        sort={sort}
        racesOnly={racesOnly}
      />
    </div>
  );
}
