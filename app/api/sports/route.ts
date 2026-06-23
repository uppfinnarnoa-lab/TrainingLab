import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const sportSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().max(30),
  order: z.number().int().optional(),
  isRunningRelated: z.boolean().optional(),
});

const sportUpdateSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isRunningRelated: z.boolean().optional(),
});

const typeSchema = z.object({
  name: z.string().min(1).max(60),
  sportId: z.string().cuid(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  order: z.number().int().optional(),
});

const typeUpdateSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  order: z.number().int().optional(),
  defaultZone: z.number().int().min(1).max(5).optional().nullable(),
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

    // Every sport gets a "Race" type — shared across all sports, so it
    // inherits whatever name/color/zone the user has already set elsewhere.
    const existingShared = await prisma.workoutType.findFirst({
      where: { userId: session.user.id, isShared: true },
    });
    await prisma.workoutType.create({
      data: {
        name: existingShared?.name ?? "Race",
        color: existingShared?.color ?? "#FBBF24",
        defaultZone: existingShared?.defaultZone ?? 5,
        sportId: sport.id,
        userId: session.user.id,
        isShared: true,
        order: 999,
      },
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

// PATCH: update a sport's name/color, or a workout type's name, color, order, or default zone
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);

  if (body?.kind === "sport") {
    const parsed = sportUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

    const { id, ...data } = parsed.data;
    const sport = await prisma.sportCategory.findUnique({ where: { id } });
    if (!sport || sport.userId !== session.user.id)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const updated = await prisma.sportCategory.update({ where: { id }, data });
    return NextResponse.json(updated);
  }

  if (body?.kind !== "type") return NextResponse.json({ error: "unknown_kind" }, { status: 400 });

  const parsed = typeUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { id, ...data } = parsed.data;
  const type = await prisma.workoutType.findUnique({ where: { id } });
  if (!type || type.userId !== session.user.id)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const updated = await prisma.workoutType.update({ where: { id }, data });

  // Shared types (e.g. "Race") are one conceptual type duplicated per sport —
  // propagate name/color/zone edits to every other copy, but not `order`,
  // which is per-sport list position.
  if (updated.isShared) {
    const { order, ...syncData } = data;
    if (Object.keys(syncData).length > 0) {
      await prisma.workoutType.updateMany({
        where: { userId: session.user.id, isShared: true, id: { not: id } },
        data: syncData,
      });
    }
  }

  return NextResponse.json(updated);
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
    if (type.isShared)
      return NextResponse.json({ error: "cannot_delete_shared_type" }, { status: 400 });
    await prisma.workoutType.delete({ where: { id } });
  }

  return NextResponse.json({ ok: true });
}
