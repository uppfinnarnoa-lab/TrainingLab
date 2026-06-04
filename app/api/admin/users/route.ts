import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  // @ts-expect-error custom field
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, status: true, isAdmin: true, createdAt: true },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(users);
}
