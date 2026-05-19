import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeGarminCode } from "@/lib/garmin/client";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?garmin=denied", req.url));

  try {
    const data = await exchangeGarminCode(code);

    await prisma.garminAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      update: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });

    return NextResponse.redirect(new URL("/settings?garmin=connected", req.url));
  } catch (e) {
    console.error("Garmin callback error:", e);
    return NextResponse.redirect(new URL("/settings?garmin=error", req.url));
  }
}
