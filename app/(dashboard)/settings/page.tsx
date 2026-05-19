import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { getStravaAuthUrl } from "@/lib/strava/client";
import { StravaConnectSection } from "./strava-connect";

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const stravaAccount = await prisma.stravaAccount.findUnique({ where: { userId } });
  const stravaAuthUrl = getStravaAuthUrl();

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted mt-1">Manage your integrations and preferences</p>
      </div>

      {/* Strava */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <div>
            <h2 className="font-semibold text-primary">Strava</h2>
            <p className="text-xs text-muted">Activity data source</p>
          </div>
          {stravaAccount && (
            <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full bg-accent/10 text-accent">
              Connected
            </span>
          )}
        </div>

        <StravaConnectSection
          connected={!!stravaAccount}
          authUrl={stravaAuthUrl}
          lastSyncAt={stravaAccount?.lastSyncAt?.toISOString() ?? null}
          totalSynced={stravaAccount?.totalSynced ?? 0}
        />
      </section>

      {/* Garmin — placeholder */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">G</span>
          </div>
          <div>
            <h2 className="font-semibold text-primary">Garmin</h2>
            <p className="text-xs text-muted">HRV and sleep data</p>
          </div>
        </div>
        <p className="text-sm text-muted">Garmin integration coming soon.</p>
      </section>
    </div>
  );
}
