import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * Bulk-removes every auto-detected RaceRecord (isManual: false) for the user —
 * the recovery action for a distance that flooded under the old detection rule
 * (see docs/planning/Planerattköra/PB_DETECTION_SETTINGS_CONSOLIDATION_PLAN_2026_06_24.md
 * §5). Manual entries are never touched.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { count } = await prisma.raceRecord.deleteMany({
    where: { userId: session.user.id, isManual: false },
  });

  return NextResponse.json({ deleted: count });
}
