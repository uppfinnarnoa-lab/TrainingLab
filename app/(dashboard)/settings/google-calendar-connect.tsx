"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Eye, EyeOff, CheckCircle, Copy, RefreshCw, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SetupGuide, GOOGLE_CALENDAR_GUIDE } from "@/components/setup-guide";
import { cn } from "@/lib/utils";

interface Props {
  connected:       boolean;
  needsReconnect:  boolean;
  scopeOutdated:   boolean;
  authUrl:         string | null;
  callbackUrl:     string;
  lastSyncAt:      string | null;
  hasClientId:     boolean;
  hasClientSecret: boolean;
  isAdmin:         boolean;
}

export function GoogleCalendarConnectSection({
  connected, needsReconnect, scopeOutdated, authUrl, callbackUrl, lastSyncAt, hasClientId, hasClientSecret, isAdmin,
}: Props) {
  const [clientId,     setClientId]     = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret,   setShowSecret]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [pushing,      setPushing]      = useState(false);
  const [pushResult,   setPushResult]   = useState<{ pushed: number; errors: number } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const credentialsSet = hasClientId && hasClientSecret;

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    await fetch("/api/settings/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        googleClientId:     clientId.trim(),
        googleClientSecret: clientSecret.trim(),
      }),
    });
    setSaving(false);
    setSaved(true);
    setClientId(""); setClientSecret("");
    window.location.reload();
  }

  async function handlePushUpcoming() {
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/google-calendar/sync", { method: "POST" });
      setPushResult(await res.json());
    } catch {
      setPushResult({ pushed: 0, errors: 1 });
    } finally {
      setPushing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/google-calendar/disconnect", { method: "POST" });
    window.location.reload();
  }

  function copyCallback() {
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      {isAdmin && <SetupGuide steps={GOOGLE_CALENDAR_GUIDE} defaultOpen={!credentialsSet} />}

      {/* Step: redirect URI */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Authorized redirect URI — paste into Google Cloud Console
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono text-primary bg-surface px-3 py-2 rounded-lg border border-border break-all">
              {callbackUrl}
            </code>
            <button onClick={copyCallback}
              className="shrink-0 p-2 rounded-lg border border-border hover:bg-surface transition text-muted hover:text-primary" title="Copy">
              {copied ? <CheckCircle size={15} className="text-accent" /> : <Copy size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* Step: credentials */}
      {isAdmin && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Google OAuth credentials
            {credentialsSet && <span className="ml-2 text-accent normal-case font-medium">✓ Saved</span>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Client ID</label>
              <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder={hasClientId ? "Already saved — paste to update" : "e.g. 1234.apps.googleusercontent.com"} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Client Secret</label>
              <div className="relative">
                <input type={showSecret ? "text" : "password"} value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder={hasClientSecret ? "Already saved — paste to update" : "Paste client secret"}
                  className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={saveCredentials} disabled={saving || (!clientId.trim() && !clientSecret.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 disabled:opacity-40 transition">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saved ? "Saved ✓" : "Save credentials"}
          </button>
        </div>
      )}

      {/* Connect / connected state */}
      {((isAdmin ? credentialsSet : hasClientId) || connected) && (
        <div className="space-y-4">
          {needsReconnect && (
            <div className="flex items-center gap-2 text-sm rounded-lg bg-error/10 text-error px-3 py-2">
              <AlertTriangle size={14} className="shrink-0" />
              Connection broken — Google access was revoked or expired. Reconnect below.
            </div>
          )}

          {!needsReconnect && scopeOutdated && (
            <div className="flex items-center gap-2 text-sm rounded-lg bg-accent/10 text-accent px-3 py-2">
              <AlertTriangle size={14} className="shrink-0" />
              New feature available — reconnect to move events to a dedicated TrainingLab calendar with workout colors.
            </div>
          )}

          {!connected || needsReconnect || scopeOutdated ? (
            <a href={authUrl ?? "#"}
              className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition",
                authUrl ? "bg-blue-500 hover:bg-blue-600" : "bg-surface-2 text-muted cursor-not-allowed")}>
              <ExternalLink size={15} />
              {needsReconnect ? "Reconnect Google Calendar" : scopeOutdated ? "Reconnect for dedicated calendar" : "Connect with Google"}
            </a>
          ) : (
            <div className="space-y-3">
              {lastSyncAt && (
                <p className="text-xs text-muted">
                  Last synced {formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handlePushUpcoming} disabled={pushing}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50">
                  {pushing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Push upcoming workouts to calendar
                </button>
                <button onClick={handleDisconnect} disabled={disconnecting}
                  className="text-xs text-muted hover:text-error transition disabled:opacity-50">
                  Disconnect
                </button>
              </div>
              {pushResult && (
                <p className="text-sm text-accent">
                  ✓ Pushed {pushResult.pushed} workout{pushResult.pushed === 1 ? "" : "s"}
                  {pushResult.errors > 0 ? ` (${pushResult.errors} failed)` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
