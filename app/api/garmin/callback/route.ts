import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { CookieJar, ticketToOAuth1, oauth1ToOAuth2, fetchDisplayName } from "@/lib/garmin/auth";
import { encrypt } from "@/lib/encrypt";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const userId = session.user.id;

  const ticket = req.nextUrl.searchParams.get("ticket");
  if (!ticket) {
    return NextResponse.redirect(new URL("/settings?garmin=no_ticket", req.url));
  }

  try {
    // Exchange service ticket → OAuth1 → OAuth2 (server-to-server API, not SSO bot-detected)
    const jar = new CookieJar();
    const { token, secret } = await ticketToOAuth1(ticket, jar);
    const tokens            = await oauth1ToOAuth2(token, secret, jar);
    const displayName       = await fetchDisplayName(tokens.accessToken);

    await prisma.garminAccount.upsert({
      where:  { userId },
      create: {
        userId,
        displayName,
        accessToken:  encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
        expiresAt:    tokens.expiresAt,
      },
      update: {
        displayName,
        accessToken:  encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
        expiresAt:    tokens.expiresAt,
      },
    });

    return NextResponse.redirect(new URL("/settings?garmin=connected", req.url));
  } catch (e) {
    console.error("[garmin/callback] Token exchange failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings?garmin=error", req.url));
  }
}
