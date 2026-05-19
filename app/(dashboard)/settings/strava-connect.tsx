"use client";

import { useState } from "react";
import { RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  connected: boolean;
  authUrl: string;
  lastSyncAt: string | null;
  totalSynced: number;
}

export function StravaConnectSection({ connected, authUrl, lastSyncAt, totalSynced }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced?: number; error?: string } | null>(null);

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

  if (!connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Connect your Strava account to sync your training history. All activities including your
          written descriptions will be imported.
        </p>
        <a
          href={authUrl}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition"
        >
          <ExternalLink size={15} />
          Connect with Strava
        </a>
      </div>
    );
  }

  return (
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

      <div className="flex items-center gap-3">
        <button
          onClick={() => handleSync(false)}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface transition disabled:opacity-50"
        >
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Sync new activities
        </button>

        <button
          onClick={() => handleSync(true)}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition disabled:opacity-50"
        >
          Full re-sync
        </button>
      </div>

      {syncResult && (
        <p className={`text-sm ${syncResult.error ? "text-error" : "text-accent"}`}>
          {syncResult.error
            ? `Sync failed: ${syncResult.error}`
            : `✓ Synced ${syncResult.synced} new activities`}
        </p>
      )}
    </div>
  );
}
