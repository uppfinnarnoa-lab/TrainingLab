import { auth } from "@/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getStravaAuthUrl } from "@/lib/strava/client";
import { getGarminAuthUrl } from "@/lib/garmin/client";
import { StravaConnectSection } from "./strava-connect";
import { GarminConnectSection } from "./garmin-connect";
import { AISettingsSection } from "./ai-settings";
import { AthleteProfileForm } from "./athlete-profile";
import { ChangePasswordForm } from "./change-password";
import { AppearanceSettings } from "./appearance-settings";

export default async function SettingsPage() {
  const session = await auth();
  const userId  = session!.user!.id!;

  // Prefer explicit NEXTAUTH_URL; fall back to request headers for dynamic origins
  const headersList  = await headers();
  const host         = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const proto        = headersList.get("x-forwarded-proto") ?? "http";
  const origin       = process.env.NEXTAUTH_URL ?? `${proto}://${host}`;
  const stravaCallback = `${origin}/api/strava/callback`;
  const garminCallback = `${origin}/api/garmin/callback`;

  const [stravaAccount, garminAccount, aiSettings, user, athleteProfile, appConfig] =
    await Promise.all([
      prisma.stravaAccount.findUnique({ where: { userId } }),
      prisma.garminAccount.findUnique({ where: { userId } }),
      prisma.aISettings.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, isAdmin: true } }),
      prisma.athleteProfile.findUnique({ where: { userId } }),
      // App-level API config — read from this user's record
      // (admin sets it; non-admins get it from env vars via lib/config.ts)
      prisma.appConfig.findUnique({ where: { userId } }),
    ]);

  const isAdmin = !!user?.isAdmin;

  // Compute Strava auth URL — null if credentials not configured
  const hasStravaClientId     = !!(appConfig?.stravaClientId     || process.env.STRAVA_CLIENT_ID);
  const hasStravaClientSecret = !!(appConfig?.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET);
  const hasGarminClientId     = !!(appConfig?.garminClientId     || process.env.GARMIN_CLIENT_ID);
  const hasGarminClientSecret = !!(appConfig?.garminClientSecret || process.env.GARMIN_CLIENT_SECRET);

  let stravaAuthUrl: string | null = null;
  if (hasStravaClientId && hasStravaClientSecret) {
    try { stravaAuthUrl = await getStravaAuthUrl(userId, stravaCallback); } catch { /* not configured */ }
  }

  let garminAuthUrl: string | null = null;
  if (hasGarminClientId && hasGarminClientSecret) {
    try { garminAuthUrl = await getGarminAuthUrl(userId, garminCallback); } catch { /* not configured */ }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted mt-1">Connect your services and configure your coach</p>
      </div>

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
        />
      </IntegrationCard>

      {/* ── Garmin ── */}
      <IntegrationCard logo="🔵" name="Garmin Connect" description="HRV and sleep data — used for readiness score and coach context" connected={!!garminAccount} badge="Optional">
        <GarminConnectSection
          connected={!!garminAccount}
          authUrl={garminAuthUrl}
          callbackUrl={garminCallback}
          hasClientId={hasGarminClientId}
          hasClientSecret={hasGarminClientSecret}
          isAdmin={isAdmin}
        />
      </IntegrationCard>

      {/* ── AI Coach ── */}
      <IntegrationCard logo="🤖" name="AI Coach" description="Connect Claude or Gemini to power your virtual coach" connected={!!(aiSettings?.claudeApiKey || aiSettings?.geminiApiKey)}>
        <AISettingsSection
          provider={aiSettings?.provider ?? "gemini"}
          hasClaudeKey={!!aiSettings?.claudeApiKey}
          hasGeminiKey={!!aiSettings?.geminiApiKey}
          monthlyBudget={aiSettings?.monthlyBudgetUsd ?? 5}
          currentSpend={aiSettings?.currentMonthSpendUsd ?? 0}
          geminiMonthlyBudget={aiSettings?.geminiMonthlyBudgetUsd ?? 5}
          geminiCurrentSpend={aiSettings?.geminiCurrentMonthSpendUsd ?? 0}
        />
      </IntegrationCard>

      {/* ── Athlete Profile ── */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-primary">Athlete Profile</h2>
          <p className="text-xs text-muted mt-0.5">Physical data used by your AI coach for personalized advice and accurate predictions</p>
        </div>
        <AthleteProfileForm initial={{
          name: user?.name,
          weightKg: athleteProfile?.weightKg,
          heightCm: athleteProfile?.heightCm,
          dateOfBirth: athleteProfile?.dateOfBirth?.toISOString() ?? null,
          sex: athleteProfile?.sex,
          maxHeartRate: athleteProfile?.maxHeartRate,
          restingHeartRate: athleteProfile?.restingHeartRate,
          primaryGoal: athleteProfile?.primaryGoal,
          yearsTraining: athleteProfile?.yearsTraining,
        }} />
      </section>

      {/* ── Appearance ── */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-primary">Appearance</h2>
          <p className="text-xs text-muted mt-0.5">Theme and display preferences</p>
        </div>
        <AppearanceSettings />
      </section>

      {/* ── Change password ── */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-primary">Change password</h2>
          <p className="text-xs text-muted mt-0.5">Update your login password</p>
        </div>
        <ChangePasswordForm />
      </section>
    </div>
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
