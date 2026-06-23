import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pushUpcomingWorkouts } from "@/lib/google-calendar/sync";

// Explicit, user-initiated backfill — pushes every future PlannedWorkout that
// doesn't have a googleEventId yet. See docs/integrations/google-calendar.md.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await pushUpcomingWorkouts(session.user.id);
  return NextResponse.json(result);
}
