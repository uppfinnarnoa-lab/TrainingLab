import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { backfillWeather } from "@/lib/weather/backfill";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(body.limit ?? 100, 500);

  const updated = await backfillWeather(session.user.id, limit);
  return NextResponse.json({ updated });
}
