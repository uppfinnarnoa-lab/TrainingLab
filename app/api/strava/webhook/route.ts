/**
 * Strava Webhook — Event Subscriptions API
 *
 * GET  /api/strava/webhook  — Strava validation challenge (called once at subscription time)
 * POST /api/strava/webhook  — Incoming push events (activity create/update/delete)
 *
 * Activation: after deploying to a public domain, register once with:
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -d "client_id=..." -d "client_secret=..." \
 *     -d "callback_url=https://yourdomain.com/api/strava/webhook" \
 *     -d "verify_token=STRAVA_WEBHOOK_VERIFY_TOKEN"
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { syncSingleActivity, deleteStravaActivity, resyncRecentActivities } from "@/lib/strava/sync";
import { backfillWeather } from "@/lib/weather/backfill";
import { backfillRunner } from "@/lib/strava/backfill-runner";

// GET — Strava sends this to verify the endpoint during subscription setup
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe") return new Response("Forbidden", { status: 403 });

  // Check against DB token (set when registering) or env fallback
  const config = await prisma.appConfig.findFirst({ select: { stravaWebhookToken: true } });
  const validToken = config?.stravaWebhookToken ?? process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!validToken || token !== validToken) return new Response("Forbidden", { status: 403 });

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
export async function POST(req: NextRequest) {
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
