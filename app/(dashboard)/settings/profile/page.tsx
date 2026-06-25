import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { AthleteProfileForm } from "../athlete-profile";
import { ChangePasswordForm } from "../change-password";
import { AppearanceSettings } from "../appearance-settings";
import { PBDetectionSettings } from "../pb-detection";
import { normalizeAnnualGoalsYear, type AnnualGoal } from "@/lib/sports/annual-goal-metric";

function normalizeAllYears(raw: unknown): Record<string, Record<string, AnnualGoal>> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, Record<string, AnnualGoal>> = {};
  for (const [year, yearGoals] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    out[year] = normalizeAnnualGoalsYear(yearGoals);
  }
  return out;
}

export default async function ProfileSettingsPage() {
  const session = await auth();
  const userId  = session!.user!.id!;

  const [user, athleteProfile, sports] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.sportCategory.findMany({ where: { userId }, select: { name: true }, orderBy: { order: "asc" } }),
  ]);

  return (
    <>
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
          manualLT1HR: athleteProfile?.manualLT1HR,
          manualLT2HR: athleteProfile?.manualLT2HR,
          maxHRArtifactCap: athleteProfile?.maxHRArtifactCap,
          primaryGoal: athleteProfile?.primaryGoal,
          yearsTraining: athleteProfile?.yearsTraining,
          paceUnit: athleteProfile?.paceUnit ?? "min_per_km",
          annualGoals: normalizeAllYears(athleteProfile?.annualGoals),
        }} sports={sports.map((s: { name: string }) => s.name)} />
      </section>

      {/* ── PB detection ── */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-primary">Personal best detection</h2>
          <p className="text-xs text-muted mt-0.5">Automatically track new race results from synced Strava activities, and backfill or clean up past results</p>
        </div>
        <PBDetectionSettings initial={{
          pbDetectionMode: athleteProfile?.pbDetectionMode ?? "manual",
          pbDetectionTolerancePct: athleteProfile?.pbDetectionTolerancePct ?? 5,
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
    </>
  );
}
