import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeGarminCode } from "@/lib/garmin/client";
import { prisma } from "@/lib/db/prisma";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encrypt } from "@/lib/encrypt";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code) return NextResponse.redirect(new URL("/settings?garmin=denied", req.url));
  if (!verifyOAuthState(state, session.user.id))
    return NextResponse.redirect(new URL("/settings?garmin=csrf", req.url));

  const baseUrl = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/garmin/callback`;

  try {
    const data = await exchangeGarminCode(session.user.id, code, redirectUri);

    const encAccess  = encrypt(data.access_token);
    const encRefresh = encrypt(data.refresh_token);

    await prisma.garminAccount.upsert({
      where:  { userId: session.user.id },
      create: {
        userId:       session.user.id,
        accessToken:  encAccess,
        refreshToken: encRefresh,
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      },
      update: {
        accessToken:  encAccess,
        refreshToken: encRefresh,
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      },
    });

    return NextResponse.redirect(new URL("/settings?garmin=connected", req.url));
  } catch (e) {
    console.error("Garmin callback error:", e);
    return NextResponse.redirect(new URL("/settings?garmin=error", req.url));
  }
}
