"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Profile {
  name?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
  dateOfBirth?: string | null;
  sex?: string | null;
  maxHeartRate?: number | null;
  restingHeartRate?: number | null;
  manualLT1HR?: number | null;
  manualLT2HR?: number | null;
  maxHRArtifactCap?: number | null;
  primaryGoal?: string | null;
  yearsTraining?: number | null;
  paceUnit?: string | null;
  annualGoals?: Record<string, Record<string, number>> | null;
  pbDetectionMode?: string | null;
  pbDetectionTolerancePct?: number | null;
}

export function AthleteProfileForm({ initial, sports }: { initial: Profile; sports: string[] }) {
  const [form, setForm] = useState<Profile>({
    ...initial,
    dateOfBirth: initial.dateOfBirth?.split("T")[0] ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentYear = String(new Date().getFullYear());

  function set(k: keyof Profile, v: string) {
    setForm(f => ({ ...f, [k]: v === "" ? null : v }));
  }

  function setGoal(sport: string, value: string) {
    const km = value === "" ? undefined : parseFloat(value);
    setForm(f => {
      const existing = f.annualGoals ?? {};
      const yearGoals = { ...(existing[currentYear] ?? {}) };
      if (km === undefined || isNaN(km)) {
        delete yearGoals[sport];
      } else {
        yearGoals[sport] = km;
      }
      return { ...f, annualGoals: { ...existing, [currentYear]: yearGoals } };
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Display name" hint="Shown in the app and to your AI coach">
        <input type="text" value={form.name ?? ""} onChange={e => set("name", e.target.value)}
          placeholder="Your name" className={inputCls} />
      </Field>

      <Field label="Date of birth" hint="Used for age-graded race predictions">
        <input type="date" value={form.dateOfBirth?.split("T")[0] ?? ""}
          onChange={e => set("dateOfBirth", e.target.value)} className={inputCls} />
      </Field>

      <Field label="Sex" hint="Affects VO2max norms and HR zone thresholds">
        <select value={form.sex ?? ""} onChange={e => set("sex", e.target.value)} className={inputCls}>
          <option value="">Prefer not to say</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </Field>

      <Field label="Weight (kg)" hint="Used in running power and w/kg calculations">
        <input type="number" min={30} max={200} step={0.5}
          value={form.weightKg ?? ""} onChange={e => set("weightKg", e.target.value)}
          placeholder="70" className={inputCls} />
      </Field>

      <Field label="Height (cm)" hint="Supplementary context for the AI coach">
        <input type="number" min={100} max={250} step={1}
          value={form.heightCm ?? ""} onChange={e => set("heightCm", e.target.value)}
          placeholder="175" className={inputCls} />
      </Field>

      <Field label="Max heart rate (bpm)" hint="Leave blank to estimate from your activity data">
        <input type="number" min={100} max={230} step={1}
          value={form.maxHeartRate ?? ""} onChange={e => set("maxHeartRate", e.target.value)}
          placeholder="auto-estimated" className={inputCls} />
      </Field>

      <Field label="Resting heart rate (bpm)" hint="Morning resting HR — auto-filled from Garmin if connected">
        <input type="number" min={30} max={100} step={1}
          value={form.restingHeartRate ?? ""} onChange={e => set("restingHeartRate", e.target.value)}
          placeholder="auto from Garmin" className={inputCls} />
      </Field>

      <Field label="LT1 — aerobic threshold (bpm)" hint="Leave blank to estimate from training data. Overrides estimation only.">
        <input type="number" min={80} max={220} step={1}
          value={form.manualLT1HR ?? ""} onChange={e => set("manualLT1HR", e.target.value)}
          placeholder="auto-estimated" className={inputCls} />
      </Field>

      <Field label="LT2 — lactate threshold (bpm)" hint="Leave blank to estimate from race PBs and training data. Overrides estimation only.">
        <input type="number" min={80} max={220} step={1}
          value={form.manualLT2HR ?? ""} onChange={e => set("manualLT2HR", e.target.value)}
          placeholder="auto-estimated" className={inputCls} />
      </Field>

      <Field label="Max HR artifact cap (bpm)" hint="HR readings above this are treated as sensor spikes and ignored. Auto-calculated from your own training data by default — set this only to override that estimate.">
        <input type="number" min={170} max={220} step={1}
          value={form.maxHRArtifactCap ?? ""} onChange={e => set("maxHRArtifactCap", e.target.value)}
          placeholder="auto" className={inputCls} />
      </Field>

      <Field label="Years of structured training" hint="Helps the coach calibrate advice to your experience">
        <input type="number" min={0} max={50} step={1}
          value={form.yearsTraining ?? ""} onChange={e => set("yearsTraining", e.target.value)}
          placeholder="e.g. 5" className={inputCls} />
      </Field>

      <Field label="Primary goal" hint="Shapes coach personality and training plan priorities" className="sm:col-span-2">
        <input type="text"
          value={form.primaryGoal ?? ""} onChange={e => set("primaryGoal", e.target.value)}
          placeholder="e.g. orienteering performance, sub-3h marathon, general fitness"
          className={inputCls} />
      </Field>

      {/* Pace unit */}
      <Field label="Pace unit" hint="How pace is displayed throughout the app" className="sm:col-span-2">
        <div className="flex gap-3 flex-wrap">
          {[
            { value: "min_per_km", label: "min/km" },
            { value: "min_per_mi", label: "min/mi" },
            { value: "km_h", label: "km/h" },
          ].map(opt => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="paceUnit"
                value={opt.value}
                checked={(form.paceUnit ?? "min_per_km") === opt.value}
                onChange={() => setForm(f => ({ ...f, paceUnit: opt.value }))}
                className="accent-accent"
              />
              <span className="text-sm text-primary">{opt.label}</span>
            </label>
          ))}
        </div>
      </Field>

      {/* PB detection */}
      <Field label="Personal best detection" hint="Automatic adds new race results to your PB tracker straight from synced Strava activities — same as adding them by hand, just automatic" className="sm:col-span-2">
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
                checked={(form.pbDetectionMode ?? "manual") === opt.value}
                onChange={() => setForm(f => ({ ...f, pbDetectionMode: opt.value }))}
                className="accent-accent"
              />
              <span className="text-sm text-primary">{opt.label}</span>
            </label>
          ))}
        </div>
        {form.pbDetectionMode === "automatic" && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">Also track results within</span>
            <input
              type="number" min={0} max={50} step={1}
              aria-label="PB tracking tolerance percentage"
              value={form.pbDetectionTolerancePct ?? 5}
              onChange={e => setForm(f => ({ ...f, pbDetectionTolerancePct: e.target.value === "" ? 5 : parseFloat(e.target.value) }))}
              className={`${inputCls} w-20 text-center`}
            />
            <span className="text-sm text-primary">% of your PB (0 = strict PBs only)</span>
          </div>
        )}
      </Field>

      {/* Annual goals */}
      {sports.length > 0 && (
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-primary mb-1">Annual distance goals {currentYear}</label>
          <p className="text-xs text-muted mb-3">Target km per sport for {currentYear}. Leave blank to skip a sport.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sports.map(sport => (
              <div key={sport} className="flex items-center gap-3">
                <span className="text-sm text-primary min-w-[90px] truncate">{sport}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={form.annualGoals?.[currentYear]?.[sport] ?? ""}
                  onChange={e => setGoal(sport, e.target.value)}
                  placeholder="km"
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sm:col-span-2 flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50 transition">
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saved ? "Saved ✓" : "Save profile"}
        </button>
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
        {!saveError && <p className="text-xs text-muted">Used by your AI coach in every conversation.</p>}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition";

function Field({ label, hint, children, className }: {
  label: string; hint: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-primary mb-1">{label}</label>
      <p className="text-xs text-muted mb-1.5">{hint}</p>
      {children}
    </div>
  );
}
