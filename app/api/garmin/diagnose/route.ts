import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { diagnoseSsoPage } from "@/lib/garmin/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await diagnoseSsoPage();
  return NextResponse.json(result);
}
