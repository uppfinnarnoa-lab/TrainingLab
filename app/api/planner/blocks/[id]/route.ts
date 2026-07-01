import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const schema = z.object({
  name:            z.string().min(1).max(80).optional(),
  blockType:       z.enum(["base", "build", "peak", "taper", "custom", "race"]).optional(),
  color:           z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  startDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:           z.string().max(500).optional().nullable(),
  targetKmPerWeek: z.number().positive().optional().nullable(),
  targetIntensity: z.string().optional().nullable(),
  targetRaceId:    z.string().cuid().optional().nullable(),
  archived:        z.boolean().optional(),
}).refine(data => !data.startDate || !data.endDate || data.startDate <= data.endDate, { message: "endDate must be >= startDate", path: ["endDate"] });

async function owned(id: string, userId: string) {
  const b = await prisma.trainingBlock.findUnique({ where: { id } });
  return b?.userId === userId ? b : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startDate) data.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate)   data.endDate   = new Date(parsed.data.endDate);

  const block = await prisma.trainingBlock.update({ where: { id }, data });
  return NextResponse.json({
    ...block,
    startDate: block.startDate.toISOString().slice(0, 10),
    endDate:   block.endDate.toISOString().slice(0, 10),
  });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.trainingBlock.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
