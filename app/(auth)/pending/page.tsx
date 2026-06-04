import { LogoWordmark } from "@/components/logo";
import Link from "next/link";

export default function PendingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex flex-col items-center gap-2">
          <LogoWordmark size={52} />
        </div>
        <div className="rounded-2xl bg-surface border border-border p-8 shadow-lg space-y-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
            <span className="text-2xl">⏳</span>
          </div>
          <h2 className="text-lg font-semibold text-primary">Awaiting approval</h2>
          <p className="text-sm text-muted">
            Your account request has been received. You&apos;ll be able to sign in once it&apos;s been approved.
          </p>
          <Link
            href="/login"
            className="inline-block text-xs text-accent hover:underline mt-2"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
