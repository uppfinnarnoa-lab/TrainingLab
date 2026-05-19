"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import type { Tooltip } from "@/lib/fitness/tooltips";
import { cn } from "@/lib/utils";

export function MetricTooltip({ tip, className }: { tip: Tooltip; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn("text-muted hover:text-accent transition-colors", className)}
        aria-label={`Info about ${tip.title}`}
      >
        <Info size={13} />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full right-0 mb-2 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-surface border border-border shadow-xl p-4 space-y-2 text-left pointer-events-none">
          <p className="text-sm font-semibold text-primary">{tip.title}</p>
          <p className="text-xs text-muted leading-relaxed">{tip.what}</p>
          <p className="text-xs text-primary leading-relaxed">{tip.why}</p>
          {tip.range && (
            <p className="text-xs text-accent font-medium">{tip.range}</p>
          )}
        </div>
      )}
    </div>
  );
}
