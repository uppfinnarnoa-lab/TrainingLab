"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Edit2, Trash2, ExternalLink, Trophy, Link2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from "recharts";
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

interface NearActivity {
  stravaId: string;
  name: string;
  date: string;
  distanceKm: number;
  movingTime: number;
}

interface Props {
  records: RaceRecord[];
  perfTrend?: { distance: string; period: string; time: number }[];
}

// Canonical distance order for the sidebar
const DISTANCE_ORDER = ["400m","800m","1K","1500m","Mile","2K","3K","5K","10K","15K","Half Marathon","Marathon"];

export function RacesClient({ records: initialRecords, perfTrend = [] }: Props) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editRecord, setEditRecord] = useState<RaceRecord | null>(null);
  const [smartFilter, setSmartFilter] = useState(true);
  const FILTER_THRESHOLD = 1.35;

  const pbByDistance = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      if (!map.has(r.distance) || r.time < map.get(r.distance)!) map.set(r.distance, r.time);
    }
    return map;
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!smartFilter) return records;
    return records.filter(r => {
      const pb = pbByDistance.get(r.distance);
      return !pb || r.time <= pb * FILTER_THRESHOLD;
    });
  }, [records, smartFilter, pbByDistance]);

  const hiddenCount = records.length - filteredRecords.length;

  const distances = useMemo(() => {
    const map = new Map<string, RaceRecord[]>();
    for (const r of filteredRecords) {
      if (!map.has(r.distance)) map.set(r.distance, []);
      map.get(r.distance)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = DISTANCE_ORDER.indexOf(a), bi = DISTANCE_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [filteredRecords]);

  const selectedDistance = selected ?? distances[0]?.[0];
  const distanceRecords = useMemo(() =>
    filteredRecords.filter(r => r.distance === selectedDistance).sort((a, b) => a.date.localeCompare(b.date)),
    [filteredRecords, selectedDistance]
  );

  const pb = records
    .filter(r => r.distance === selectedDistance)
    .reduce<RaceRecord | null>((best, r) => !best || r.time < best.time ? r : best, null);

  async function deleteRecord(id: string) {
    if (!confirm("Radera detta resultat?")) return;
    await fetch(`/api/races/${id}`, { method: "DELETE" });
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  function onSaved(r: RaceRecord, isEdit: boolean) {
    if (isEdit) {
      setRecords(prev => prev.map(x => x.id === r.id ? r : x));
    } else {
      setRecords(prev => [...prev, r]);
      setSelected(r.distance);
    }
    setShowAdd(false);
    setEditRecord(null);
    router.refresh();
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
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white dark:text-background hover:opacity-90 transition"
        >
          <Plus size={15} />
          Lägg till resultat
        </button>

        {records.length > 0 && (
          <button
            onClick={() => setSmartFilter(v => !v)}
            className={cn(
              "ml-auto inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium border transition",
              smartFilter
                ? "border-accent/30 bg-accent/5 text-accent"
                : "border-border text-muted hover:text-primary"
            )}
            title="Dölj resultat >35% långsammare än PB (filtrerar bort OL, terräng)"
          >
            {smartFilter ? "Vägfilter på" : "Visa alla"}
            {smartFilter && hiddenCount > 0 && (
              <span className="text-muted font-normal">({hiddenCount} dolda)</span>
            )}
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="rounded-2xl bg-surface border border-border p-12 text-center">
          <Trophy size={32} className="mx-auto text-muted mb-3" />
          <p className="text-primary font-medium">Inga tävlingsresultat ännu</p>
          <p className="text-sm text-muted mt-1">Lägg till dina PBs och tävlingsresultat manuellt ovan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[200px_1fr] gap-6">
          {/* Distance sidebar */}
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
                  {best && <p className="text-xs font-mono text-muted">{secToTimeStr(best.time)}</p>}
                  <p className="text-xs text-muted">{rs.length} resultat</p>
                </button>
              );
            })}
          </div>

          {/* Right panel */}
          <div className="space-y-5">
            {pb && (
              <div className="rounded-2xl bg-surface border border-accent/30 p-5 flex items-center gap-4">
                <Trophy size={24} className="text-warning shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide">Personbästa · {selectedDistance}</p>
                  <p className="text-3xl font-semibold font-mono text-primary mt-1">{secToTimeStr(pb.time)}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {pb.eventName ?? "Tävling"} · {format(parseISO(pb.date), "d MMM yyyy")}
                  </p>
                </div>
                <button
                  onClick={() => setEditRecord(pb)}
                  className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
                >
                  <Edit2 size={14} />
                </button>
              </div>
            )}

            {chartData.length > 1 && (() => {
              // Tight domain: pad 15% of range on each side (min 20s)
              const times = chartData.map(d => d.seconds);
              const lo = Math.min(...times), hi = Math.max(...times);
              const pad = Math.max((hi - lo) * 0.25, 20);
              const domain: [number, number] = [Math.max(0, lo - pad), hi + pad];
              return (
                <div className="rounded-xl bg-surface border border-border p-4">
                  <p className="text-xs font-medium text-muted mb-3">Tidsutveckling</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={d => format(parseISO(d), "MMM yy")} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis
                        reversed
                        domain={domain}
                        tickFormatter={v => secToTimeStr(v)}
                        tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "monospace" }}
                        axisLine={false} tickLine={false} width={56}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                        formatter={(v: number) => [secToTimeStr(v), "Tid"]}
                        labelFormatter={d => format(parseISO(d as string), "d MMM yyyy")}
                      />
                      <Line dataKey="seconds" stroke="var(--accent)" strokeWidth={2} dot={false} />
                      {chartData.map((d, i) => d.isPB ? (
                        <ReferenceDot key={i} x={d.date} y={d.seconds} r={5} fill="var(--warning)" stroke="var(--surface)" strokeWidth={2} />
                      ) : null)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {/* History table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Datum</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted">Lopp / Händelse</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">Tid</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted">vs PB</th>
                    <th className="px-4 py-2.5 w-24" />
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
                            <button onClick={() => setEditRecord(r)} className="p-1 rounded text-muted hover:text-primary transition">
                              <Edit2 size={13} />
                            </button>
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

      {/* Performance trend per half-year */}
      {perfTrend.length > 0 && <PerformanceTrendCard data={perfTrend} />}

      {showAdd && (
        <RaceModal onClose={() => setShowAdd(false)} onSave={r => onSaved(r, false)} />
      )}
      {editRecord && (
        <RaceModal record={editRecord} onClose={() => setEditRecord(null)} onSave={r => onSaved(r, true)} />
      )}
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

const PRESETS = [
  { label: "400m",          m: 400 },
  { label: "800m",          m: 800 },
  { label: "1K",            m: 1000 },
  { label: "1500m",         m: 1500 },
  { label: "Mile",          m: 1609 },
  { label: "2K",            m: 2000 },
  { label: "3K",            m: 3000 },
  { label: "5K",            m: 5000 },
  { label: "10K",           m: 10000 },
  { label: "15K",           m: 15000 },
  { label: "Half Marathon", m: 21097 },
  { label: "Marathon",      m: 42195 },
  { label: "Custom",        m: 0 },
];

function RaceModal({ record, onClose, onSave }: {
  record?: RaceRecord;
  onClose: () => void;
  onSave: (r: RaceRecord) => void;
}) {
  const isEdit = !!record;

  const initialPreset = record
    ? (PRESETS.find(p => Math.abs(p.m - record.distanceM) < 10)?.label ?? "Custom")
    : "5K";

  const [dist, setDist] = useState(initialPreset);
  const [customDist, setCustomDist] = useState(record?.distance ?? "");
  const [customM, setCustomM] = useState(record ? String(record.distanceM) : "");
  const initTime = record ? {
    hh: String(Math.floor(record.time / 3600)),
    mm: String(Math.floor((record.time % 3600) / 60)),
    ss: String(record.time % 60),
  } : { hh: "0", mm: "", ss: "" };
  const [hh, setHH] = useState(initTime.hh);
  const [mm, setMM] = useState(initTime.mm);
  const [ss, setSS] = useState(initTime.ss);
  const [date, setDate] = useState(record?.date ?? new Date().toISOString().slice(0, 10));
  const [event, setEvent] = useState(record?.eventName ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [linkedActivity, setLinkedActivity] = useState(record?.stravaActivityId ?? "");
  const [nearActivities, setNearActivities] = useState<NearActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchNearActivities(date); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchNearActivities(d: string) {
    if (!d) return;
    setLoadingActivities(true);
    const res = await fetch(`/api/races/activities-near?date=${d}`);
    if (res.ok) setNearActivities(await res.json());
    setLoadingActivities(false);
  }

  async function save() {
    const totalSec = parseInt(hh || "0") * 3600 + parseInt(mm || "0") * 60 + parseInt(ss || "0");
    if (!totalSec || totalSec < 30) return;
    const preset = PRESETS.find(p => p.label === dist);
    const label = dist === "Custom" ? customDist : dist;
    const meters = dist === "Custom" ? parseFloat(customM) : (preset?.m ?? 0);
    if (!label || !meters) return;

    setSaving(true);
    const url = isEdit ? `/api/races/${record!.id}` : "/api/races";
    const method = isEdit ? "PATCH" : "POST";
    const body = isEdit
      ? { time: totalSec, date, eventName: event || null, notes: notes || null, stravaActivityId: linkedActivity || null }
      : { distance: label, distanceM: meters, time: totalSec, date, eventName: event || null, notes: notes || null, stravaActivityId: linkedActivity || null };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onSave(await res.json());
  }

  const inp = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-primary">{isEdit ? "Redigera resultat" : "Lägg till resultat"}</h3>

        {/* Distance — only shown for new records */}
        {!isEdit && (
          <div>
            <label className="text-xs text-muted mb-1 block">Distans</label>
            <select value={dist} onChange={e => setDist(e.target.value)} className={inp}>
              {PRESETS.map(p => <option key={p.label}>{p.label}</option>)}
            </select>
          </div>
        )}
        {!isEdit && dist === "Custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">Etikett</label>
              <input value={customDist} onChange={e => setCustomDist(e.target.value)} placeholder="t.ex. 7K" className={inp} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Meter</label>
              <input type="number" value={customM} onChange={e => setCustomM(e.target.value)} placeholder="7000" className={inp} />
            </div>
          </div>
        )}

        {/* Time */}
        <div>
          <label className="text-xs text-muted mb-1 block">Tid (h:mm:ss)</label>
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={9} value={hh} onChange={e => setHH(e.target.value)} className={`${inp} w-14 text-center font-mono`} placeholder="0" />
            <span className="text-muted font-semibold">:</span>
            <input type="number" min={0} max={59} value={mm} onChange={e => setMM(e.target.value)} className={`${inp} w-16 text-center font-mono`} placeholder="18" />
            <span className="text-muted font-semibold">:</span>
            <input type="number" min={0} max={59} value={ss} onChange={e => setSS(e.target.value)} className={`${inp} w-16 text-center font-mono`} placeholder="30" />
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs text-muted mb-1 block">Datum</label>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); fetchNearActivities(e.target.value); }}
            className={inp}
          />
        </div>

        {/* Event name */}
        <div>
          <label className="text-xs text-muted mb-1 block">Lopp / Händelse (valfritt)</label>
          <input value={event} onChange={e => setEvent(e.target.value)} placeholder="t.ex. Stockholm Marathon" className={inp} />
        </div>

        {/* Link to Strava activity */}
        <div>
          <label className="text-xs text-muted mb-1 flex items-center gap-1.5">
            <Link2 size={11} />
            Länka till Strava-aktivitet (valfritt)
          </label>
          {loadingActivities ? (
            <div className="flex items-center gap-2 text-xs text-muted py-1">
              <Loader2 size={12} className="animate-spin" /> Hämtar aktiviteter...
            </div>
          ) : nearActivities.length > 0 ? (
            <select value={linkedActivity} onChange={e => setLinkedActivity(e.target.value)} className={inp}>
              <option value="">— ingen länk —</option>
              {nearActivities.map(a => (
                <option key={a.stravaId} value={a.stravaId}>
                  {format(parseISO(a.date), "d MMM")} · {a.name} ({a.distanceKm} km)
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-muted py-1">
              {date ? "Inga löppass hittades ±3 dagar från detta datum." : "Välj ett datum för att se aktiviteter."}
            </p>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-muted mb-1 block">Anteckningar (valfritt)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Väder, form, kurs..." className={`${inp} resize-none`} />
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-muted hover:text-primary transition">Avbryt</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-accent text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50 transition"
          >
            {saving ? "Sparar…" : isEdit ? "Spara ändringar" : "Lägg till"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PerformanceTrendCard({ data }: { data: { distance: string; period: string; time: number }[] }) {
  const distances = [...new Set(data.map(d => d.distance))].filter(d =>
    ["5K","10K","Half Marathon","3K","Mile","1K"].includes(d)
  ).slice(0, 5);
  if (distances.length === 0) return null;
  const periods = [...new Set(data.map(d => d.period))].sort().slice(-8);
  const COLORS = ["#6EE7B7","#818CF8","#F472B6","#FBBF24","#3B82F6"];

  return (
    <div className="rounded-2xl bg-surface border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-primary">Performance progression by half-year</h2>
          <p className="text-[10px] text-muted mt-0.5">Best time per distance per 6-month period</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {distances.map((d, i) => (
            <span key={d} className="flex items-center gap-1 text-[10px] text-muted">
              <span className="w-3 h-1.5 rounded-full inline-block" style={{ backgroundColor: COLORS[i] }} />{d}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 text-muted font-medium pr-4">Period</th>
              {distances.map((d, i) => (
                <th key={d} className="text-right py-1.5 font-medium" style={{ color: COLORS[i] }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {periods.map(period => (
              <tr key={period} className="hover:bg-surface-2 transition-colors">
                <td className="py-1.5 text-muted pr-4">{period}</td>
                {distances.map(dist => {
                  const entry = data.find(x => x.distance === dist && x.period === period);
                  const mm = entry ? Math.floor(entry.time / 60) : null;
                  const ss = entry ? entry.time % 60 : null;
                  return (
                    <td key={dist} className="py-1.5 text-right font-mono text-primary">
                      {mm !== null ? `${mm}:${String(ss).padStart(2,"0")}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
