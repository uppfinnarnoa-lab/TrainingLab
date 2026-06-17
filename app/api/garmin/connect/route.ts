import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { loginWithGarmin } from "@/lib/garmin/auth";
import { encrypt } from "@/lib/encrypt";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // Rate-limit Garmin auth attempts per user (max 5 per 10 min) to avoid Garmin IP bans
  const rl = checkRateLimit(`garmin-connect:${userId}`, 5, 600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { email, password } = parsed.data;

  let tokens: Awaited<ReturnType<typeof loginWithGarmin>>;
  try {
    tokens = await loginWithGarmin(email, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "GARMIN_MFA_REQUIRED") {
      return NextResponse.json({ error: "mfa_required" }, { status: 422 });
    }
    if (msg === "GARMIN_INVALID_CREDENTIALS") {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    console.error(`[garmin/connect] Auth error for ${userId}:`, msg);
    return NextResponse.json({ error: "auth_failed" }, { status: 502 });
  }

  await prisma.garminAccount.upsert({
    where:  { userId },
    create: {
      userId,
      displayName:  tokens.displayName,
      accessToken:  encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt:    tokens.expiresAt,
    },
    update: {
      displayName:  tokens.displayName,
      accessToken:  encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt:    tokens.expiresAt,
    },
  });

  return NextResponse.json({ ok: true, displayName: tokens.displayName });
}
