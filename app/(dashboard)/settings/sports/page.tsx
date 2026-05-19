import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { SportsManager } from "./sports-manager";

export default async function SportsSettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const sports = await prisma.sportCategory.findMany({
    where: { userId },
    orderBy: { order: "asc" },
    include: { workoutTypes: { orderBy: { order: "asc" } } },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Sports & Workout Types</h1>
        <p className="text-sm text-muted mt-1">
          Manage the sports and workout types used in your training planner
        </p>
      </div>
      <SportsManager sports={sports.map((s: (typeof sports)[number]) => ({
        id: s.id, name: s.name, color: s.color, icon: s.icon,
        isDefault: s.isDefault,
        workoutTypes: s.workoutTypes.map((t: (typeof s.workoutTypes)[number]) => ({ id: t.id, name: t.name, color: t.color })),
      }))} />
    </div>
  );
}
