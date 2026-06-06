import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const sportSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().max(30),
  order: z.number().int().optional(),
});

const typeSchema = z.object({
  name: z.string().min(1).max(60),
  sportId: z.string().cuid(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  order: z.number().int().optional(),
});

// GET: return all sports + their workout types for the current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sports = await prisma.sportCategory.findMany({
    where: { userId: session.user.id },
    orderBy: { order: "asc" },
    include: {
      workoutTypes: { orderBy: { order: "asc" } },
    },
  });

  return NextResponse.json(sports);
}

// POST: create a sport or workout type
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind; // "sport" | "type"

  if (kind === "sport") {
    const parsed = sportSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

    const sport = await prisma.sportCategory.create({
      data: { ...parsed.data, userId: session.user.id },
    });

    // Every new sport gets Race as a default type (yellow)
    await prisma.workoutType.create({
      data: { name: "Race", sportId: sport.id, userId: session.user.id, color: "#FBBF24", order: 999 },
    });

    const sportWithTypes = await prisma.sportCategory.findUnique({
      where: { id: sport.id },
      include: { workoutTypes: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json(sportWithTypes, { status: 201 });
  }

  if (kind === "type") {
    const parsed = typeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const sport = await prisma.sportCategory.findUnique({ where: { id: parsed.data.sportId } });
    if (!sport || sport.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    const type = await prisma.workoutType.create({
      data: { ...parsed.data, userId: session.user.id },
    });
    return NextResponse.json(type, { status: 201 });
  }

  return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id   = req.nextUrl.searchParams.get("id");
  const kind = req.nextUrl.searchParams.get("kind");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  if (kind === "sport") {
    const sport = await prisma.sportCategory.findUnique({ where: { id } });
    if (!sport || sport.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.sportCategory.delete({ where: { id } });
  } else {
    const type = await prisma.workoutType.findUnique({ where: { id } });
    if (!type || type.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.workoutType.delete({ where: { id } });
  }

  return NextResponse.json({ ok: true });
}
