"use client";

import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";

interface Props {
  lastSyncAt: string | null; // ISO string
}

export function SyncButton({ lastSyncAt }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState<number | null>(null);

  async function handleSync() {
    setLoading(true);
    setSynced(null);
    try {
      // Smart resync: fetches last 3 days individually, picks up updated descriptions
      const res = await fetch("/api/strava/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resync: true }),
      });
      if (res.ok) {
        const data = await res.json();
        const total = (data.synced ?? 0) + (data.updated ?? 0);
        setSynced(total);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {lastSyncAt && (
        <p className="text-xs text-muted hidden sm:block">
          Sync {format(parseISO(lastSyncAt), "d MMM HH:mm")}
        </p>
      )}
      {synced !== null && (
        <p className="text-xs text-accent">{synced > 0 ? `+${synced} aktiviteter` : "Uppdaterat"}</p>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        title="Hämtar senaste 3 dagarna och uppdaterar beskrivningar"
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-primary hover:border-accent/40 transition disabled:opacity-50"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        {loading ? "Syncar…" : "Sync Strava"}
      </button>
    </div>
  );
}
