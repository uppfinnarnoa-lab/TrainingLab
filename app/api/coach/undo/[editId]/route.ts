import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ editId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { editId } = await params;

  const edit = await prisma.coachEdit.findUnique({ where: { id: editId } });
  if (!edit || edit.userId !== userId)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (edit.undoneAt)
    return NextResponse.json({ error: "already_undone" }, { status: 409 });

  await applyRestore(edit.toolName, edit.entityId, edit.entityType, edit.previousStateJson, userId);

  await prisma.coachEdit.update({ where: { id: editId }, data: { undoneAt: new Date(), status: "undone" } });
  return NextResponse.json({ ok: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyRestore(toolName: string, entityId: string | null, _entityType: string | null, previousStateJson: unknown, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prev = previousStateJson as Record<string, any> | null;

  switch (toolName) {
    case "create_workout":
      if (entityId) await prisma.plannedWorkout.delete({ where: { id: entityId } }).catch(() => null);
      break;

    case "update_workout":
    case "delete_workout":
      if (!entityId || !prev) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.plannedWorkout.upsert({ where: { id: entityId }, create: { ...(prev as any), userId, id: entityId }, update: prev as any });
      break;

    case "create_training_block":
      if (entityId) await prisma.trainingBlock.delete({ where: { id: entityId } }).catch(() => null);
      break;

    case "update_training_block":
    case "delete_training_block":
      if (!entityId || !prev) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.trainingBlock.upsert({ where: { id: entityId }, create: { ...(prev as any), userId, id: entityId }, update: prev as any });
      break;

    case "log_race_result":
      if (entityId) await prisma.raceRecord.delete({ where: { id: entityId } }).catch(() => null);
      break;

    case "delete_race_result":
      if (!entityId || !prev) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.raceRecord.upsert({ where: { id: entityId }, create: { ...(prev as any), userId, id: entityId }, update: prev as any });
      break;

    case "update_activity_notes":
      if (!entityId || !prev) break;
      await prisma.activity.update({ where: { id: entityId }, data: { description: (prev as { description: string | null }).description } });
      break;

    case "update_profile":
      if (!prev) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.athleteProfile.upsert({ where: { userId }, create: { ...(prev as any), userId }, update: prev as any });
      break;

    default:
      break;
  }
}
