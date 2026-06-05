"use client";

import { useState } from "react";
import { Loader2, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { SetupGuide, CLAUDE_GUIDE, GEMINI_GUIDE } from "@/components/setup-guide";
import { cn } from "@/lib/utils";
import { NVIDIA_MODELS, NVIDIA_DEFAULT_MODEL } from "@/lib/ai/nvidia";
import { GROQ_MODELS, GROQ_DEFAULT_MODEL } from "@/lib/ai/groq";

interface Props {
  provider: string;
  hasClaudeKey: boolean;
  hasGeminiKey: boolean;
  hasNvidiaKey: boolean;
  hasGroqKey: boolean;
  nvidiaModel: string;
  groqModel: string;
  monthlyBudget: number;
  currentSpend: number;
  geminiMonthlyBudget: number;
  geminiCurrentSpend: number;
}

export function AISettingsSection({
  provider, hasClaudeKey, hasGeminiKey, hasNvidiaKey, hasGroqKey, nvidiaModel, groqModel,
  monthlyBudget, currentSpend, geminiMonthlyBudget, geminiCurrentSpend,
}: Props) {
  const [activeProvider, setActiveProvider] = useState(provider);
  const [claudeKey, setClaudeKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [selectedNvidiaModel, setSelectedNvidiaModel] = useState(nvidiaModel || NVIDIA_DEFAULT_MODEL);
  const [selectedGroqModel, setSelectedGroqModel] = useState(groqModel || GROQ_DEFAULT_MODEL);
  const [budget, setBudget] = useState(String(monthlyBudget));
  const [geminiBudget, setGeminiBudget] = useState(String(geminiMonthlyBudget));
  const [showClaude, setShowClaude] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showNvidia, setShowNvidia] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
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
          nvidiaApiKey: nvidiaKey || undefined,
          nvidiaModel: selectedNvidiaModel,
          groqApiKey: groqKey || undefined,
          groqModel: selectedGroqModel,
          monthlyBudgetUsd: parseFloat(budget) || 5,
          geminiMonthlyBudgetUsd: parseFloat(geminiBudget) || 5,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setClaudeKey("");
      setGeminiKey("");
      setNvidiaKey("");
      setGroqKey("");
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
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted">Active AI provider</p>
          <button
            onClick={() => setShowComparison(v => !v)}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            {showComparison ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Compare providers
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { id: "groq",   label: "Groq",       sub: "Free · Llama" },
            { id: "gemini", label: "Gemini Flash", sub: "Free / Paid" },
            { id: "claude", label: "Claude",       sub: "~$1–5/mo" },
            { id: "nvidia", label: "NVIDIA NIM",   sub: "Free · rate-limited" },
          ].map(({ id, label, sub }) => (
            <button
              key={id}
              onClick={() => setActiveProvider(id)}
              className={cn(
                "flex-1 min-w-[100px] rounded-xl border px-4 py-3 text-left transition",
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

      {/* Collapsible provider comparison */}
      {showComparison && (
        <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3 text-xs">
          <p className="font-semibold text-primary text-sm">Provider comparison</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-medium">Provider</th>
                  <th className="pb-2 pr-4 font-medium">Cost</th>
                  <th className="pb-2 pr-4 font-medium">Speed</th>
                  <th className="pb-2 pr-4 font-medium">Free tier</th>
                  <th className="pb-2 font-medium">Recommended model</th>
                </tr>
              </thead>
              <tbody className="text-primary divide-y divide-border/50">
                <tr>
                  <td className="py-2 pr-4 font-medium">Groq</td>
                  <td className="py-2 pr-4 text-accent font-medium">Free</td>
                  <td className="py-2 pr-4">Fastest (LPU)</td>
                  <td className="py-2 pr-4">30 RPM</td>
                  <td className="py-2">Llama 3.3 70B</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">NVIDIA NIM</td>
                  <td className="py-2 pr-4 text-accent font-medium">Free</td>
                  <td className="py-2 pr-4">Fast</td>
                  <td className="py-2 pr-4">40 RPM</td>
                  <td className="py-2">Llama 3.3 70B</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Gemini Flash</td>
                  <td className="py-2 pr-4">~$0.05–0.20/mo</td>
                  <td className="py-2 pr-4">Fast</td>
                  <td className="py-2 pr-4">25 req/day only</td>
                  <td className="py-2">Gemini 2.5 Flash</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Claude</td>
                  <td className="py-2 pr-4">~$1–5/mo</td>
                  <td className="py-2 pr-4">Medium</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2">Claude Sonnet 4.6</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted leading-relaxed">
            <strong className="text-primary">Groq</strong> is the best free option — fast LPU inference, no credit card required. Sign up at{" "}
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">console.groq.com</a>.{" "}
            <strong className="text-primary">NVIDIA NIM</strong> is also free but slightly slower.{" "}
            <strong className="text-primary">Gemini</strong> free tier is too limited (25 req/day) — use paid if you go this route.{" "}
            <strong className="text-primary">Claude</strong> gives the best response quality but has a real cost.
          </p>
        </div>
      )}

      {/* Gemini */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-primary">
          Gemini API key
          {hasGeminiKey && <span className="ml-2 text-xs font-normal text-accent">✓ Registered</span>}
        </p>
        <SetupGuide steps={GEMINI_GUIDE} />
        <div className="relative">
          <input
            type={showGemini ? "text" : "password"}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={hasGeminiKey ? "Already saved — paste new key to replace" : "AIza..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button type="button" onClick={() => setShowGemini(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            {showGemini ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted">Monthly budget — paid tier (USD, set 0 for unlimited)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">$</span>
            <input type="number" min="0" step="1" value={geminiBudget}
              onChange={e => setGeminiBudget(e.target.value)}
              className="w-20 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-mono text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition" />
          </div>
          {geminiCurrentSpend > 0 && (() => {
            const pct = geminiMonthlyBudget > 0 ? Math.min((geminiCurrentSpend / geminiMonthlyBudget) * 100, 100) : 0;
            return (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted">
                  <span>This month: ${geminiCurrentSpend.toFixed(4)}</span>
                  {geminiMonthlyBudget > 0 && <span className={pct >= 100 ? "text-error" : pct >= 80 ? "text-warning" : ""}>{pct.toFixed(0)}% of ${geminiMonthlyBudget}</span>}
                </div>
                {geminiMonthlyBudget > 0 && (
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-error" : pct >= 80 ? "bg-warning" : "bg-accent")} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Claude */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-primary">
          Claude API key
          {hasClaudeKey && <span className="ml-2 text-xs font-normal text-accent">✓ Registered</span>}
        </p>
        <SetupGuide steps={CLAUDE_GUIDE} />
        <div className="relative">
          <input
            type={showClaude ? "text" : "password"}
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            placeholder={hasClaudeKey ? "Already saved — paste new key to replace" : "sk-ant-..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button type="button" onClick={() => setShowClaude(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            {showClaude ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted">Monthly Claude budget (USD)</label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">$</span>
            <input type="number" min="0" step="0.5" value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-24 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-mono text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition" />
          </div>
          {currentSpend > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted">
                <span>This month: ${currentSpend.toFixed(3)}</span>
                <span>{spendPct.toFixed(0)}% of ${monthlyBudget} budget</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", spendPct >= 100 ? "bg-error" : spendPct >= 80 ? "bg-warning" : "bg-accent")}
                  style={{ width: `${spendPct}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* NVIDIA NIM */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-primary">
          NVIDIA NIM API key
          {hasNvidiaKey && <span className="ml-2 text-xs font-normal text-accent">✓ Registered</span>}
        </p>
        <p className="text-xs text-muted">
          Free, rate-limited (40 req/min). Get your key at{" "}
          <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer"
            className="text-accent underline underline-offset-2">build.nvidia.com</a>
          {" "}→ sign in → any model → Get API Key.
        </p>
        <div className="relative">
          <input
            type={showNvidia ? "text" : "password"}
            value={nvidiaKey}
            onChange={(e) => setNvidiaKey(e.target.value)}
            placeholder={hasNvidiaKey ? "Already saved — paste new key to replace" : "nvapi-..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button type="button" onClick={() => setShowNvidia(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            {showNvidia ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Model</label>
          <select
            value={selectedNvidiaModel}
            onChange={e => setSelectedNvidiaModel(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          >
            {NVIDIA_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Groq */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-primary">
          Groq API key
          {hasGroqKey && <span className="ml-2 text-xs font-normal text-accent">✓ Registered</span>}
        </p>
        <p className="text-xs text-muted">
          Free tier, no credit card required. Get your key at{" "}
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
            className="text-accent underline underline-offset-2">console.groq.com/keys</a>
          {" "}→ create account → API Keys → Create API Key.
        </p>
        <div className="relative">
          <input
            type={showGroq ? "text" : "password"}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={hasGroqKey ? "Already saved — paste new key to replace" : "gsk_..."}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm font-mono text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
          <button type="button" onClick={() => setShowGroq(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            {showGroq ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Model</label>
          <select
            value={selectedGroqModel}
            onChange={e => setSelectedGroqModel(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          >
            {GROQ_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
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
