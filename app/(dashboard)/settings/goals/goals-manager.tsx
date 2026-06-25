"use client";

import { useState } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";

interface Goal {
  id: string;
  sport: string;
  metric: string;
  period: string;
  target: number;
}

interface Props {
  initialGoals: Goal[];
  sports: string[];
}

const PERIODS = ["week", "month", "year"] as const;
const METRICS = ["distance", "time"] as const;

const periodLabel = { week: "Week", month: "Month", year: "Year" };
const metricLabel = { distance: "Distance (km)", time: "Time (hours)" };

export function GoalsManager({ initialGoals, sports }: Props) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [newSport, setNewSport] = useState("");
  const [newMetric, setNewMetric] = useState<"distance" | "time">("distance");
  const [newPeriod, setNewPeriod] = useState<"week" | "month" | "year">("month");
  const [newTarget, setNewTarget] = useState("");

  async function addGoal() {
    const entered = parseFloat(newTarget);
    if (!entered || entered <= 0) return;
    // Time goals are entered in hours but stored in minutes (matches Activity.movingTime-based
    // progress tracking, which is computed in minutes) — convert at the boundary only.
    const target = newMetric === "time" ? entered * 60 : entered;
    setSaving(true);
    const res = await fetch("/api/settings/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: newSport, metric: newMetric, period: newPeriod, target }),
    });
    if (res.ok) {
      const goal = await res.json();
      setGoals(prev => {
        const idx = prev.findIndex(g => g.sport === goal.sport && g.metric === goal.metric && g.period === goal.period);
        return idx >= 0 ? prev.map((g, i) => i === idx ? goal : g) : [...prev, goal];
      });
      setNewTarget("");
    }
    setSaving(false);
  }

  async function deleteGoal(id: string) {
    setDeleting(id);
    await fetch(`/api/settings/goals?id=${id}`, { method: "DELETE" });
    setGoals(prev => prev.filter(g => g.id !== id));
    setDeleting(null);
  }

  const grouped = PERIODS.flatMap(period =>
    METRICS.map(metric => ({
      period,
      metric,
      goals: goals.filter(g => g.period === period && g.metric === metric),
    }))
  ).filter(g => g.goals.length > 0);

  return (
    <div className="space-y-6">
      {/* Existing goals */}
      {grouped.length > 0 && (
        <div className="space-y-4">
          {grouped.map(({ period, metric, goals: gs }) => (
            <div key={`${period}-${metric}`}>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                {periodLabel[period]} — {metricLabel[metric as keyof typeof metricLabel]}
              </p>
              <div className="space-y-2">
                {gs.map(g => (
                  <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-border">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-primary">
                        {g.sport === "" ? "All sports" : g.sport}
                      </p>
                      <p className="text-xs text-muted">
                        {g.metric === "distance" ? `${g.target} km` : `${Math.round(g.target / 60 * 10) / 10} hours`} per {periodLabel[g.period as keyof typeof periodLabel].toLowerCase()}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteGoal(g.id)}
                      disabled={deleting === g.id}
                      className="text-muted hover:text-error transition p-1 rounded"
                    >
                      {deleting === g.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {goals.length === 0 && (
        <p className="text-sm text-muted text-center py-4">No goals set yet. Add your first goal below.</p>
      )}

      {/* Add new goal */}
      <div className="border-t border-border pt-5">
        <p className="text-sm font-semibold text-primary mb-3">Add goal</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="text-xs text-muted block mb-1">Sport</label>
            <select
              value={newSport}
              onChange={e => setNewSport(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">All sports</option>
              {sports.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Metric</label>
            <select
              value={newMetric}
              onChange={e => setNewMetric(e.target.value as "distance" | "time")}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="distance">Distance (km)</option>
              <option value="time">Time (hours)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Period</label>
            <select
              value={newPeriod}
              onChange={e => setNewPeriod(e.target.value as "week" | "month" | "year")}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Target</label>
            <input
              type="number"
              value={newTarget}
              onChange={e => setNewTarget(e.target.value)}
              placeholder={newMetric === "distance" ? "km" : "hours"}
              min={0}
              step={newMetric === "distance" ? 5 : 0.5}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        <button
          onClick={addGoal}
          disabled={saving || !newTarget}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Save goal
        </button>
      </div>
    </div>
  );
}
