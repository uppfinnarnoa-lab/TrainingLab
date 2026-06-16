import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { GoalsManager } from "./goals-manager";

export default async function GoalsSettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [goals, sports] = await Promise.all([
    prisma.trainingGoal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.sportCategory.findMany({ where: { userId }, select: { name: true }, orderBy: { order: "asc" } }),
  ]);

  return (
    <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-primary">Training Goals</h2>
        <p className="text-xs text-muted mt-0.5">Set distance and time targets per sport and period — progress is shown on your dashboard</p>
      </div>
      <GoalsManager
        initialGoals={goals}
        sports={sports.map((s: { name: string }) => s.name)}
      />
    </section>
  );
}
