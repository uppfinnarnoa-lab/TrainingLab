import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { getStravaAuthUrl } from "@/lib/strava/client";
import { getGarminAuthUrl } from "@/lib/garmin/client";
import { StravaConnectSection } from "./strava-connect";
import { GarminConnectSection } from "./garmin-connect";
import { AISettingsSection } from "./ai-settings";

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [stravaAccount, garminAccount, aiSettings] = await Promise.all([
    prisma.stravaAccount.findUnique({ where: { userId } }),
    prisma.garminAccount.findUnique({ where: { userId } }),
    prisma.aISettings.findUnique({ where: { userId } }),
  ]);

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted mt-1">Connect your services and configure your coach</p>
      </div>

      {/* ── Strava ── */}
      <IntegrationCard
        logo="🟠"
        name="Strava"
        description="Activity data source — all your training history"
        connected={!!stravaAccount}
      >
        <StravaConnectSection
          connected={!!stravaAccount}
          authUrl={getStravaAuthUrl()}
          lastSyncAt={stravaAccount?.lastSyncAt?.toISOString() ?? null}
          totalSynced={stravaAccount?.totalSynced ?? 0}
        />
      </IntegrationCard>

      {/* ── Garmin ── */}
      <IntegrationCard
        logo="🔵"
        name="Garmin Connect"
        description="HRV and sleep data — used for readiness score and coach context"
        connected={!!garminAccount}
        badge="Optional"
      >
        <GarminConnectSection
          connected={!!garminAccount}
          authUrl={getGarminAuthUrl()}
        />
      </IntegrationCard>

      {/* ── AI Coach ── */}
      <IntegrationCard
        logo="🤖"
        name="AI Coach"
        description="Connect Claude or Gemini to power your virtual coach"
        connected={!!(aiSettings?.claudeApiKey || aiSettings?.geminiApiKey)}
      >
        <AISettingsSection
          provider={aiSettings?.provider ?? "gemini"}
          hasClaudeKey={!!aiSettings?.claudeApiKey}
          hasGeminiKey={!!aiSettings?.geminiApiKey}
          monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
          currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
        />
      </IntegrationCard>
    </div>
  );
}

function IntegrationCard({
  logo,
  name,
  description,
  connected,
  badge,
  children,
}: {
  logo: string;
  name: string;
  description: string;
  connected: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{logo}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-primary">{name}</h2>
            {badge && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted border border-border">
                {badge}
              </span>
            )}
            {connected && (
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-accent/10 text-accent">
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
