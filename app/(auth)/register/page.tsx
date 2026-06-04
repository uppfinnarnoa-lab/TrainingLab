"use client";
import { LogoWordmark } from "@/components/logo";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== password2) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
    } else {
      router.push("/pending");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-2">
          <LogoWordmark size={52} />
          <p className="text-sm text-muted">Your personal AI training coach</p>
        </div>

        <div className="rounded-2xl bg-surface border border-border p-8 shadow-lg space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-primary">Request access</h2>
            <p className="text-xs text-muted mt-1">Your account will be reviewed before you can sign in.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-muted mb-1.5">Name</label>
              <input
                id="name" type="text" autoComplete="name" required
                value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-muted mb-1.5">Email</label>
              <input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-muted mb-1.5">Password</label>
              <input
                id="password" type="password" autoComplete="new-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="password2" className="block text-sm font-medium text-muted mb-1.5">Confirm password</label>
              <input
                id="password2" type="password" autoComplete="new-password" required
                value={password2} onChange={(e) => setPassword2(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Request access
            </button>
          </form>

          <div className="border-t border-border pt-4 text-center">
            <p className="text-xs text-muted">
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
