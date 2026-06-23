import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { updateHRZones } from "@/lib/fitness/cache";

const annualGoalsSchema = z.record(
  z.string().regex(/^\d{4}$/),
  z.record(z.string(), z.number().nonnegative())
);

const schema = z.object({
  name:            z.string().max(100).optional().nullable(),
  weightKg:        z.coerce.number().min(30).max(300).optional().nullable(),
  heightCm:        z.coerce.number().min(100).max(250).optional().nullable(),
  dateOfBirth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sex:             z.enum(["male", "female", "other", ""]).optional().nullable(),
  maxHeartRate:    z.coerce.number().min(100).max(230).optional().nullable(),
  restingHeartRate:z.coerce.number().min(20).max(100).optional().nullable(),
  manualLT1HR:        z.coerce.number().min(80).max(220).optional().nullable(),
  manualLT2HR:        z.coerce.number().min(80).max(220).optional().nullable(),
  maxHRArtifactCap:   z.coerce.number().int().min(170).max(220).optional().nullable(),
  primaryGoal:        z.string().max(200).optional().nullable(),
  yearsTraining:   z.coerce.number().int().min(0).max(80).optional().nullable(),
  paceUnit:        z.enum(["min_per_km", "min_per_mi", "km_h"]).optional(),
  paceUnitBySport: z.record(z.string(), z.enum(["min_per_km", "min_per_mi", "km_h"])).optional().nullable(),
  annualGoals:     annualGoalsSchema.optional().nullable(),
  pbDetectionMode:         z.enum(["manual", "automatic"]).optional(),
  pbDetectionTolerancePct: z.coerce.number().min(0).max(50).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { name, ...profileData } = parsed.data;

  // pbDetectionModeChangedAt bounds auto-PB-detection to activities synced after this
  // point (see lib/races/pb-detection.ts) — only stamp it on a genuine manual→automatic
  // transition, never on every save while already "automatic", or it would silently
  // re-arm the backfill guard and mask activities synced between two unrelated saves.
  let pbDetectionModeChangedAt: Date | undefined;
  if (parsed.data.pbDetectionMode === "automatic") {
    const existing = await prisma.athleteProfile.findUnique({
      where: { userId: session.user.id },
      select: { pbDetectionMode: true },
    });
    if (!existing || existing.pbDetectionMode !== "automatic") {
      pbDetectionModeChangedAt = new Date();
    }
  }

  await Promise.all([
    // Update display name on User
    name !== undefined ? prisma.user.update({ where: { id: session.user.id }, data: { name: name ?? undefined } }) : Promise.resolve(),
    // Upsert athlete profile
    prisma.athleteProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        ...profileData,
        dateOfBirth: profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null,
        sex: profileData.sex || null,
        ...(pbDetectionModeChangedAt ? { pbDetectionModeChangedAt } : {}),
      },
      update: {
        ...profileData,
        dateOfBirth: profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null,
        sex: profileData.sex || null,
        ...(pbDetectionModeChangedAt ? { pbDetectionModeChangedAt } : {}),
      },
    }),
  ]);

  // When HR or LT limits are manually set, recalibrate zones immediately so stats reflect the override
  if (
    parsed.data.maxHeartRate !== undefined ||
    parsed.data.restingHeartRate !== undefined ||
    parsed.data.manualLT1HR !== undefined ||
    parsed.data.manualLT2HR !== undefined
  ) {
    updateHRZones(session.user.id).catch(e => console.error("[profile] HR recalibration error:", e));
  }

  return NextResponse.json({ ok: true });
}
