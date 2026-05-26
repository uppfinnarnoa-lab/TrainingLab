import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeStravaCode } from "@/lib/strava/client";
import { prisma } from "@/lib/db/prisma";
import { invalidateCredentialsCache } from "@/lib/config";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encrypt } from "@/lib/encrypt";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state");

  if (error || !code) return NextResponse.redirect(new URL("/settings?strava=denied", req.url));
  if (!verifyOAuthState(state, session.user.id))
    return NextResponse.redirect(new URL("/settings?strava=csrf", req.url));

  const baseUrl = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/strava/callback`;

  try {
    const data = await exchangeStravaCode(session.user.id, code, redirectUri);

    const encAccess  = encrypt(data.access_token);
    const encRefresh = encrypt(data.refresh_token);

    await prisma.stravaAccount.upsert({
      where:  { userId: session.user.id },
      create: {
        userId:       session.user.id,
        athleteId:    BigInt(data.athlete.id),
        accessToken:  encAccess,
        refreshToken: encRefresh,
        expiresAt:    new Date(data.expires_at * 1000),
        scope:        data.scope ?? "read,activity:read_all",
      },
      update: {
        accessToken:  encAccess,
        refreshToken: encRefresh,
        expiresAt:    new Date(data.expires_at * 1000),
      },
    });

    invalidateCredentialsCache();
    return NextResponse.redirect(new URL("/settings?strava=connected", req.url));
  } catch (e) {
    console.error("Strava callback error:", e);
    return NextResponse.redirect(new URL("/settings?strava=error", req.url));
  }
}
