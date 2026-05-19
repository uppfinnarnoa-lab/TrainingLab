"use client";

import { cn } from "@/lib/utils";

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 100, h = 32, pad = 2;
  const step = (w - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v / max) * (h - pad * 2));
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 opacity-70" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface Props {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  sparkline?: number[];
  accent?: boolean;
}

export function OverviewCard({ label, value, sub, delta, sparkline, accent }: Props) {
  return (
    <div className={cn(
      "rounded-xl bg-surface border p-5 space-y-2 shadow-sm",
      accent ? "border-accent/30" : "border-border"
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wide leading-tight">{label}</p>
        {delta !== undefined && (
          <span className={cn(
            "shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full",
            delta >= 0 ? "bg-accent/10 text-accent" : "bg-error/10 text-error"
          )}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(0)}%
          </span>
        )}
      </div>

      <p className="text-2xl font-semibold font-mono text-primary leading-none">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {sparkline && <Sparkline data={sparkline} />}
    </div>
  );
}
