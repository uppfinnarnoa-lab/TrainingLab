import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const sectionSchema = z.object({
  order: z.number().int(),
  name: z.string().min(1).max(80),
  durationType: z.enum(["time", "distance", "open"]),
  duration: z.number().int().positive().optional().nullable(),
  distance: z.number().positive().optional().nullable(),
  repetitions: z.number().int().min(1).optional().nullable(),
  zoneType: z.enum(["hr_zone", "pace_zone", "power_zone", "rpe"]).optional().nullable(),
  targetZone: z.number().int().min(1).max(5).optional().nullable(),
  targetPaceLow: z.number().positive().optional().nullable(),
  targetPaceHigh: z.number().positive().optional().nullable(),
  targetHRLow: z.number().int().optional().nullable(),
  targetHRHigh: z.number().int().optional().nullable(),
  targetRPE: z.number().int().min(1).max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  sportId: z.string().cuid(),
  typeId: z.string().cuid().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  sections: z.array(sectionSchema).max(20),
});

// GET: all templates for the user (with sections)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const templates = await prisma.workoutTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: [{ sportId: "asc" }, { name: "asc" }],
    include: {
      sections: { orderBy: { order: "asc" } },
      sport: true,
      type: true,
    },
  });

  return NextResponse.json(templates);
}

// POST: create a template
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });

  const { sections, ...templateData } = parsed.data;

  const sport = await prisma.sportCategory.findUnique({ where: { id: templateData.sportId } });
  if (!sport || sport.userId !== session.user.id)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (templateData.typeId) {
    const type = await prisma.workoutType.findUnique({ where: { id: templateData.typeId } });
    if (!type || type.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Compute estimated totals from sections
  const estimated = computeEstimated(sections);

  const template = await prisma.workoutTemplate.create({
    data: {
      ...templateData,
      userId: session.user.id,
      ...estimated,
      sections: {
        create: sections,
      },
    },
    include: { sections: { orderBy: { order: "asc" } }, sport: true, type: true },
  });

  return NextResponse.json(template, { status: 201 });
}

// Compute estimated duration, distance, and zone distribution from sections
function computeEstimated(sections: z.infer<typeof sectionSchema>[]) {
  let totalSec = 0;
  let totalM = 0;
  const zoneSeconds: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  for (const s of sections) {
    const reps = s.repetitions ?? 1;
    let sectionSec = 0;

    if (s.durationType === "time" && s.duration) {
      sectionSec = s.duration * reps;
      totalSec += sectionSec;
    } else if (s.durationType === "distance" && s.distance) {
      // Estimate time from target pace midpoint
      const pace = s.targetPaceHigh
        ? ((s.targetPaceLow ?? s.targetPaceHigh) + s.targetPaceHigh) / 2
        : 360; // 6:00/km default
      sectionSec = (s.distance * reps / 1000) * pace;
      totalSec += sectionSec;
      totalM += s.distance * reps;
    }

    if (s.targetZone && sectionSec > 0) {
      zoneSeconds[`z${s.targetZone}`] = (zoneSeconds[`z${s.targetZone}`] ?? 0) + sectionSec;
    }
  }

  return {
    estimatedDuration: totalSec > 0 ? Math.round(totalSec) : null,
    estimatedDistance: totalM > 0 ? totalM : null,
    estimatedZoneDistribution: Object.values(zoneSeconds).some(v => v > 0) ? zoneSeconds : null,
  };
}
