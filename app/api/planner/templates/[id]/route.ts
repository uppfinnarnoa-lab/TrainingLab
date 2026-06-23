import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { sectionSchema } from "@/lib/planner/sectionSchema";
import { computeTemplateEstimate } from "@/lib/planner/estimate";
import { buildPaceZones, paceZonesToRanges } from "@/lib/fitness/zones";

const updateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  sportId:     z.string().cuid().optional(),
  typeId:      z.string().cuid().optional().nullable(),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  sections:    z.array(sectionSchema).max(20).optional(),
});

async function owned(id: string, userId: string) {
  const t = await prisma.workoutTemplate.findUnique({ where: { id } });
  return t?.userId === userId ? t : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });

  const { sections, ...templateData } = parsed.data;

  // Update template fields
  if (Object.keys(templateData).length > 0) {
    await prisma.workoutTemplate.update({ where: { id }, data: templateData });
  }

  // Replace sections if provided, and recompute the template's cached
  // estimate fields — they otherwise go stale on every section edit.
  if (sections !== undefined) {
    await prisma.workoutSection.deleteMany({ where: { templateId: id } });
    if (sections.length > 0) {
      await prisma.workoutSection.createMany({
        data: sections.map(s => ({ ...s, templateId: id })),
      });
    }
    const fitnessCache = await prisma.fitnessCache.findUnique({ where: { userId: session.user.id }, select: { vdot: true } });
    const paceZoneRanges = paceZonesToRanges(buildPaceZones(fitnessCache?.vdot ?? 45));
    await prisma.workoutTemplate.update({ where: { id }, data: computeTemplateEstimate(sections, paceZoneRanges) });
  }

  const updated = await prisma.workoutTemplate.findUnique({
    where: { id },
    include: { sections: { orderBy: { order: "asc" } }, sport: true, type: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await owned(id, session.user.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.workoutTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
