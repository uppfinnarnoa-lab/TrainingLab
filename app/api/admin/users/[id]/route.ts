import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const schema = z.object({ action: z.enum(["approve", "reject", "revoke"]) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  // @ts-expect-error custom field
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // Admin cannot change their own status
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot modify your own account status." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  const newStatus = parsed.data.action === "approve" ? "active" : "rejected";

  const updated = await prisma.user.update({
    where: { id },
    data: { status: newStatus },
    select: { id: true, email: true, status: true },
  });

  // On approval: copy admin's sport categories + workout types as defaults
  if (parsed.data.action === "approve") {
    const adminId = session.user.id!;
    const [sports, types] = await Promise.all([
      prisma.sportCategory.findMany({ where: { userId: adminId } }),
      prisma.workoutType.findMany({ where: { userId: adminId } }),
    ]);

    // Map old sport IDs to new IDs for workout type FK
    const sportIdMap = new Map<string, string>();
    for (const sport of sports) {
      const { id: _old, userId: _u, ...rest } = sport;
      const created = await prisma.sportCategory.create({
        data: { ...rest, userId: id },
      });
      sportIdMap.set(sport.id, created.id);
    }
    for (const type of types) {
      const newSportId = sportIdMap.get(type.sportId);
      if (!newSportId) continue;
      const { id: _old, userId: _u, sportId: _s, ...rest } = type;
      await prisma.workoutType.create({
        data: { ...rest, userId: id, sportId: newSportId },
      });
    }
  }

  return NextResponse.json(updated);
}
