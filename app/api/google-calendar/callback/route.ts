import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeGoogleCode, GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar/client";
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

  if (error || !code) return NextResponse.redirect(new URL("/settings?google=denied", req.url));
  if (!verifyOAuthState(state, session.user.id))
    return NextResponse.redirect(new URL("/settings?google=csrf", req.url));

  const baseUrl = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/google-calendar/callback`;

  try {
    const data = await exchangeGoogleCode(session.user.id, code, redirectUri);
    if (!data.refresh_token) {
      // Happens if the user has already granted consent before and Google
      // doesn't re-issue a refresh_token — access_type=offline + prompt=consent
      // on the auth URL should prevent this, but guard against it explicitly
      // rather than silently storing an account that can never refresh.
      return NextResponse.redirect(new URL("/settings?google=no_refresh_token", req.url));
    }

    await prisma.googleCalendarAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId:       session.user.id,
        accessToken:  encrypt(data.access_token),
        refreshToken: encrypt(data.refresh_token),
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
        scope:        data.scope ?? GOOGLE_CALENDAR_SCOPE,
      },
      update: {
        accessToken:  encrypt(data.access_token),
        refreshToken: encrypt(data.refresh_token),
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
        needsReconnect: false,
      },
    });

    invalidateCredentialsCache();
    return NextResponse.redirect(new URL("/settings?google=connected", req.url));
  } catch (e) {
    console.error("Google Calendar callback error:", e);
    return NextResponse.redirect(new URL("/settings?google=error", req.url));
  }
}
