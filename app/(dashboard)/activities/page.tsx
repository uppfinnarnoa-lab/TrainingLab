import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ActivityList } from "./activity-list";

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; page?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const params = await searchParams;

  const page = Math.max(1, parseInt(params.page ?? "1"));
  const perPage = 30;

  const where = {
    userId,
    ...(params.sport ? { sportType: params.sport } : {}),
  };

  const [activities, total, sports] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { startDate: "desc" },
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
      />
    </div>
  );
}
