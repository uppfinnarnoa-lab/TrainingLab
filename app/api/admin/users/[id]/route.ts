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

  return NextResponse.json(updated);
}
