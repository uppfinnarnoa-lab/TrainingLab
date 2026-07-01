import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const schema = z.object({
  name:             z.string().min(1).max(80),
  blockType:        z.enum(["base", "build", "peak", "taper", "custom", "race"]),
  color:            z.string().regex(/^#[0-9a-fA-F]{6}$/),
  startDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:            z.string().max(500).optional().nullable(),
  targetKmPerWeek:  z.number().positive().optional().nullable(),
  targetIntensity:  z.string().optional().nullable(),
  targetRaceId:     z.string().cuid().optional().nullable(),
}).refine(data => data.startDate <= data.endDate, { message: "endDate must be >= startDate", path: ["endDate"] });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const blocks = await prisma.trainingBlock.findMany({
    where: { userId: session.user.id },
    orderBy: { startDate: "asc" },
  });
  type B = { startDate: Date; endDate: Date; [k: string]: unknown };
  return NextResponse.json((blocks as B[]).map(b => ({
    ...b,
    startDate: b.startDate.toISOString().slice(0, 10),
    endDate:   b.endDate.toISOString().slice(0, 10),
  })));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  const block = await prisma.trainingBlock.create({
    data: {
      ...parsed.data,
      userId:    session.user.id,
      startDate: new Date(parsed.data.startDate),
      endDate:   new Date(parsed.data.endDate),
    },
  });
  return NextResponse.json({
    ...block,
    startDate: block.startDate.toISOString().slice(0, 10),
    endDate:   block.endDate.toISOString().slice(0, 10),
  }, { status: 201 });
}
