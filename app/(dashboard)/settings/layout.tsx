import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted mt-1">Connect your services, manage your profile, and configure your coach</p>
      </div>
      <SettingsNav />
      <div className="space-y-8">{children}</div>
    </div>
  );
}
