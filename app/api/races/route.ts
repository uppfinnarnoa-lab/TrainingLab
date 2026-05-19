import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { RACE_DISTANCES } from "@/lib/fitness/paces";

const schema = z.object({
  distance:         z.string().min(1).max(60),
  distanceM:        z.number().positive(),
  time:             z.number().int().positive(),   // seconds
  date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventName:        z.string().max(120).optional().nullable(),
  stravaActivityId: z.string().optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
  isManual:         z.boolean().default(false),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const records = await prisma.raceRecord.findMany({
    where: { userId: session.user.id },
    orderBy: [{ distanceM: "asc" }, { date: "desc" }],
  });

  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const record = await prisma.raceRecord.create({
    data: {
      ...parsed.data,
      date: new Date(parsed.data.date),
      userId: session.user.id,
    },
  });

  return NextResponse.json(record, { status: 201 });
}

// Auto-import races from Strava activities
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Find race activities not yet in RaceRecord
  const raceActivities = await prisma.activity.findMany({
    where: {
      userId,
      isRace: true,
      sportType: { in: ["Run", "TrailRun", "VirtualRun"] },
    },
    orderBy: { startDate: "desc" },
  });

  const existing = await prisma.raceRecord.findMany({
    where: { userId, stravaActivityId: { not: null } },
    select: { stravaActivityId: true },
  });
  const existingIds = new Set(existing.map((r: { stravaActivityId: string | null }) => r.stravaActivityId));

  const COMMON_DISTANCES = [
    { m: 800,   label: "800m" },
    { m: 1500,  label: "1500m" },
    { m: 1609,  label: "Mile" },
    { m: 3000,  label: "3K" },
    { m: 5000,  label: "5K" },
    { m: 10000, label: "10K" },
    { m: 15000, label: "15K" },
    { m: 21097, label: "Half Marathon" },
    { m: 42195, label: "Marathon" },
  ];

  function matchDistance(distM: number): { label: string; distanceM: number } {
    const tolerance = 0.05; // 5%
    for (const d of COMMON_DISTANCES) {
      if (Math.abs(distM - d.m) / d.m < tolerance) return { label: d.label, distanceM: d.m };
    }
    return { label: `${(distM / 1000).toFixed(1)}K`, distanceM: distM };
  }

  let imported = 0;
  for (const a of raceActivities) {
    if (existingIds.has(String(a.stravaId))) continue;
    const { label, distanceM } = matchDistance(a.distance);
    await prisma.raceRecord.create({
      data: {
        userId,
        distance: label,
        distanceM,
        time: a.movingTime,
        date: a.startDate,
        eventName: a.name,
        stravaActivityId: String(a.stravaId),
        isManual: false,
      },
    });
    imported++;
  }

  return NextResponse.json({ imported });
}
