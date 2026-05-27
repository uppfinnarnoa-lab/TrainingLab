"use client";

import { useState, useEffect, useRef } from "react";
import { RefreshCw, ExternalLink, Loader2, Eye, EyeOff, CheckCircle, Copy, Pause, Play, StopCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SetupGuide, STRAVA_GUIDE } from "@/components/setup-guide";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/strava/backfill-runner";

interface Props {
  connected:    boolean;
  authUrl:      string | null;
  callbackUrl:  string;
  lastSyncAt:   string | null;
  totalSynced:  number;
  hasClientId:  boolean;
  hasClientSecret: boolean;
  isAdmin:      boolean;
  syncMode:              "manual" | "webhook" | "cron";
  webhookSubscriptionId: number | null;
}

interface BackfillJobState {
  status:  JobStatus;
  done:    number;
  total:   number;
  errors:  number;
  message: string | null;
  waitMs?: number;
}

function formatWait(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function StravaConnectSection({
  connected, authUrl, callbackUrl, lastSyncAt, totalSynced, hasClientId, hasClientSecret, isAdmin,
  syncMode: initialSyncMode, webhookSubscriptionId,
}: Props) {
  const [clientId,     setClientId]     = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret,   setShowSecret]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [syncResult,   setSyncResult]   = useState<{ synced?: number; error?: string } | null>(null);
  const [copied,       setCopied]       = useState(false);

  // Historical backfill
  const [backfilling, setBackfilling] = useState(false); // SSE stream active
  const [jobState, setJobState] = useState<BackfillJobState>({
    status: "idle", done: 0, total: 0, errors: 0, message: null,
  });
  const jobStatusRef = useRef<JobStatus>("idle");

  // Auto-sync
  const [syncMode,       setSyncMode]       = useState(initialSyncMode);
  const [webhookActive,  setWebhookActive]  = useState(!!webhookSubscriptionId);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError,   setWebhookError]   = useState<string | null>(null);

  // Weather backfill
  const [weatherFilling,  setWeatherFilling]  = useState(false);
  const [weatherStatus,   setWeatherStatus]   = useState<string | null>(null);
  const [weatherProgress, setWeatherProgress] = useState<{ done: number; total: number } | null>(null);

  const credentialsSet = hasClientId && hasClientSecret;

  // Load backfill status on mount and poll while active
  useEffect(() => {
    if (!connected) return;

    const poll = () => {
      fetch("/api/strava/backfill-history")
        .then(r => r.ok ? r.json() : null)
        .then((data: { status: JobStatus; done: number; total: number; errors: number; waitMs?: number } | null) => {
          if (!data) return;
          jobStatusRef.current = data.status;
          setJobState(s => ({
            ...s,
            status:  data.status,
            done:    data.done,
            total:   data.total,
            errors:  data.errors,
            waitMs:  data.waitMs,
          }));
        })
        .catch(() => {});
    };

    poll();
    // Poll every 3s while not using SSE
    const id = setInterval(() => {
      if (!backfilling) poll();
    }, 3_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, backfilling]);

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
    if (backfilling) return;
    setBackfilling(true);
    setJobState(s => ({ ...s, message: null }));

    let res: Response;
    try {
      res = await fetch("/api/strava/backfill-history", { method: "POST" });
    } catch {
      setJobState(s => ({ ...s, message: "Error — could not connect to server" }));
      setBackfilling(false);
      return;
    }
    if (!res.ok || !res.body) {
      setJobState(s => ({ ...s, message: "Error — check console" }));
      setBackfilling(false);
      return;
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buffer   = "";

    try {
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
            jobStatusRef.current = d.status ?? jobStatusRef.current;

            if (d.type === "status") {
              // Reconnected to already-running job
              setJobState(s => ({ ...s, status: d.status, done: d.done, total: d.total, errors: d.errors, waitMs: d.waitMs }));
            } else if (d.type === "start") {
              setJobState(s => ({ ...s, status: "running", done: 0, total: d.total, errors: 0, message: null }));
            } else if (d.type === "progress") {
              setJobState(s => ({ ...s, status: "running", done: d.done, total: d.total, errors: d.errors, waitMs: undefined }));
            } else if (d.type === "rate_limit") {
              setJobState(s => ({ ...s, status: "rate_limit", done: d.done, total: d.total, errors: d.errors, waitMs: d.waitMs,
                message: `Rate limited — waiting ${formatWait(d.waitMs)}, continuing automatically…` }));
            } else if (d.type === "daily_limit") {
              setJobState(s => ({ ...s, status: "daily_limit", done: d.done, total: d.total, errors: d.errors, waitMs: d.waitMs,
                message: `Daily limit — waiting ${formatWait(d.waitMs)} until midnight UTC, then continuing…` }));
            } else if (d.type === "paused") {
              setJobState(s => ({ ...s, status: "paused", done: d.done, errors: d.errors, message: null }));
            } else if (d.type === "resumed") {
              setJobState(s => ({ ...s, status: "running", message: null, waitMs: undefined }));
            } else if (d.type === "done") {
              setJobState(s => ({ ...s, status: "done", done: d.done, total: d.total, errors: d.errors,
                message: `✓ All ${d.done.toLocaleString()} activities fetched${d.errors > 0 ? ` (${d.errors} errors)` : ""}.` }));
            } else if (d.type === "stopped") {
              setJobState(s => ({ ...s, status: "idle", done: d.done, total: d.total, errors: d.errors,
                message: `Stopped at ${d.done.toLocaleString()}/${d.total.toLocaleString()} — progress saved.` }));
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      setBackfilling(false);
    }
  }

  async function handleControl(action: "pause" | "resume" | "stop") {
    await fetch("/api/strava/backfill-history", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action }),
    }).catch(() => {});
  }

  async function handleSyncMode(mode: "manual" | "webhook" | "cron") {
    setSyncMode(mode);
    await fetch("/api/strava/webhook-subscription", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ syncMode: mode }),
    }).catch(() => {});
  }

  async function handleRegisterWebhook() {
    setWebhookLoading(true);
    setWebhookError(null);
    const origin = new URL(callbackUrl).origin;
    const res = await fetch("/api/strava/webhook-subscription", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ callbackUrl: `${origin}/api/strava/webhook` }),
    }).catch(() => null);
    setWebhookLoading(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setWebhookError(data?.error ?? "Registration failed — check console");
      return;
    }
    setWebhookActive(true);
  }

  async function handleUnregisterWebhook() {
    setWebhookLoading(true);
    setWebhookError(null);
    const res = await fetch("/api/strava/webhook-subscription", { method: "DELETE" }).catch(() => null);
    setWebhookLoading(false);
    if (!res?.ok && res?.status !== 204) {
      setWebhookError("Failed to unregister — check console");
      return;
    }
    setWebhookActive(false);
  }

  async function handleWeatherBackfill() {
    setWeatherFilling(true);
    setWeatherStatus("Connecting...");
    setWeatherProgress(null);
    try {
      let res: Response;
      try {
        res = await fetch("/api/strava/backfill-weather", { method: "POST" });
      } catch {
        setWeatherStatus("Error — could not connect to server");
        return;
      }
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
              setWeatherProgress({ done: d.total, total: d.total });
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
    navigator.clipboard.writeText(new URL(callbackUrl).hostname);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isActive = jobState.status === "running" || jobState.status === "rate_limit" || jobState.status === "daily_limit";

  return (
    <div className="space-y-5">
      {isAdmin && <SetupGuide steps={STRAVA_GUIDE} defaultOpen={!credentialsSet} />}

      {/* Step 1: Callback domain */}
      {isAdmin && <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Step 1 — Paste this into Strava&apos;s &quot;Authorization Callback Domain&quot;
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-primary bg-surface px-3 py-2 rounded-lg border border-border">
            {new URL(callbackUrl).hostname}
          </code>
          <button onClick={copyCallback}
            className="shrink-0 p-2 rounded-lg border border-border hover:bg-surface transition text-muted hover:text-primary" title="Copy">
            {copied ? <CheckCircle size={15} className="text-accent" /> : <Copy size={15} />}
          </button>
        </div>
        <p className="text-xs text-muted">
          Strava only accepts a bare domain — no <code className="bg-surface px-1 rounded">http://</code>, no port, no path.
        </p>
      </div>}

      {/* Step 2: Credentials */}
      {isAdmin && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Step 2 — Paste your Strava API credentials
            {credentialsSet && <span className="ml-2 text-accent normal-case font-medium">✓ Saved</span>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Client ID</label>
              <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder={hasClientId ? "Already saved — paste to update" : "e.g. 12345"} className={inputCls} />
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

      {/* Step 3: Connect / Sync */}
      {(isAdmin ? credentialsSet : hasClientId) && (
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Step 3 — Connect your Strava account
          </p>

          {!connected ? (
            <a href={authUrl ?? "#"}
              className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition",
                authUrl ? "bg-orange-500 hover:bg-orange-600" : "bg-surface-2 text-muted cursor-not-allowed")}>
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
                <button onClick={() => handleSync(false)} disabled={syncing}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50">
                  {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Sync new activities
                </button>
              </div>

              {syncResult && (
                <p className={`text-sm ${syncResult.error ? "text-error" : "text-accent"}`}>
                  {syncResult.error ? `Sync failed: ${syncResult.error}` : `✓ Synced ${syncResult.synced} new activities`}
                </p>
              )}

              {/* ── Historical backfill ── */}
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-medium text-muted">Historical data backfill</p>
                <p className="text-xs text-muted">
                  Fetches full detail (HR, pace, splits, descriptions) for every activity individually.
                  Automatically waits out Strava&apos;s 15-minute and daily rate limits, then continues — runs
                  unattended until everything is fetched. You can pause or stop at any time; progress is always saved.
                </p>

                {/* Status indicator when active or paused */}
                {(isActive || jobState.status === "paused") && (
                  <div className="flex items-center gap-2 text-xs rounded-lg bg-surface px-3 py-2 border border-border">
                    {isActive
                      ? <Loader2 size={12} className="animate-spin text-accent shrink-0" />
                      : <span className="text-warning shrink-0">⏸</span>}
                    <span className="text-primary">
                      {jobState.status === "paused"
                        ? `Paused — ${jobState.done.toLocaleString()} / ${jobState.total.toLocaleString()} done`
                        : jobState.message ?? `Running — ${jobState.done.toLocaleString()} / ${jobState.total.toLocaleString()}`}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  {/* Start / Run again */}
                  {(jobState.status === "idle" || jobState.status === "done") && (
                    <button onClick={handleBackfill} disabled={backfilling}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50">
                      {backfilling ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      {jobState.status === "done" ? "Run again" : "Backfill all historical activities"}
                    </button>
                  )}

                  {/* Pause (while running / waiting) */}
                  {isActive && (
                    <button onClick={() => handleControl("pause")}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition">
                      <Pause size={15} />
                      Pause
                    </button>
                  )}

                  {/* Resume (while paused) */}
                  {jobState.status === "paused" && (
                    <button onClick={() => { handleControl("resume"); handleBackfill(); }}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-accent hover:bg-surface transition">
                      <Play size={15} />
                      Resume
                    </button>
                  )}

                  {/* Stop (while active or paused) */}
                  {(isActive || jobState.status === "paused") && (
                    <button onClick={() => handleControl("stop")}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-error hover:bg-surface transition">
                      <StopCircle size={15} />
                      Stop
                    </button>
                  )}

                  {/* Progress bar */}
                  {jobState.total > 0 && (
                    <div className="flex-1 min-w-[140px]">
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${Math.round(((jobState.status === "done" ? jobState.total : jobState.done) / jobState.total) * 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-muted mt-0.5">
                        {jobState.done.toLocaleString()} / {jobState.total.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Completion / stopped message */}
                {jobState.message && !isActive && jobState.status !== "paused" && (
                  <p className={`text-xs ${
                    jobState.message.startsWith("✓")    ? "text-accent"   :
                    jobState.message.startsWith("Stop") ? "text-muted"    :
                    jobState.message.startsWith("Error") ? "text-error"   : "text-muted"
                  }`}>
                    {jobState.message}
                  </p>
                )}
              </div>

              {/* ── Weather backfill ── */}
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-medium text-muted">Weather data backfill</p>
                <p className="text-xs text-muted">
                  Fetches temperature, wind and precipitation from Open-Meteo for all activities
                  that have GPS coordinates but no weather data. Required for the weather profile
                  chart in Stats.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={handleWeatherBackfill} disabled={weatherFilling}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50">
                    {weatherFilling ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {weatherFilling ? "Running…" : "Backfill weather data"}
                  </button>
                  {weatherProgress && (
                    <div className="flex-1 min-w-[140px]">
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${Math.round((weatherProgress.done / weatherProgress.total) * 100)}%` }} />
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

              {/* ── Auto-sync ── */}
              <div className="pt-3 border-t border-border space-y-3">
                <p className="text-xs font-medium text-muted">Automatic sync</p>
                <p className="text-xs text-muted">
                  Choose how new activities are synced from Strava.
                </p>

                {/* Mode picker */}
                <div className="flex gap-2 flex-wrap">
                  {(["manual", "webhook", "cron"] as const).map(mode => (
                    <button key={mode} onClick={() => handleSyncMode(mode)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition",
                        syncMode === mode
                          ? "bg-accent/10 border-accent text-accent"
                          : "bg-surface-2 border-border text-muted hover:text-primary hover:bg-surface",
                      )}>
                      {mode === "manual" ? "Manual" : mode === "webhook" ? "Webhook — real-time" : "Midnight cron"}
                    </button>
                  ))}
                </div>

                {/* Webhook details */}
                {syncMode === "webhook" && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">
                      Strava will push new activity events to your server within seconds of completion.
                      Register the subscription once — it stays active until you unregister it.
                    </p>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${webhookActive ? "text-accent" : "text-muted"}`}>
                        {webhookActive ? "✓ Webhook active" : "Not registered"}
                      </span>
                      <button onClick={webhookActive ? handleUnregisterWebhook : handleRegisterWebhook}
                        disabled={webhookLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface transition disabled:opacity-50">
                        {webhookLoading && <Loader2 size={12} className="animate-spin" />}
                        {webhookActive ? "Unregister" : "Register with Strava"}
                      </button>
                    </div>
                    {webhookError && <p className="text-xs text-error">{webhookError}</p>}
                    <p className="text-xs text-muted">
                      Webhook URL:{" "}
                      <code className="bg-surface px-1 rounded text-primary text-[10px]">
                        {new URL(callbackUrl).origin}/api/strava/webhook
                      </code>
                    </p>
                  </div>
                )}

                {/* Cron details */}
                {syncMode === "cron" && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">
                      Add to your server&apos;s crontab (<code className="bg-surface px-1 rounded">crontab -e</code>).
                      Set <code className="bg-surface px-1 rounded">CRON_SECRET</code> in <code className="bg-surface px-1 rounded">.env.local</code> first.
                    </p>
                    <code className="block text-[10px] bg-surface border border-border rounded-lg px-3 py-2 text-primary font-mono break-all leading-relaxed">
                      {`0 0 * * * curl -s -X POST ${new URL(callbackUrl).origin}/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"`}
                    </code>
                  </div>
                )}

                {/* Manual = no extra UI */}
                {syncMode === "manual" && (
                  <p className="text-xs text-muted">
                    Use the &quot;Sync new activities&quot; button above to fetch new activities on demand.
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
