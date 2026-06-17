"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, RefreshCw, Unplug, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  connected:     boolean;
  displayName:   string | null;
  garminAuthUrl: string;  // kept for compat
  origin:        string;  // e.g. "https://training.helgars.se"
}

// Garmin /sso/embed widget. Our `service` URL is not on Garmin's redirect whitelist
// (only connect.garmin.com is allowed there), so after login it always breaks out of
// any iframe/popup and lands on its own domain showing {serviceUrl, serviceTicket} as
// plain text - there's no way to intercept that programmatically. So: open it in a real
// tab and have the user paste the ticket back into the form below.
function buildEmbedUrl(origin: string) {
  const params = new URLSearchParams({
    id:                              "gauth-widget",
    embedWidget:                     "true",
    gauthHost:                       "https://sso.garmin.com",
    service:                         `${origin}/api/garmin/ticket-receiver`,
    source:                          "https://connect.garmin.com/signin/",
    redirectAfterAccountLoginUrl:    `${origin}/api/garmin/ticket-receiver`,
    redirectAfterAccountCreationUrl: `${origin}/api/garmin/ticket-receiver`,
    locale:                          "en_US",
    clientId:                        "GarminConnect",
    consumeServiceTicket:            "true",
    generateExtraServiceTicket:      "true",
    generateTwoExtraServiceTickets:  "true",
    generateNoServiceTicket:         "false",
    connectLegalTerms:               "true",
    showTermsOfUse:                  "false",
    showPrivacyPolicy:               "false",
    showConnectLegalAge:             "false",
    locationPromptShown:             "true",
    showPassword:                    "true",
    useCustomHeader:                 "false",
    globalOptInShown:                "true",
    globalOptInChecked:              "false",
    mobile:                          "false",
    rememberMeShown:                 "true",
    rememberMeChecked:               "false",
  });
  return `https://sso.garmin.com/sso/embed?${params}`;
}

export function GarminConnectSection({ connected, displayName, origin }: Props) {
  const [isConnected, setIsConnected] = useState(connected);
  const [name,        setName]        = useState(displayName);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<"ok" | "error" | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketInput,    setTicketInput]    = useState("");

  // Manual fallback
  const [showManual, setShowManual] = useState(false);
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [showPass,   setShowPass]   = useState(false);

  const embedUrl = buildEmbedUrl(origin);

  async function exchangeTicket(ticket: string) {
    setLoading(true);
    setError(null);

    const res  = await fetch("/api/garmin/exchange-ticket", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ticket }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    setLoading(false);

    if (!res.ok) {
      setError("Token exchange failed. The ticket may have expired - try again, or use the manual form below.");
      setShowManual(true);
      return;
    }

    setIsConnected(true);
    setName(typeof data.displayName === "string" ? data.displayName : null);
    setShowTicketForm(false);
    setTicketInput("");
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

  async function connectManual() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const res  = await fetch("/api/garmin/connect", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    setLoading(false);

    if (!res.ok) {
      const messages: Record<string, string> = {
        invalid_credentials: "Wrong email or password.",
        mfa_required:        "Garmin 2-factor authentication must be disabled for this integration.",
        too_many_attempts:   "Too many attempts — wait a few minutes.",
        server_blocked:      "Garmin is blocking the server. Try the \"Connect with Garmin\" login above.",
        auth_failed:         "Server-side authentication failed. Check PM2 logs for details.",
        invalid_input:       "Invalid email address.",
      };
      setError(messages[data.error as string] ?? "Connection failed. Please try again.");
      return;
    }

    setIsConnected(true);
    setName(typeof data.displayName === "string" ? data.displayName : email.trim());
    setEmail("");
    setPassword("");
  }

  if (isConnected) {
    return (
      <div className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Connecting…
          </div>
        )}
        {!loading && (
          <p className="text-sm text-accent">
            ✓ Connected{name ? ` as ${name}` : ""}. HRV, sleep, stress and readiness sync daily at 20:00.
          </p>
        )}
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
        Connect your Garmin Connect account. Your credentials go directly to Garmin — our server
        only receives the resulting access token, never your password.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Connecting…
        </div>
      )}

      {!loading && !showTicketForm && (
        <button
          onClick={() => { setShowTicketForm(true); setError(null); }}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
        >
          Connect with Garmin
        </button>
      )}

      {showTicketForm && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <ol className="list-decimal list-inside space-y-1 text-xs text-muted">
            <li>
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Open Garmin login in a new tab
              </a>{" "}
              and log in.
            </li>
            <li>
              You&apos;ll land on a page showing{" "}
              <span className="font-mono">serviceTicket: &apos;ST-...&apos;</span>.
            </li>
            <li>Copy just the <span className="font-mono">ST-...</span> value and paste it below.</li>
          </ol>
          <div className="flex gap-2">
            <input
              type="text"
              value={ticketInput}
              onChange={e => setTicketInput(e.target.value)}
              placeholder="ST-..."
              className={`${inp} font-mono`}
            />
            <button
              onClick={() => exchangeTicket(ticketInput.trim())}
              disabled={!ticketInput.trim().startsWith("ST-")}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition"
            >
              Connect
            </button>
          </div>
          <button
            onClick={() => { setShowTicketForm(false); setTicketInput(""); }}
            className="text-xs text-muted hover:text-primary transition"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Fallback: server-side manual form */}
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
