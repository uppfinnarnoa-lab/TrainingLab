/**
 * Strava Webhook — Event Subscriptions API
 *
 * GET  /api/strava/webhook/<secret>  — Strava validation challenge (called once at subscription time)
 * POST /api/strava/webhook/<secret>  — Incoming push events (activity create/update/delete)
 *
 * Strava does not sign POST event payloads (unlike Stripe/GitHub webhooks), so the
 * shared secret lives in the URL *path* rather than a query string — Strava appends
 * its own hub.* params to whatever callback_url was registered, and a query-string
 * secret risks colliding with that append if Strava doesn't insert the "&" correctly
 * (confirmed: a literal extra "?" instead of "&" makes hub.mode unparseable and the
 * GET handshake fail with exactly the "does not return 200" error Strava reports).
 * A path segment can't collide with query params at all, so it's used here instead.
 *
 * Register (and re-register if rotating the secret) with:
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -d "client_id=..." -d "client_secret=..." \
 *     -d "callback_url=https://yourdomain.com/api/strava/webhook/STRAVA_WEBHOOK_VERIFY_TOKEN" \
 *     -d "verify_token=STRAVA_WEBHOOK_VERIFY_TOKEN"
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { syncSingleActivity, deleteStravaActivity, resyncRecentActivities } from "@/lib/strava/sync";
import { backfillWeather } from "@/lib/weather/backfill";
import { backfillRunner } from "@/lib/strava/backfill-runner";

async function getValidWebhookToken(): Promise<string | undefined> {
  // Only one Strava push subscription can ever be active app-wide, so the row that
  // currently holds a non-null token is "the" one — not just whichever row happens to
  // sort first (matters once there's more than one User/AppConfig row in the table).
  const config = await prisma.appConfig.findFirst({
    where:  { stravaWebhookToken: { not: null } },
    select: { stravaWebhookToken: true },
  });
  return config?.stravaWebhookToken ?? process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
}

type RouteParams = { params: Promise<{ secret: string }> };

// GET — Strava sends this to verify the endpoint during subscription setup
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { secret } = await params;
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe") {
    console.warn(`[strava/webhook] GET validation: unexpected hub.mode=${mode}`);
    return new Response("Forbidden", { status: 403 });
  }

  const validToken = await getValidWebhookToken();
  if (!validToken || secret !== validToken || token !== validToken) {
    console.warn(`[strava/webhook] GET validation mismatch — path secret="${secret}" hub.verify_token="${token}" expected="${validToken}"`);
    return new Response("Forbidden", { status: 403 });
  }

  return Response.json({ "hub.challenge": challenge });
}

interface StravaEvent {
  aspect_type:  "create" | "update" | "delete";
  object_type:  "activity" | "athlete";
  object_id:    number;   // stravaActivityId (activity) or athleteId (athlete)
  owner_id:     number;   // Strava athlete ID
  subscription_id: number;
  event_time:   number;   // unix timestamp
  updates?:     Record<string, unknown>;
}

// POST — incoming event (must respond 200 within 2 s; processing is async)
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { secret } = await params;
  const validToken = await getValidWebhookToken();
  if (!validToken || secret !== validToken) return new Response("Forbidden", { status: 403 });

  let event: StravaEvent;
  try {
    event = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Fire-and-forget — Strava only needs the 200
  handleEvent(event).catch(err => console.error("[webhook] event handling failed", err));

  return new Response(null, { status: 200 });
}

async function handleEvent(event: StravaEvent): Promise<void> {
  if (event.object_type !== "activity") return;

  // Look up the user by their Strava athlete ID
  const stravaAccount = await prisma.stravaAccount.findUnique({
    where: { athleteId: BigInt(event.owner_id) },
    select: { userId: true },
  });
  if (!stravaAccount) return;

  const { userId } = stravaAccount;

  if (event.aspect_type === "create" || event.aspect_type === "update") {
    // Webhook syncs take priority over an in-progress historical backfill —
    // pause it so the backfill doesn't eat the Strava rate limit while we sync.
    backfillRunner.pause(userId);
    try {
      await syncSingleActivity(userId, event.object_id);
      // Fetch weather for the newly synced activity (limit 1 — just the newest missing)
      backfillWeather(userId, 1).catch(e => console.error("[webhook] weather fetch error", e));
      // Strava doesn't send webhooks for description-only edits on older activities,
      // so re-check the last 3 days on every webhook sync to catch those updates.
      await resyncRecentActivities(userId, 3).catch(e => console.error("[webhook] resync error", e));
    } finally {
      backfillRunner.resume(userId);
    }
  } else if (event.aspect_type === "delete") {
    await deleteStravaActivity(userId, event.object_id);
  }
}
