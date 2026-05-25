"use client";

import { useState, useRef, useCallback } from "react";
import { Info } from "lucide-react";
import type { Tooltip } from "@/lib/fitness/tooltips";
import { cn } from "@/lib/utils";

interface TooltipPos { top: number; left: number }

export function MetricTooltip({ tip, className }: { tip: Tooltip; className?: string }) {
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top + window.scrollY, left: r.right + window.scrollX });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn("text-muted hover:text-accent transition-colors", className)}
        aria-label={`Info about ${tip.title}`}
      >
        <Info size={13} />
      </button>

      {pos && (
        <div
          className="fixed z-[9999] w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-surface border border-border shadow-xl p-4 space-y-2 text-left pointer-events-none"
          style={{ top: pos.top - 8, left: Math.min(pos.left + 8, window.innerWidth - 296) }}
        >
          <p className="text-sm font-semibold text-primary">{tip.title}</p>
          <p className="text-xs text-muted leading-relaxed">{tip.what}</p>
          <p className="text-xs text-primary leading-relaxed">{tip.why}</p>
          {tip.range && (
            <p className="text-xs text-accent font-medium">{tip.range}</p>
          )}
        </div>
      )}
    </>
  );
}
