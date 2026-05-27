/**
 * Strava webhook subscription management.
 * GET    — returns current subscription status
 * POST   — registers a new Strava push subscription
 * DELETE — deletes the active subscription
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { getCredentials } from "@/lib/config";
import crypto from "crypto";

const STRAVA_PUSH_API = "https://www.strava.com/api/v3/push_subscriptions";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { userId: session.user.id } });
  return Response.json({
    subscriptionId: config?.stravaWebhookSubscriptionId ?? null,
    syncMode:       config?.stravaAutoSyncMode ?? "manual",
    active:         !!config?.stravaWebhookSubscriptionId,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { callbackUrl } = await req.json() as { callbackUrl: string };

  const creds = await getCredentials(userId);
  if (!creds.stravaClientId || !creds.stravaClientSecret) {
    return Response.json({ error: "Strava credentials not configured" }, { status: 400 });
  }

  // Generate a secure verify token for this subscription
  const verifyToken = crypto.randomBytes(32).toString("hex");

  const body = new URLSearchParams({
    client_id:     creds.stravaClientId,
    client_secret: creds.stravaClientSecret,
    callback_url:  callbackUrl,
    verify_token:  verifyToken,
  });

  const res = await fetch(STRAVA_PUSH_API, { method: "POST", body });
  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: data.message ?? "Strava registration failed", details: data }, { status: res.status });
  }

  // Store subscription ID + token
  await prisma.appConfig.upsert({
    where:  { userId },
    create: { userId, stravaWebhookSubscriptionId: data.id, stravaWebhookToken: verifyToken, stravaAutoSyncMode: "webhook" },
    update: { stravaWebhookSubscriptionId: data.id, stravaWebhookToken: verifyToken, stravaAutoSyncMode: "webhook" },
  });

  return Response.json({ subscriptionId: data.id, active: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const config = await prisma.appConfig.findUnique({ where: { userId } });
  const subscriptionId = config?.stravaWebhookSubscriptionId;
  if (!subscriptionId) return Response.json({ error: "No active subscription" }, { status: 404 });

  const creds = await getCredentials(userId);

  const res = await fetch(`${STRAVA_PUSH_API}/${subscriptionId}`, {
    method: "DELETE",
    body: new URLSearchParams({
      client_id:     creds.stravaClientId ?? "",
      client_secret: creds.stravaClientSecret ?? "",
    }),
  });

  // 204 = success, 404 = already gone — both are fine
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    return Response.json({ error: "Failed to delete subscription", details: data }, { status: res.status });
  }

  await prisma.appConfig.update({
    where:  { userId },
    data:   { stravaWebhookSubscriptionId: null, stravaWebhookToken: null },
  });

  return Response.json({ active: false });
}

/** PATCH — update sync mode without touching Strava subscription */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { syncMode } = await req.json() as { syncMode: "manual" | "webhook" | "cron" };

  await prisma.appConfig.upsert({
    where:  { userId },
    create: { userId, stravaAutoSyncMode: syncMode },
    update: { stravaAutoSyncMode: syncMode },
  });

  return Response.json({ ok: true, syncMode });
}
