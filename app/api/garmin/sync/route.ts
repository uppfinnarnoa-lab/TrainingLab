import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGarminDaily } from "@/lib/garmin/sync";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const gotData = await syncGarminDaily(session.user.id);
    return NextResponse.json({ ok: true, gotData });
  } catch (e) {
    console.error("Garmin sync error:", e);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
