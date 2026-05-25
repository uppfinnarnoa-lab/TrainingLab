import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { HistoryClient } from "./history-client";
import { subDays } from "date-fns";

export default async function HistoryPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  // Load last 6 months of activities for the calendar view
  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: subDays(new Date(), 180) } },
    orderBy: { startDate: "asc" },
    select: {
      id: true, name: true, description: true, sportType: true,
      startDate: true, distance: true, movingTime: true,
      totalElevationGain: true, averageHeartrate: true,
      averageSpeed: true, isRace: true, weatherTemp: true, stravaId: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Activity History</h1>
        <p className="text-sm text-muted mt-1">
          All your Strava activities in a calendar view — last 6 months
        </p>
      </div>
      <HistoryClient
        activities={activities.map((a: typeof activities[number]) => ({
          ...a,
          startDate: a.startDate.toISOString().slice(0, 10),
          stravaId: a.stravaId.toString(),
        }))}
      />
    </div>
  );
}
