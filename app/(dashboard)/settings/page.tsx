import { auth } from "@/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getStravaAuthUrl } from "@/lib/strava/client";
import { getGoogleAuthUrl } from "@/lib/google-calendar/client";
import { getCredentials } from "@/lib/config";
import { StravaConnectSection } from "./strava-connect";
import { GarminConnectSection } from "./garmin-connect";
import { GoogleCalendarConnectSection } from "./google-calendar-connect";
import { AISettingsSection } from "./ai-settings";
import { getGarminAuthUrl } from "@/lib/garmin/auth";

export default async function SettingsPage() {
  const session = await auth();
  const userId  = session!.user!.id!;

  // Prefer explicit NEXTAUTH_URL; fall back to request headers for dynamic origins
  const headersList  = await headers();
  const host         = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const proto        = headersList.get("x-forwarded-proto") ?? "http";
  const origin       = process.env.NEXTAUTH_URL ?? `${proto}://${host}`;
  const stravaCallback = `${origin}/api/strava/callback`;
  // Webhook must always point to the public domain (training.helgars.se), never localhost
  const webhookBaseUrl   = (process.env.NEXTAUTH_URL ?? origin).replace(/\/$/, "");
  const stravaWebhookUrl = `${webhookBaseUrl}/api/strava/webhook`;

  const garminCallbackUrl = `${origin}/api/garmin/callback`;
  const garminAuthUrl     = getGarminAuthUrl(garminCallbackUrl);

  const [stravaAccount, garminAccount, googleCalendarAccount, aiSettings, user, appConfig] =
    await Promise.all([
      prisma.stravaAccount.findUnique({ where: { userId } }),
      prisma.garminAccount.findUnique({ where: { userId }, select: { displayName: true } }),
      prisma.googleCalendarAccount.findUnique({ where: { userId } }),
      prisma.aISettings.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
      // App-level API config — read from this user's record
      // (admin sets it; non-admins get it from env vars via lib/config.ts)
      prisma.appConfig.findUnique({ where: { userId } }),
    ]);

  const isAdmin = !!user?.isAdmin;

  // Resolve credentials via the same chain as all API calls:
  // user's own AppConfig → admin's AppConfig → env vars.
  // This ensures non-admin users see the "Connect with Strava" button
  // even when only the admin has entered the developer credentials.
  const creds = await getCredentials(userId);
  const hasStravaClientId     = !!creds.stravaClientId;
  const hasStravaClientSecret = !!creds.stravaClientSecret;
  let stravaAuthUrl: string | null = null;
  if (hasStravaClientId && hasStravaClientSecret) {
    try { stravaAuthUrl = await getStravaAuthUrl(userId, stravaCallback); } catch { /* not configured */ }
  }

  const hasGoogleClientId     = !!creds.googleClientId;
  const hasGoogleClientSecret = !!creds.googleClientSecret;
  const googleCallback = `${origin}/api/google-calendar/callback`;
  let googleAuthUrl: string | null = null;
  if (hasGoogleClientId && hasGoogleClientSecret) {
    try { googleAuthUrl = await getGoogleAuthUrl(userId, googleCallback); } catch { /* not configured */ }
  }

  return (
    <>
      {/* ── Strava ── */}
      <IntegrationCard logo="🟠" name="Strava" description="Activity data source — all your training history" connected={!!stravaAccount}>
        <StravaConnectSection
          connected={!!stravaAccount}
          authUrl={stravaAuthUrl}
          callbackUrl={stravaCallback}
          lastSyncAt={stravaAccount?.lastSyncAt?.toISOString() ?? null}
          totalSynced={stravaAccount?.totalSynced ?? 0}
          hasClientId={hasStravaClientId}
          hasClientSecret={hasStravaClientSecret}
          isAdmin={isAdmin}
          syncMode={(appConfig?.stravaAutoSyncMode ?? "manual") as "manual" | "webhook" | "cron"}
          webhookSubscriptionId={appConfig?.stravaWebhookSubscriptionId ?? null}
          webhookUrl={stravaWebhookUrl}
        />
      </IntegrationCard>

      {/* ── Garmin ── */}
      <IntegrationCard logo="🔵" name="Garmin Connect" description="HRV, sleep, stress and readiness — used for readiness score and AI coach context" connected={!!garminAccount} badge="Optional">
        <GarminConnectSection
          connected={!!garminAccount}
          displayName={garminAccount?.displayName ?? null}
          garminAuthUrl={garminAuthUrl}
          origin={origin}
        />
      </IntegrationCard>

      {/* ── Google Calendar ── */}
      <IntegrationCard logo="📅" name="Google Calendar" description="Mirrors your planned workouts as all-day events on your calendar" connected={!!googleCalendarAccount} badge="Optional">
        <GoogleCalendarConnectSection
          connected={!!googleCalendarAccount}
          needsReconnect={!!googleCalendarAccount?.needsReconnect}
          authUrl={googleAuthUrl}
          callbackUrl={googleCallback}
          lastSyncAt={googleCalendarAccount?.lastSyncAt?.toISOString() ?? null}
          hasClientId={hasGoogleClientId}
          hasClientSecret={hasGoogleClientSecret}
          isAdmin={isAdmin}
        />
      </IntegrationCard>

      {/* ── AI Coach ── */}
      <IntegrationCard logo="🤖" name="AI Coach" description="Connect Claude, Gemini, NVIDIA NIM or Groq to power your virtual coach" connected={!!(aiSettings?.claudeApiKey || aiSettings?.geminiApiKey || aiSettings?.nvidiaApiKey || aiSettings?.groqApiKey)}>
        <AISettingsSection
          provider={aiSettings?.provider ?? "gemini"}
          hasClaudeKey={!!aiSettings?.claudeApiKey}
          hasGeminiKey={!!aiSettings?.geminiApiKey}
          hasNvidiaKey={!!aiSettings?.nvidiaApiKey}
          hasGroqKey={!!aiSettings?.groqApiKey}
          hasTavilyKey={!!aiSettings?.tavilyApiKey}
          nvidiaModel={aiSettings?.nvidiaModel ?? ""}
          groqModel={aiSettings?.groqModel ?? ""}
          monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
          currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
          geminiMonthlyBudget={aiSettings?.geminiMonthlyBudgetUsd ?? 5}
          geminiCurrentSpend={aiSettings?.geminiCurrentMonthSpendUsd ?? 0}
        />
      </IntegrationCard>
    </>
  );
}

function IntegrationCard({ logo, name, description, connected, badge, children }: {
  logo: string; name: string; description: string;
  connected: boolean; badge?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{logo}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-primary">{name}</h2>
            {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted border border-border">{badge}</span>}
            {connected && <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-accent/10 text-accent">Connected</span>}
          </div>
          <p className="text-xs text-muted mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
