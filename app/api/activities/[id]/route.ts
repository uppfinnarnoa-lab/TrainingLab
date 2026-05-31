import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const patchSchema = z.object({
  customTypeName: z.string().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid", { status: 400 });

  const activity = await prisma.activity.findUnique({ where: { id }, select: { userId: true } });
  if (!activity || activity.userId !== userId) return new Response("Not found", { status: 404 });

  await prisma.activity.update({
    where: { id },
    data: { customTypeName: parsed.data.customTypeName },
  });

  return new Response("OK");
}
