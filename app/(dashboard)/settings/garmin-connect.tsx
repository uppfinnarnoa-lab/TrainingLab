"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, RefreshCw, Unplug, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  connected:      boolean;
  displayName:    string | null;
  garminAuthUrl:  string;
}

export function GarminConnectSection({ connected, displayName, garminAuthUrl }: Props) {
  const searchParams = useSearchParams();

  const [isConnected, setIsConnected] = useState(connected);
  const [name,        setName]        = useState(displayName);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<"ok" | "error" | null>(null);
  const [loading,     setLoading]     = useState(false);

  // Manual fallback form
  const [showManual,  setShowManual]  = useState(false);
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [showPass,    setShowPass]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Handle redirect-back status (?garmin=connected / ?garmin=error)
  useEffect(() => {
    const status = searchParams.get("garmin");
    if (status === "connected") {
      setIsConnected(true);
      // Remove the query param without full reload
      window.history.replaceState({}, "", "/settings");
    } else if (status === "error") {
      setError("Garmin connection failed — the service ticket could not be exchanged. Try the manual form below.");
      setShowManual(true);
      window.history.replaceState({}, "", "/settings");
    } else if (status === "no_ticket") {
      setError("Garmin did not return a service ticket. They may not allow our callback URL — use the manual form below.");
      setShowManual(true);
      window.history.replaceState({}, "", "/settings");
    }
  }, [searchParams]);

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

  async function connectManual() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const res  = await fetch("/api/garmin/connect", {
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
        server_blocked:      "Garmin blocked the server request (bot-detection). Try the OAuth button above instead.",
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

  if (isConnected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-accent">
          ✓ Connected{name ? ` as ${name}` : ""}. HRV, sleep, stress and readiness sync daily at 20:00.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={syncNow}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 disabled:opacity-40 transition"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
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
        Connect your personal Garmin Connect account. Your credentials are used only to obtain
        a long-lived token and are never stored.
      </p>

      {/* Primary: OAuth redirect — browser handles auth, bypasses server bot-detection */}
      <a
        href={garminAuthUrl}
        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
      >
        Connect with Garmin
      </a>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Fallback: manual email/password (hidden by default) */}
      <div>
        <button
          onClick={() => setShowManual(v => !v)}
          className="flex items-center gap-1 text-xs text-muted hover:text-primary transition"
        >
          {showManual ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showManual ? "Hide manual connection" : "Connect manually instead (email + password)"}
        </button>

        {showManual && (
          <div className="mt-3 space-y-3 pl-1 border-l-2 border-border">
            <p className="text-xs text-amber-400">Note: Garmin 2-factor authentication must be disabled.</p>
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
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={connectManual}
              disabled={loading || !email.trim() || !password}
              className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 disabled:opacity-40 transition"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Connect manually
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inp =
  "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
