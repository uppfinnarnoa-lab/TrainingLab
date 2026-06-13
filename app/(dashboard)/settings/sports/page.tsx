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
    <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-primary">Sports & Workout Types</h2>
        <p className="text-xs text-muted mt-0.5">
          Manage the sports and workout types used in your training planner
        </p>
      </div>
      <SportsManager sports={sports.map((s: (typeof sports)[number]) => ({
        id: s.id, name: s.name, color: s.color, icon: s.icon,
        isDefault: s.isDefault, isRunningRelated: s.isRunningRelated,
        workoutTypes: s.workoutTypes.map((t: (typeof s.workoutTypes)[number]) => ({
          id: t.id, name: t.name, color: t.color, order: t.order, defaultZone: t.defaultZone, isShared: t.isShared,
        })),
      }))} />
    </section>
  );
}
