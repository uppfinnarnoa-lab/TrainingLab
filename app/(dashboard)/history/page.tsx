import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { HistoryClient } from "./history-client";

export default async function HistoryPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const activities = await prisma.activity.findMany({
    where: { userId },
    orderBy: { startDate: "asc" },
    select: {
      id: true, name: true, description: true, sportType: true,
      startDate: true, distance: true, movingTime: true,
      totalElevationGain: true, averageHeartrate: true,
      averageSpeed: true, isRace: true, weatherTemp: true, stravaId: true,
      laps: true, workoutType: true, customTypeName: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Activity History</h1>
        <p className="text-sm text-muted mt-1">
          All your Strava activities in a calendar view
        </p>
      </div>
      <HistoryClient
        activities={activities.map((a: typeof activities[number]) => ({
          ...a,
          startDate: a.startDate.toISOString().slice(0, 10),
          stravaId: a.stravaId.toString(),
          hasLaps: a.laps !== null,
          workoutType: a.workoutType ?? null,
          customTypeName: a.customTypeName ?? null,
        }))}
      />
    </div>
  );
}
