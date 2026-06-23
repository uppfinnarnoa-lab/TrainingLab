import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.googleCalendarAccount.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
