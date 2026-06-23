import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { sectionSchema } from "@/lib/planner/sectionSchema";
import { computeTemplateEstimate } from "@/lib/planner/estimate";

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
  const estimated = computeTemplateEstimate(sections);

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
