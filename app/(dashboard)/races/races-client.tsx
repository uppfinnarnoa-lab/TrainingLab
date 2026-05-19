"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Loader2, Edit2, Trash2, ExternalLink, Trophy } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { secToTimeStr } from "@/lib/fitness/paces";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface RaceRecord {
  id: string;
  distance: string;
  distanceM: number;
  time: number;
  date: string;
  eventName: string | null;
  stravaActivityId: string | null;
  notes: string | null;
  isManual: boolean;
}

interface Props { records: RaceRecord[] }

const DISTANCE_ORDER = ["800m","1500m","Mile","3K","5K","10K","15K","Half Marathon","Marathon"];

export function RacesClient({ records: initialRecords }: Props) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Group by distance
  const distances = useMemo(() => {
    const map = new Map<string, RaceRecord[]>();
    for (const r of records) {
      if (!map.has(r.distance)) map.set(r.distance, []);
      map.get(r.distance)!.push(r);
    }
    // Sort distance keys
    return Array.from(map.entries()).sort(([, a], [, b]) => a[0].distanceM - b[0].distanceM);
  }, [records]);

  const selectedDistance = selected ?? distances[0]?.[0];
  const distanceRecords = useMemo(() =>
    records.filter(r => r.distance === selectedDistance).sort((a, b) => a.date.localeCompare(b.date)),
    [records, selectedDistance]
  );
  const pb = distanceRecords.reduce<RaceRecord | null>((best, r) => !best || r.time < best.time ? r : best, null);

  async function importFromStrava() {
    setImporting(true);
    const res = await fetch("/api/races", { method: "PUT" });
    setImporting(false);
    if (res.ok) router.refresh();
  }

  async function deleteRecord(id: string) {
    if (!confirm("Delete this race result?")) return;
    await fetch(`/api/races/${id}`, { method: "DELETE" });
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  const chartData = distanceRecords.map(r => ({
    date: r.date,
    seconds: r.time,
    label: secToTimeStr(r.time),
    isPB: r.id === pb?.id,
  }));

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={importFromStrava}
          disabled={importing}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-surface-2 transition"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Import from Strava
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white dark:text-background hover:opacity-90 transition"
        >
          <Plus size={15} />
          Add manually
        </button>
      </div>

      {records.length === 0 ? (
        <div className="rounded-2xl bg-surface border border-border p-12 text-center">
          <Trophy size={32} className="mx-auto text-muted mb-3" />
          <p className="text-primary font-medium">No race results yet</p>
          <p className="text-sm text-muted mt-1">Import from Strava or add manually above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[200px_1fr] gap-6">
          {/* Distance selector */}
          <div className="space-y-1">
            {distances.map(([dist, rs]) => {
              const best = rs.reduce<RaceRecord | null>((b, r) => !b || r.time < b.time ? r : b, null);
              return (
                <button
                  key={dist}
                  onClick={() => setSelected(dist)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-xl transition",
                    selectedDistance === dist
                      ? "bg-accent/10 border border-accent/30"
                      : "hover:bg-surface-2 border border-transparent"
                  )}
                >
                  <p className={cn("text-sm font-semibold", selectedDistance === dist ? "text-accent" : "text-primary")}>
                    {dist}
                  </p>
                  {best && (
                    <p className="text-xs font-mono text-muted">{secToTimeStr(best.time)}</p>
                  )}
                  <p className="text-xs text-muted">{rs.length} result{rs.length !== 1 ? "s" : ""}</p>
                </button>
              );
            })}
          </div>

          {/* Right panel */}
          <div className="space-y-5">
            {/* PB card */}
            {pb && (
              <div className="rounded-2xl bg-surface border border-accent/30 p-5 flex items-center gap-4">
                <Trophy size={24} className="text-warning shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide">Personal Best · {selectedDistance}</p>
                  <p className="text-3xl font-semibold font-mono text-primary mt-1">{secToTimeStr(pb.time)}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {pb.eventName ?? "Race"} · {format(parseISO(pb.date), "d MMM yyyy")}
                  </p>
                </div>
              </div>
            )}

            {/* Timeline chart */}
            {chartData.length > 1 && (
              <div className="rounded-xl bg-surface border border-border p-4">
                <p className="text-xs font-medium text-muted mb-3">Time trend</p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={d => format(parseISO(d), "MMM yy")} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis
                      reversed
                      tickFormatter={v => secToTimeStr(v)}
                      tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "monospace" }}
                      axisLine={false} tickLine={false} width={56}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                      formatter={(v: number) => [secToTimeStr(v), "Time"]}
                      labelFormatter={d => format(parseISO(d as string), "d MMM yyyy")}
                    />
                    <Line dataKey="seconds" stroke="var(--accent)" strokeWidth={2} dot={{ fill: "var(--accent)", r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* History table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Event</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Time</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">vs PB</th>
                    <th className="px-4 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {distanceRecords.slice().reverse().map(r => {
                    const delta = pb ? r.time - pb.time : 0;
                    return (
                      <tr key={r.id} className="hover:bg-surface-2 transition-colors group">
                        <td className="px-4 py-2.5 text-muted">{format(parseISO(r.date), "d MMM yyyy")}</td>
                        <td className="px-4 py-2.5 text-primary max-w-[200px] truncate">
                          {r.eventName ?? "—"}
                          {r.isManual && <span className="ml-1.5 text-xs text-muted">(manual)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">
                          {secToTimeStr(r.time)}
                          {r.id === pb?.id && <Trophy size={12} className="inline ml-1 text-warning" />}
                        </td>
                        <td className={cn("px-4 py-2.5 text-right font-mono text-sm", delta === 0 ? "text-accent" : "text-muted")}>
                          {delta === 0 ? "PB" : `+${secToTimeStr(delta)}`}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition justify-end">
                            {r.stravaActivityId && (
                              <a href={`https://www.strava.com/activities/${r.stravaActivityId}`} target="_blank" rel="noopener noreferrer"
                                className="p-1 rounded text-muted hover:text-accent transition">
                                <ExternalLink size={13} />
                              </a>
                            )}
                            <button onClick={() => deleteRecord(r.id)} className="p-1 rounded text-muted hover:text-error transition">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add manual record modal */}
      {showAdd && (
        <AddRaceModal
          onClose={() => setShowAdd(false)}
          onSave={r => { setRecords(prev => [...prev, r]); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

function AddRaceModal({ onClose, onSave }: { onClose: () => void; onSave: (r: RaceRecord) => void }) {
  const PRESETS = ["800m","1500m","Mile","3K","5K","10K","15K","Half Marathon","Marathon","Custom"];
  const PRESET_M: Record<string, number> = {
    "800m":800,"1500m":1500,"Mile":1609,"3K":3000,"5K":5000,"10K":10000,"15K":15000,"Half Marathon":21097,"Marathon":42195
  };
  const [dist, setDist] = useState("5K");
  const [customDist, setCustomDist] = useState("");
  const [customM, setCustomM] = useState("");
  const [hh, setHH] = useState("0");
  const [mm, setMM] = useState("");
  const [ss, setSS] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [event, setEvent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const totalSec = parseInt(hh || "0") * 3600 + parseInt(mm || "0") * 60 + parseInt(ss || "0");
    if (!totalSec) return;
    const label = dist === "Custom" ? customDist : dist;
    const meters = dist === "Custom" ? parseFloat(customM) : PRESET_M[dist];
    setSaving(true);
    const res = await fetch("/api/races", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distance: label, distanceM: meters, time: totalSec, date, eventName: event || null, isManual: true }),
    });
    setSaving(false);
    if (res.ok) onSave(await res.json());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl p-6 space-y-4">
        <h3 className="font-semibold text-primary">Add race result</h3>
        <div>
          <label className="text-xs text-muted mb-1 block">Distance</label>
          <select value={dist} onChange={e => setDist(e.target.value)} className={inp}>
            {PRESETS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        {dist === "Custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted mb-1 block">Label</label><input value={customDist} onChange={e => setCustomDist(e.target.value)} placeholder="e.g. 7K" className={inp} /></div>
            <div><label className="text-xs text-muted mb-1 block">Meters</label><input type="number" value={customM} onChange={e => setCustomM(e.target.value)} placeholder="7000" className={inp} /></div>
          </div>
        )}
        <div>
          <label className="text-xs text-muted mb-1 block">Time (h:mm:ss)</label>
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={9} value={hh} onChange={e => setHH(e.target.value)} className={`${inp} w-14 text-center font-mono`} placeholder="0" />
            <span className="text-muted">:</span>
            <input type="number" min={0} max={59} value={mm} onChange={e => setMM(e.target.value)} className={`${inp} w-16 text-center font-mono`} placeholder="25" />
            <span className="text-muted">:</span>
            <input type="number" min={0} max={59} value={ss} onChange={e => setSS(e.target.value)} className={`${inp} w-16 text-center font-mono`} placeholder="30" />
          </div>
        </div>
        <div><label className="text-xs text-muted mb-1 block">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} /></div>
        <div><label className="text-xs text-muted mb-1 block">Event name (optional)</label><input value={event} onChange={e => setEvent(e.target.value)} placeholder="e.g. Stockholm Marathon" className={inp} /></div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-muted hover:text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-xl bg-accent text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/50";
