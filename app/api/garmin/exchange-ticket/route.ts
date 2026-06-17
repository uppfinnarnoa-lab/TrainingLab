import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { CookieJar, ticketToOAuth1, oauth1ToOAuth2, fetchDisplayName } from "@/lib/garmin/auth";
import { encrypt } from "@/lib/encrypt";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const ticket = typeof body.ticket === "string" ? body.ticket.trim() : null;

  if (!ticket || !ticket.startsWith("ST-")) {
    return NextResponse.json({ error: "invalid_ticket" }, { status: 400 });
  }

  try {
    const jar                         = new CookieJar();
    const { token, secret, mfaToken } = await ticketToOAuth1(ticket, jar);
    const tokens                      = await oauth1ToOAuth2(token, secret, jar, mfaToken);
    const displayName                 = await fetchDisplayName(tokens.accessToken);

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

    return NextResponse.json({ ok: true, displayName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[garmin/exchange-ticket] Token exchange failed:", msg);
    return NextResponse.json({ error: "exchange_failed", detail: msg }, { status: 502 });
  }
}
