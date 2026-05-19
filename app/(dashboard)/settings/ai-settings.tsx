"use client";

import { useState } from "react";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { SetupGuide, CLAUDE_GUIDE, GEMINI_GUIDE } from "@/components/setup-guide";
import { cn } from "@/lib/utils";

interface Props {
  provider: string;
  hasClaudeKey: boolean;
  hasGeminiKey: boolean;
  monthlyBudget: number;
  currentSpend: number;
}

export function AISettingsSection({ provider, hasClaudeKey, hasGeminiKey, monthlyBudget, currentSpend }: Props) {
  const [activeProvider, setActiveProvider] = useState(provider);
  const [claudeKey, setClaudeKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [budget, setBudget] = useState(String(monthlyBudget));
  const [showClaude, setShowClaude] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const spendPct = monthlyBudget > 0 ? Math.min((currentSpend / monthlyBudget) * 100, 100) : 0;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider,
          claudeApiKey: claudeKey || undefined,
          geminiApiKey: geminiKey || undefined,
          monthlyBudgetUsd: parseFloat(budget) || 5,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setClaudeKey("");
      setGeminiKey("");
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Provider selector */}
      <div>
        <p className="text-xs font-medium text-muted mb-2">Active AI provider</p>
        <div className="flex gap-2">
          {[
            { id: "gemini", label: "Gemini Flash", sub: "Free tier" },
            { id: "claude", label: "Claude", sub: "~$1–5/mo" },
          ].map(({ id, label, sub }) => (
            <button
              key={id}
              onClick={() => setActiveProvider(id)}
              className={cn(
                "flex-1 rounded-xl border px-4 py-3 text-left transition",
                activeProvider === id
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-surface-2"
              )}
            >
              <p className={cn("text-sm font-medium", activeProvider === id ? "text-accent" : "text-primary")}>
                {label}
              </p>
              <p className="text-xs text-muted">{sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Gemini */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary">Gemini API key</p>
          {hasGeminiKey && <span className="text-xs text-accent">Key saved ✓</span>}
        </div>
        <SetupGuide steps={GEMINI_GUIDE} />
        <div className="relative">
          <input
            type={showGemini ? "text" : "password"}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={hasGeminiKey ? "Enter new key to replace existing" : "AIza..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button
            type="button"
            onClick={() => setShowGemini((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
          >
            {showGemini ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {/* Claude */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary">Claude API key</p>
          {hasClaudeKey && <span className="text-xs text-accent">Key saved ✓</span>}
        </div>
        <SetupGuide steps={CLAUDE_GUIDE} />
        <div className="relative">
          <input
            type={showClaude ? "text" : "password"}
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            placeholder={hasClaudeKey ? "Enter new key to replace existing" : "sk-ant-..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button
            type="button"
            onClick={() => setShowClaude((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
          >
            {showClaude ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {/* Budget */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted">Monthly Claude budget (USD)</label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">$</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-24 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-mono text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
            />
          </div>

          {currentSpend > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted">
                <span>This month: ${currentSpend.toFixed(3)}</span>
                <span>{spendPct.toFixed(0)}% of ${monthlyBudget} budget</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    spendPct >= 100 ? "bg-error" : spendPct >= 80 ? "bg-warning" : "bg-accent"
                  )}
                  style={{ width: `${spendPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white dark:text-background hover:opacity-90 disabled:opacity-50 transition"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        {saved ? "Saved ✓" : "Save settings"}
      </button>
    </div>
  );
}
