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

/** Strava only ever allows one active subscription per client_id — ask Strava directly
 * rather than trusting our own DB, which can fall out of sync (e.g. a registration that
 * succeeded on Strava's side but failed to save locally, or a stale row from an earlier
 * callback_url scheme). Returns the real subscription id, or null if Strava has none. */
async function fetchStravaSubscriptionId(clientId: string, clientSecret: string): Promise<number | null> {
  const url = `${STRAVA_PUSH_API}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { id: number }[];
  return Array.isArray(data) && data.length > 0 ? data[0].id : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const config = await prisma.appConfig.findUnique({ where: { userId } });
  const creds  = await getCredentials(userId);

  let subscriptionId = config?.stravaWebhookSubscriptionId ?? null;

  // Reconcile against Strava's real state when we have credentials to check with —
  // catches subscriptions Strava knows about that our DB doesn't (or vice versa).
  if (creds.stravaClientId && creds.stravaClientSecret) {
    const realId = await fetchStravaSubscriptionId(creds.stravaClientId, creds.stravaClientSecret).catch(() => undefined);
    if (realId !== undefined && realId !== subscriptionId) {
      subscriptionId = realId;
      await prisma.appConfig.update({ where: { userId }, data: { stravaWebhookSubscriptionId: realId } }).catch(() => {});
    }
  }

  return Response.json({
    subscriptionId,
    syncMode: config?.stravaAutoSyncMode ?? "manual",
    active:   !!subscriptionId,
  });
}

async function deleteStravaSubscription(subscriptionId: number, clientId: string, clientSecret: string): Promise<boolean> {
  const res = await fetch(`${STRAVA_PUSH_API}/${subscriptionId}`, {
    method: "DELETE",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
  });
  return res.ok || res.status === 404;
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

  // Save token BEFORE calling Strava — Strava immediately validates our GET endpoint
  // using this token, so it must be in the DB before the outbound POST returns.
  await prisma.appConfig.upsert({
    where:  { userId },
    create: { userId, stravaWebhookToken: verifyToken },
    update: { stravaWebhookToken: verifyToken },
  });

  // Strava doesn't sign POST event payloads, so the shared secret is baked into the
  // callback_url itself as a path segment (not a query param — Strava appends its own
  // hub.* query params on the GET validation, which risks colliding with one already
  // there). The webhook route checks this path segment against `stravaWebhookToken`.
  const secureCallbackUrl = `${callbackUrl.replace(/\/$/, "")}/${verifyToken}`;

  const body = new URLSearchParams({
    client_id:     creds.stravaClientId,
    client_secret: creds.stravaClientSecret,
    callback_url:  secureCallbackUrl,
    verify_token:  verifyToken,
  });

  let res  = await fetch(STRAVA_PUSH_API, { method: "POST", body });
  let data = await res.json();

  // Strava only allows one subscription per client_id — if one already exists (e.g. from
  // an earlier callback_url scheme, or a partial registration our DB never recorded),
  // delete it and retry once instead of making the user hunt for it manually.
  const alreadyExists = !res.ok && Array.isArray(data?.errors) && data.errors.some((e: { code?: string }) => e.code === "already exists");
  if (alreadyExists) {
    const staleId = await fetchStravaSubscriptionId(creds.stravaClientId, creds.stravaClientSecret).catch(() => null);
    if (staleId) {
      await deleteStravaSubscription(staleId, creds.stravaClientId, creds.stravaClientSecret).catch(() => false);
      res  = await fetch(STRAVA_PUSH_API, { method: "POST", body });
      data = await res.json();
    }
  }

  if (!res.ok) {
    // Clean up the token we pre-saved so a retry starts fresh
    await prisma.appConfig.update({ where: { userId }, data: { stravaWebhookToken: null } }).catch(() => {});
    return Response.json({ error: data.message ?? "Strava registration failed", details: data }, { status: res.status });
  }

  // Store subscription ID (token already saved above)
  await prisma.appConfig.upsert({
    where:  { userId },
    create: { userId, stravaWebhookSubscriptionId: data.id, stravaWebhookToken: verifyToken, stravaAutoSyncMode: "webhook" },
    update: { stravaWebhookSubscriptionId: data.id, stravaAutoSyncMode: "webhook" },
  });

  return Response.json({ subscriptionId: data.id, active: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const config = await prisma.appConfig.findUnique({ where: { userId } });
  const creds   = await getCredentials(userId);

  // Fall back to asking Strava directly — our DB's id can be stale or missing entirely
  // (e.g. a subscription created before this row existed, or via an earlier manual curl).
  let subscriptionId = config?.stravaWebhookSubscriptionId ?? null;
  if (!subscriptionId && creds.stravaClientId && creds.stravaClientSecret) {
    subscriptionId = await fetchStravaSubscriptionId(creds.stravaClientId, creds.stravaClientSecret).catch(() => null);
  }
  if (!subscriptionId) return Response.json({ error: "No active subscription" }, { status: 404 });

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
