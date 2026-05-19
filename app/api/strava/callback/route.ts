import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeStravaCode } from "@/lib/strava/client";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/settings?strava=denied", req.url));
  }

  try {
    const data = await exchangeStravaCode(code);

    await prisma.stravaAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        athleteId: BigInt(data.athlete.id),
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(data.expires_at * 1000),
        scope: data.scope ?? "read,activity:read_all",
      },
      update: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(data.expires_at * 1000),
      },
    });

    return NextResponse.redirect(new URL("/settings?strava=connected", req.url));
  } catch (e) {
    console.error("Strava callback error:", e);
    return NextResponse.redirect(new URL("/settings?strava=error", req.url));
  }
}
