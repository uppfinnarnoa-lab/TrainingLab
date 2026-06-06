import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

/** Map a workout type name to a default target zone (1-5). */
function typeToZone(typeName: string | null): number {
  if (!typeName) return 1;
  const t = typeName.toLowerCase();
  if (/race|tävl|lopp|mila|stafett|competition|comp\b/.test(t)) return 5;
  if (/speed|speedwork|intervall|interval|fartlek|tabata/.test(t))  return 5;
  if (/\blt\b|threshold|tröskel|lactate/.test(t))                    return 4;
  if (/\bat\b|aerobic threshold|aerob tröskel/.test(t))              return 3;
  if (/tempo/.test(t))                                               return 3;
  if (/easy|distans|base|aerob|recovery|lugn/.test(t))               return 2;
  return 1;
}

/**
 * POST /api/planner/backfill-sections
 *
 * For every template owned by the user that has 0 sections, creates one
 * default section matching the template's estimatedDuration / estimatedDistance
 * and a zone derived from the workout type name.
 *
 * Returns { fixed: number } — the number of templates that were updated.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const templates = await prisma.workoutTemplate.findMany({
    where: { userId },
    include: { sections: true, type: true },
  });

  const ops: ReturnType<typeof prisma.workoutSection.create>[] = [];

  for (const t of templates) {
    if (t.sections.length > 0) continue;

    const zone = typeToZone(t.type?.name ?? null);
    let durationType: "time" | "distance" | "open" = "open";
    if (t.estimatedDuration) durationType = "time";
    else if (t.estimatedDistance) durationType = "distance";

    ops.push(prisma.workoutSection.create({
      data: {
        templateId: t.id,
        order: 0,
        name: t.name,
        durationType,
        duration:    t.estimatedDuration  ?? null,
        distance:    t.estimatedDistance  ?? null,
        repetitions: null,
        zoneType:    "pace_zone",
        targetZone:  zone,
        targetPaceLow:  null,
        targetPaceHigh: null,
        targetHRLow:    null,
        targetHRHigh:   null,
        targetRPE:      null,
        notes:          null,
      },
    }));
  }

  const fixed = ops.length;
  if (fixed === 0) return NextResponse.json({ fixed: 0 });

  await prisma.$transaction(ops);

  return NextResponse.json({ fixed });
}
