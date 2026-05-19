import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Dashboard</h1>
        <p className="text-muted text-sm mt-1">Welcome back, {session?.user?.name ?? session?.user?.email}</p>
      </div>

      {/* Placeholder cards — will be filled out in Phase 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {["This Week", "This Month", "Year to Date", "Readiness"].map((label) => (
          <div
            key={label}
            className="rounded-xl bg-surface border border-border p-5 shadow-sm"
          >
            <p className="text-xs font-medium text-muted uppercase tracking-wide">{label}</p>
            <p className="mt-2 text-2xl font-semibold font-mono text-primary">—</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-surface border border-border p-6">
        <h2 className="text-base font-medium text-primary mb-1">Getting started</h2>
        <p className="text-sm text-muted">
          Connect your Strava account in{" "}
          <a href="/settings" className="text-accent hover:underline">Settings</a>{" "}
          to start syncing your training history.
        </p>
      </div>
    </div>
  );
}
