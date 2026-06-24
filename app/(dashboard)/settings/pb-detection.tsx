"use client";

import { useState } from "react";
import { Loader2, ScanSearch, Trash2 } from "lucide-react";

interface Props {
  initial: {
    pbDetectionMode?: string | null;
    pbDetectionTolerancePct?: number | null;
  };
}

export function PBDetectionSettings({ initial }: Props) {
  const [mode, setMode] = useState(initial.pbDetectionMode ?? "manual");
  const [tolerancePct, setTolerancePct] = useState(initial.pbDetectionTolerancePct ?? 5);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ created: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbDetectionMode: mode, pbDetectionTolerancePct: tolerancePct }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? "Could not save — check the values.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setSaveError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleScanHistory() {
    setScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await fetch("/api/races/scan-history", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setScanError(body.error ?? "Scan failed — please try again.");
      } else {
        const data: { created: number } = await res.json();
        setScanResult({ created: data.created });
      }
    } catch {
      setScanError("Network error — please try again.");
    } finally {
      setScanning(false);
    }
  }

  async function handleDeleteAutomatic() {
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    setConfirmingDelete(false);
    setDeleting(true);
    setDeleteResult(null);
    setDeleteError(null);
    try {
      const res = await fetch("/api/races/auto-detected", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error ?? "Could not delete — please try again.");
      } else {
        const data: { deleted: number } = await res.json();
        setDeleteResult({ deleted: data.deleted });
      }
    } catch {
      setDeleteError("Network error — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-primary mb-1">Detection mode</label>
        <p className="text-xs text-muted mb-1.5">Automatic adds new race results to your PB tracker straight from synced Strava activities — same as adding them by hand, just automatic</p>
        <div className="flex gap-3 flex-wrap mb-3">
          {[
            { value: "manual", label: "Manual" },
            { value: "automatic", label: "Automatic" },
          ].map(opt => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pbDetectionMode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => setMode(opt.value)}
                className="accent-accent"
              />
              <span className="text-sm text-primary">{opt.label}</span>
            </label>
          ))}
        </div>
        {mode === "automatic" && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">Also track training results within</span>
            <input
              type="number" min={0} max={50} step={1}
              aria-label="PB tracking tolerance percentage"
              value={tolerancePct}
              onChange={e => setTolerancePct(e.target.value === "" ? 5 : parseFloat(e.target.value))}
              className={`${inputCls} w-20 text-center`}
            />
            <span className="text-sm text-primary">% of your PB, from the last 12 months</span>
          </div>
        )}
        <p className="text-xs text-muted mt-2">
          Training results only count once a distance has a manually-entered PB to verify against — until then, only flagged races count. All-time PBs are always tracked regardless of age or source. 0% = strict PBs only.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border">
        <button onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50 transition">
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saved ? "Saved ✓" : "Save"}
        </button>
        {saveError && <p className="text-xs text-error">{saveError}</p>}
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border">
        <button
          onClick={handleScanHistory}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted hover:text-primary hover:border-accent/40 disabled:opacity-50 transition"
          title="Scan all past activities for PBs and near-PB results based on your tolerance setting"
        >
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
          Scan history for PBs
        </button>
        {scanResult !== null && <span className="text-xs text-accent font-semibold">{scanResult.created} added</span>}
        {scanError && <p className="text-xs text-error">{scanError}</p>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {confirmingDelete ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-error">Permanently delete all automatically-detected results? Manual entries are unaffected.</span>
            <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 rounded text-muted hover:bg-surface-2 transition">No</button>
            <button onClick={handleDeleteAutomatic} disabled={deleting}
              className="px-2 py-1 rounded font-semibold text-error bg-error/10 hover:bg-error/20 disabled:opacity-50 transition">
              {deleting && <Loader2 size={12} className="animate-spin inline mr-1" />}
              Yes, delete
            </button>
          </div>
        ) : (
          <button
            onClick={handleDeleteAutomatic}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted hover:text-error hover:border-error/40 disabled:opacity-50 transition"
            title="Remove all automatically-detected PB/near-PB results, keeping manual entries"
          >
            <Trash2 size={13} />
            Remove all automatic PBs
          </button>
        )}
        {deleteResult !== null && <span className="text-xs text-accent font-semibold">{deleteResult.deleted} removed</span>}
        {deleteError && <p className="text-xs text-error">{deleteError}</p>}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";
