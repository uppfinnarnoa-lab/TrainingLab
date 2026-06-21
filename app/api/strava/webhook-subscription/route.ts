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

// Strava's documented DELETE format takes client_id/client_secret as *query params*
// on the URL, not a request body — confirmed live this was the actual bug: sending them
// as a body made the call return a "successful"-looking response without deleting
// anything (the subscription was still there on every check, even after a 20s poll wait).
async function deleteStravaSubscription(subscriptionId: number, clientId: string, clientSecret: string): Promise<boolean> {
  const url = `${STRAVA_PUSH_API}/${subscriptionId}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const res = await fetch(url, { method: "DELETE" });
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
  // delete it and retry instead of making the user hunt for it manually.
  //
  // Confirmed live this isn't a one-shot race: deleteStravaSubscription() reported success,
  // but Strava's own "does a subscription exist" check immediately after still found the
  // exact same id, every time, for 3 straight attempts with a fixed 1.5s delay — Strava's
  // delete is not immediately consistent. So instead of guessing a longer fixed delay, poll
  // fetchStravaSubscriptionId() after the delete until Strava itself confirms the id is gone
  // (or give up after ~20s) before attempting to recreate.
  for (let attempt = 0; attempt < 2; attempt++) {
    const alreadyExists = !res.ok && Array.isArray(data?.errors) && data.errors.some((e: { code?: string }) => e.code === "already exists");
    if (!alreadyExists) break;

    console.warn(`[strava/webhook-subscription] registration attempt ${attempt + 1} got "already exists" — looking up the stale subscription`);
    const staleId = await fetchStravaSubscriptionId(creds.stravaClientId, creds.stravaClientSecret).catch(e => {
      console.error("[strava/webhook-subscription] fetchStravaSubscriptionId failed:", e instanceof Error ? e.message : e);
      return null;
    });
    console.warn(`[strava/webhook-subscription] stale subscription id from Strava: ${staleId}`);
    if (!staleId) break;

    const deleted = await deleteStravaSubscription(staleId, creds.stravaClientId, creds.stravaClientSecret).catch(e => {
      console.error("[strava/webhook-subscription] deleteStravaSubscription threw:", e instanceof Error ? e.message : e);
      return false;
    });
    console.warn(`[strava/webhook-subscription] delete of ${staleId} ${deleted ? "succeeded" : "failed"}`);
    if (!deleted) break;

    // The real bug here turned out to be deleteStravaSubscription() sending credentials as a
    // request body instead of query params (Strava silently no-ops + returns 404 rather than
    // actually deleting) — now fixed, so this should normally clear on the first check. Kept
    // as a short safety-net poll rather than removed outright, in case of genuine propagation
    // delay on Strava's side.
    let gone = false;
    for (let poll = 0; poll < 5; poll++) {
      await new Promise(r => setTimeout(r, 1000));
      const stillThereId: number | null = await fetchStravaSubscriptionId(creds.stravaClientId, creds.stravaClientSecret).catch((): number => staleId);
      console.warn(`[strava/webhook-subscription] poll ${poll + 1}/5 after delete — subscription id now: ${stillThereId}`);
      if (stillThereId !== staleId) { gone = true; break; }
    }
    if (!gone) {
      console.warn("[strava/webhook-subscription] gave up waiting for Strava's delete to propagate — retrying anyway");
    }

    res  = await fetch(STRAVA_PUSH_API, { method: "POST", body });
    data = await res.json();
    console.warn(`[strava/webhook-subscription] retry POST after delete: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
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

  const deleted = await deleteStravaSubscription(subscriptionId, creds.stravaClientId ?? "", creds.stravaClientSecret ?? "");
  if (!deleted) {
    return Response.json({ error: "Failed to delete subscription" }, { status: 502 });
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
