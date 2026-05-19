import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const schema = z.object({
  name:            z.string().max(100).optional().nullable(),
  weightKg:        z.coerce.number().min(30).max(300).optional().nullable(),
  heightCm:        z.coerce.number().min(100).max(250).optional().nullable(),
  dateOfBirth:     z.string().optional().nullable(),
  sex:             z.enum(["male", "female", "other", ""]).optional().nullable(),
  maxHeartRate:    z.coerce.number().min(100).max(230).optional().nullable(),
  restingHeartRate:z.coerce.number().min(20).max(100).optional().nullable(),
  primaryGoal:     z.string().max(200).optional().nullable(),
  yearsTraining:   z.coerce.number().min(0).max(80).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { name, ...profileData } = parsed.data;

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
      },
      update: {
        ...profileData,
        dateOfBirth: profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : null,
        sex: profileData.sex || null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
