import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { invalidateCredentialsCache } from "@/lib/config";
import { encryptIfNeeded } from "@/lib/encrypt";
import { z } from "zod";

const schema = z.object({
  stravaClientId:     z.string().optional().nullable(),
  stravaClientSecret: z.string().optional().nullable(),
  garminClientId:     z.string().optional().nullable(),
  garminClientSecret: z.string().optional().nullable(),
  googleClientId:     z.string().optional().nullable(),
  googleClientSecret: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // Encrypt secrets before storing; only update fields explicitly provided
  const data: Record<string, string | null> = {};
  if (parsed.data.stravaClientId     !== undefined) data.stravaClientId     = parsed.data.stravaClientId ?? null;
  if (parsed.data.stravaClientSecret !== undefined) data.stravaClientSecret = encryptIfNeeded(parsed.data.stravaClientSecret);
  if (parsed.data.garminClientId     !== undefined) data.garminClientId     = parsed.data.garminClientId ?? null;
  if (parsed.data.garminClientSecret !== undefined) data.garminClientSecret = encryptIfNeeded(parsed.data.garminClientSecret);
  if (parsed.data.googleClientId     !== undefined) data.googleClientId     = parsed.data.googleClientId ?? null;
  if (parsed.data.googleClientSecret !== undefined) data.googleClientSecret = encryptIfNeeded(parsed.data.googleClientSecret);

  await prisma.appConfig.upsert({
    where:  { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  invalidateCredentialsCache();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { userId: session.user.id } });

  // Return only whether each credential is set, never the secrets themselves
  return NextResponse.json({
    hasStravaClientId:     !!(config?.stravaClientId    || process.env.STRAVA_CLIENT_ID),
    hasStravaClientSecret: !!(config?.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET),
    hasGarminClientId:     !!(config?.garminClientId    || process.env.GARMIN_CLIENT_ID),
    hasGarminClientSecret: !!(config?.garminClientSecret || process.env.GARMIN_CLIENT_SECRET),
    hasGoogleClientId:     !!(config?.googleClientId    || process.env.GOOGLE_CLIENT_ID),
    hasGoogleClientSecret: !!(config?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET),
    stravaClientIdHint:    config?.stravaClientId ? `${config.stravaClientId.slice(0, 4)}…` : null,
  });
}
