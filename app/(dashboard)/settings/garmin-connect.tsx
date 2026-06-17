"use client";

import { useState, useEffect, useRef } from "react";
import { Eye, EyeOff, Loader2, RefreshCw, Unplug, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface Props {
  connected:     boolean;
  displayName:   string | null;
  garminAuthUrl: string;   // unused now (kept for compat), iframe handles SSO
  origin:        string;   // e.g. "https://training.helgars.se"
}

// Garmin /sso/embed query params — same as what Garmin Connect's own signin page uses,
// except service points to our ticket-receiver which postMessages the ticket back.
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
    consumeServiceTicket:            "false",
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

  // Iframe SSO state
  const [showIframe,   setShowIframe]   = useState(false);
  const [iframeStatus, setIframeStatus] = useState<"loading" | "ready" | "blocked">("loading");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Manual fallback
  const [showManual, setShowManual] = useState(false);
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [showPass,   setShowPass]   = useState(false);

  const embedUrl = buildEmbedUrl(origin);

  // Listen for postMessage from our ticket-receiver page (loaded inside the Garmin iframe)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Our ticket-receiver page posts to "*" so we accept any origin but check the shape
      const data = event.data as Record<string, unknown>;
      if (typeof data !== "object" || data === null) return;

      if (typeof data.garminTicket === "string") {
        setShowIframe(false);
        exchangeTicket(data.garminTicket);
      } else if (typeof data.garminError === "string") {
        setShowIframe(false);
        setError(`Garmin login failed (${data.garminError}). Try the manual form below.`);
        setShowManual(true);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError("Token exchange failed. Try the manual form below.");
      setShowManual(true);
      return;
    }

    setIsConnected(true);
    setName(typeof data.displayName === "string" ? data.displayName : null);
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
        server_blocked:      "Garmin is blocking the server. Try the iframe login above.",
        auth_failed:         "Authentication failed. Garmin may have changed their login flow.",
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

      {/* Primary: iframe SSO — login happens in your browser, bypasses server bot-detection */}
      {!showIframe && !loading && (
        <button
          onClick={() => { setShowIframe(true); setIframeStatus("loading"); setError(null); }}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition"
        >
          <ExternalLink size={14} />
          Connect with Garmin
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Connecting…
        </div>
      )}

      {showIframe && (
        <div className="rounded-xl border border-border overflow-hidden bg-white">
          {iframeStatus === "loading" && (
            <div className="flex items-center justify-center h-12 gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading Garmin login…
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={embedUrl}
            width="100%"
            height="420"
            title="Garmin Connect login"
            onLoad={() => setIframeStatus("ready")}
            onError={() => setIframeStatus("blocked")}
            className={iframeStatus === "loading" ? "hidden" : "block"}
            style={{ border: "none" }}
          />
          {iframeStatus === "blocked" && (
            <p className="p-3 text-xs text-amber-400">
              Garmin login could not be embedded. Use the manual form below instead.
            </p>
          )}
          <div className="flex justify-end px-3 pb-2">
            <button
              onClick={() => setShowIframe(false)}
              className="text-xs text-muted hover:text-primary transition"
            >
              Cancel
            </button>
          </div>
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
