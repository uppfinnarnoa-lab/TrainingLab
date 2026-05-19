import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const updateSchema = z.object({
  time:      z.number().int().positive().optional(),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventName: z.string().max(120).optional().nullable(),
  notes:     z.string().max(500).optional().nullable(),
});

async function owned(id: string, userId: string) {
  const r = await prisma.raceRecord.findUnique({ where: { id } });
  return r?.userId === userId ? r : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const updated = await prisma.raceRecord.update({
    where: { id },
    data: { ...parsed.data, date: parsed.data.date ? new Date(parsed.data.date) : undefined },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.raceRecord.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
