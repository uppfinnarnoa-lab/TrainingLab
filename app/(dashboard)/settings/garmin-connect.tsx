"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, RefreshCw, Unplug } from "lucide-react";

interface Props {
  connected:   boolean;
  displayName: string | null;
}

export function GarminConnectSection({ connected, displayName }: Props) {
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [showPass,    setShowPass]    = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(connected);
  const [name,        setName]        = useState(displayName);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<"ok" | "error" | null>(null);

  async function connect() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const res = await fetch("/api/garmin/connect", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      const messages: Record<string, string> = {
        invalid_credentials: "Wrong email or password.",
        mfa_required:        "Garmin 2-factor authentication must be disabled for this integration.",
        too_many_attempts:   "Too many attempts — wait a few minutes.",
        auth_failed:         "Garmin authentication failed. Check your credentials and try again.",
        invalid_input:       "Invalid email address.",
      };
      setError(messages[data.error] ?? "Connection failed. Please try again.");
      return;
    }

    setIsConnected(true);
    setName(data.displayName ?? email.trim());
    setEmail("");
    setPassword("");
  }

  async function disconnect() {
    setLoading(true);
    await fetch("/api/garmin/disconnect", { method: "POST" });
    setIsConnected(false);
    setName(null);
    setLoading(false);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/garmin/sync", { method: "POST" });
    setSyncing(false);
    setSyncResult(res.ok ? "ok" : "error");
    setTimeout(() => setSyncResult(null), 4000);
  }

  if (isConnected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-accent">
          ✓ Connected{name ? ` as ${name}` : ""}. HRV, sleep, stress and readiness sync daily at 08:00.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={syncNow}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 disabled:opacity-40 transition"
          >
            {syncing && <Loader2 size={14} className="animate-spin" />}
            {!syncing && <RefreshCw size={14} />}
            Sync now
            {syncResult === "ok"    && <span className="text-accent ml-1">✓</span>}
            {syncResult === "error" && <span className="text-red-400 ml-1">✗</span>}
          </button>

          <button
            onClick={disconnect}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 disabled:opacity-40 transition"
          >
            <Unplug size={14} />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Enter your Garmin Connect login. Your password is used only once to obtain a long-lived
        token and is never stored.
        <br />
        <span className="text-amber-400">Note: Garmin 2-factor authentication must be disabled.</span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted mb-1 block">Garmin email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            className={inp}
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Password</label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Garmin password"
              autoComplete="current-password"
              className={`${inp} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
              aria-label={showPass ? "Hide password" : "Show password"}
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={connect}
        disabled={loading || !email.trim() || !password}
        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        Connect Garmin
      </button>
    </div>
  );
}

const inp =
  "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
