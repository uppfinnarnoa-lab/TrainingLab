import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { stravaFetch } from "@/lib/strava/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify ownership and check for cached stream
  const activity = await prisma.activity.findUnique({
    where: { id },
    select: { userId: true, stravaId: true, stream: true },
  });
  if (!activity || activity.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Return cached stream if available — reconstruct the Strava-shaped object
  if (activity.stream) {
    const s = activity.stream;
    const cached: Record<string, unknown> = {};
    if (s.time)      cached.time             = s.time;
    if (s.distance)  cached.distance         = s.distance;
    if (s.altitude)  cached.altitude         = s.altitude;
    if (s.heartrate) cached.heartrate        = s.heartrate;
    if (s.velocity)  cached.velocity_smooth  = s.velocity;
    if (s.cadence)   cached.cadence          = s.cadence;
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=604800" },
    });
  }

  // Fetch live from Strava
  let streams: Record<string, { data: unknown[] }>;
  try {
    streams = await stravaFetch(
      session.user.id,
      `/activities/${activity.stravaId}/streams`,
      {
        keys: "time,distance,heartrate,velocity_smooth,altitude,cadence",
        key_by_type: "true",
      },
    );
  } catch (e) {
    console.error("[streams] Strava fetch failed:", e);
    return NextResponse.json({ error: "streams_unavailable" }, { status: 503 });
  }

  // Compute Heart Rate Recovery: HR drop over 60s after the peak HR sample
  let hrrSeconds: number | null = null;
  const hrData = streams.heartrate?.data as number[] | undefined;
  if (hrData && hrData.length > 70) {
    const peakIdx = hrData.indexOf(Math.max(...hrData));
    const afterIdx = Math.min(peakIdx + 60, hrData.length - 1);
    if (afterIdx > peakIdx + 30) {
      hrrSeconds = hrData[peakIdx] - hrData[afterIdx];
    }
  }

  // Cache stream and HRR in DB (fire-and-forget — don't block the response)
  prisma.activityStream.create({
    data: {
      activityId: id,
      time:      streams.time?.data      ? streams.time      : undefined,
      distance:  streams.distance?.data  ? streams.distance  : undefined,
      altitude:  streams.altitude?.data  ? streams.altitude  : undefined,
      heartrate: streams.heartrate?.data ? streams.heartrate : undefined,
      velocity:  streams.velocity_smooth?.data ? streams.velocity_smooth : undefined,
      cadence:   streams.cadence?.data   ? streams.cadence   : undefined,
    },
  }).then(() => {
    if (hrrSeconds !== null) {
      return prisma.activity.update({ where: { id }, data: { hrrSeconds } });
    }
  }).catch((e: unknown) => console.error("[streams] cache write error", e));

  return NextResponse.json(streams, {
    headers: { "Cache-Control": "private, max-age=604800" },
  });
}
