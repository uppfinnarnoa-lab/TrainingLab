"use client";

import { useState } from "react";
import { RefreshCw, ExternalLink, Loader2, Eye, EyeOff, CheckCircle, Copy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SetupGuide, STRAVA_GUIDE } from "@/components/setup-guide";
import { cn } from "@/lib/utils";

interface Props {
  connected:    boolean;
  authUrl:      string | null;
  callbackUrl:  string;
  lastSyncAt:   string | null;
  totalSynced:  number;
  hasClientId:  boolean;
  hasClientSecret: boolean;
  isAdmin:      boolean;
}

export function StravaConnectSection({
  connected, authUrl, callbackUrl, lastSyncAt, totalSynced, hasClientId, hasClientSecret, isAdmin,
}: Props) {
  const [clientId,     setClientId]     = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret,   setShowSecret]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [syncing,         setSyncing]         = useState(false);
  const [syncResult,      setSyncResult]      = useState<{ synced?: number; error?: string } | null>(null);
  const [copied,          setCopied]          = useState(false);
  const [backfilling,     setBackfilling]     = useState(false);
  const [backfillStatus,  setBackfillStatus]  = useState<string | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);
  const [weatherFilling,     setWeatherFilling]     = useState(false);
  const [weatherStatus,      setWeatherStatus]      = useState<string | null>(null);
  const [weatherProgress,    setWeatherProgress]    = useState<{ done: number; total: number } | null>(null);

  const credentialsSet = hasClientId && hasClientSecret;

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    await fetch("/api/settings/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stravaClientId:     clientId.trim(),
        stravaClientSecret: clientSecret.trim(),
      }),
    });
    setSaving(false);
    setSaved(true);
    setClientId(""); setClientSecret("");
    // Reload to refresh authUrl
    window.location.reload();
  }

  async function handleSync(full = false) {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/strava/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      setSyncResult(data.error ? { error: data.error } : { synced: data.synced });
    } catch {
      setSyncResult({ error: "Network error" });
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillStatus("Connecting...");
    setBackfillProgress(null);
    try {
      const res = await fetch("/api/strava/backfill-history", { method: "POST" });
      if (!res.ok || !res.body) { setBackfillStatus("Error — check console"); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "start") {
              setBackfillStatus(`Fetching ${d.total} activities...`);
              setBackfillProgress({ done: 0, total: d.total });
            }
            if (d.type === "progress") {
              setBackfillStatus(`${d.done}/${d.total}${d.errors > 0 ? ` (${d.errors} errors)` : ""}...`);
              setBackfillProgress({ done: d.done, total: d.total });
            }
            if (d.type === "rate_limit") {
              setBackfillStatus(`${d.done}/${d.total} — rate limit, waiting ${Math.round(d.waitMs / 1000)}s...`);
            }
            if (d.type === "daily_limit") {
              setBackfillStatus(`${d.done}/${d.total} done — Strava daily limit reached. Run again tomorrow to continue.`);
              setBackfillProgress({ done: d.done, total: d.total });
            }
            if (d.type === "done") {
              setBackfillStatus(`✓ All ${d.done} activities fetched${d.errors > 0 ? ` (${d.errors} errors)` : ""}.`);
              setBackfillProgress({ done: d.done, total: d.total });
            }
            if (d.type === "error") setBackfillStatus(`Error: ${d.message}`);
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      setBackfilling(false);
    }
  }

  async function handleWeatherBackfill() {
    setWeatherFilling(true);
    setWeatherStatus("Connecting...");
    setWeatherProgress(null);
    try {
      const res = await fetch("/api/strava/backfill-weather", { method: "POST" });
      if (!res.ok || !res.body) { setWeatherStatus("Error — check console"); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "start") {
              setWeatherStatus(`Fetching weather for ${d.total} activities...`);
              setWeatherProgress({ done: 0, total: d.total });
            }
            if (d.type === "progress") {
              setWeatherStatus(`${d.done}/${d.total}${d.errors > 0 ? ` (${d.errors} errors)` : ""}...`);
              setWeatherProgress({ done: d.done, total: d.total });
            }
            if (d.type === "done") {
              setWeatherStatus(`✓ Done — ${d.done} activities updated${d.errors > 0 ? `, ${d.errors} skipped` : ""}.`);
              setWeatherProgress({ done: d.done, total: d.total });
            }
            if (d.type === "error") setWeatherStatus(`Error: ${d.message}`);
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      setWeatherFilling(false);
    }
  }

  function copyCallback() {
    // Copy only the hostname — Strava rejects full URLs with paths/ports
    navigator.clipboard.writeText(new URL(callbackUrl).hostname);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Admin-only: setup guide + callback URL + credential form */}
      {isAdmin && <SetupGuide steps={STRAVA_GUIDE} defaultOpen={!credentialsSet} />}

      {/* ── Step 1: Callback domain — admin only ── */}
      {isAdmin && <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Step 1 — Paste this into Strava's "Authorization Callback Domain"
        </p>
        <div className="flex items-center gap-2">
          {/* Show ONLY the hostname — Strava rejects full URLs with paths */}
          <code className="flex-1 text-sm font-mono text-primary bg-surface px-3 py-2 rounded-lg border border-border">
            {new URL(callbackUrl).hostname}
          </code>
          <button
            onClick={copyCallback}
            className="shrink-0 p-2 rounded-lg border border-border hover:bg-surface transition text-muted hover:text-primary"
            title="Copy"
          >
            {copied ? <CheckCircle size={15} className="text-accent" /> : <Copy size={15} />}
          </button>
        </div>
        <p className="text-xs text-muted">
          Strava only accepts a bare domain — no <code className="bg-surface px-1 rounded">http://</code>, no port, no path.
        </p>
      </div>}

      {/* ── Step 2: Enter credentials — admin only ── */}
      {isAdmin && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Step 2 — Paste your Strava API credentials
            {credentialsSet && <span className="ml-2 text-accent normal-case font-medium">✓ Saved</span>}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder={hasClientId ? "Already saved — paste to update" : "e.g. 12345"}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Client Secret</label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder={hasClientSecret ? "Already saved — paste to update" : "Paste client secret"}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={saveCredentials}
            disabled={saving || (!clientId.trim() && !clientSecret.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-surface border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 disabled:opacity-40 transition"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saved ? "Saved ✓" : "Save credentials"}
          </button>
        </div>
      )}

      {/* ── Connect / Sync ── */}
      {(isAdmin ? credentialsSet : hasClientId) && (
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Step 3 — Connect your Strava account
          </p>

          {!connected ? (
            <a
              href={authUrl ?? "#"}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition",
                authUrl ? "bg-orange-500 hover:bg-orange-600" : "bg-surface-2 text-muted cursor-not-allowed"
              )}
            >
              <ExternalLink size={15} />
              Connect with Strava
            </a>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="text-muted text-xs">Activities synced</p>
                  <p className="font-semibold font-mono text-primary">{totalSynced.toLocaleString()}</p>
                </div>
                {lastSyncAt && (
                  <div>
                    <p className="text-muted text-xs">Last sync</p>
                    <p className="font-medium text-primary">
                      {formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => handleSync(false)}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50"
                >
                  {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Sync new activities
                </button>
              </div>

              {syncResult && (
                <p className={`text-sm ${syncResult.error ? "text-error" : "text-accent"}`}>
                  {syncResult.error
                    ? `Sync failed: ${syncResult.error}`
                    : `✓ Synced ${syncResult.synced} new activities`}
                </p>
              )}

              {/* Historical backfill */}
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-medium text-muted">Historical data backfill</p>
                <p className="text-xs text-muted">
                  Fetches full detail (HR, pace, splits, descriptions) for every activity individually.
                  Respects Strava&apos;s rate limits — pauses between windows and stops if the daily limit
                  is reached. Run again the next day to continue where it left off.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleBackfill}
                    disabled={backfilling}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50"
                  >
                    {backfilling ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {backfilling ? "Running…" : "Backfill all historical activities"}
                  </button>
                  {backfillProgress && (
                    <div className="flex-1 min-w-[140px]">
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${Math.round((backfillProgress.done / backfillProgress.total) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted mt-0.5">{backfillProgress.done} / {backfillProgress.total}</p>
                    </div>
                  )}
                </div>
                {backfillStatus && (
                  <p className={`text-xs ${backfillStatus.startsWith("✓") ? "text-accent" : backfillStatus.includes("daily limit") ? "text-warning" : backfillStatus.startsWith("Error") ? "text-error" : "text-muted"}`}>
                    {backfillStatus}
                  </p>
                )}
              </div>

              {/* Weather backfill */}
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-medium text-muted">Weather data backfill</p>
                <p className="text-xs text-muted">
                  Fetches temperature, wind and precipitation from Open-Meteo for all activities
                  that have GPS coordinates but no weather data. Required for the weather profile
                  chart in Stats.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleWeatherBackfill}
                    disabled={weatherFilling}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50"
                  >
                    {weatherFilling ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {weatherFilling ? "Running…" : "Backfill weather data"}
                  </button>
                  {weatherProgress && (
                    <div className="flex-1 min-w-[140px]">
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${Math.round((weatherProgress.done / weatherProgress.total) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted mt-0.5">{weatherProgress.done} / {weatherProgress.total}</p>
                    </div>
                  )}
                </div>
                {weatherStatus && (
                  <p className={`text-xs ${weatherStatus.startsWith("✓") ? "text-accent" : weatherStatus.startsWith("Error") ? "text-error" : "text-muted"}`}>
                    {weatherStatus}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
