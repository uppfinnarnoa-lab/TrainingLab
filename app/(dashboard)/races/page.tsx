import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { RacesClient } from "./races-client";

export default async function RacesPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const records = await prisma.raceRecord.findMany({
    where: { userId },
    orderBy: [{ distanceM: "asc" }, { date: "desc" }],
  });

  // Serialise dates
  const serialised = records.map((r: typeof records[number]) => ({
    ...r,
    date: r.date.toISOString().slice(0, 10),
    stravaActivityId: r.stravaActivityId,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Races & PBs</h1>
        <p className="text-sm text-muted mt-1">
          Personliga rekord per distans — lägg till manuellt
        </p>
      </div>
      <RacesClient records={serialised} />
    </div>
  );
}
