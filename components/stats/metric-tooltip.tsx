"use client";

import { useState, useRef, useCallback } from "react";
import { Info } from "lucide-react";
import type { Tooltip } from "@/lib/fitness/tooltips";
import { cn } from "@/lib/utils";

export function MetricTooltip({ tip, className }: { tip: Tooltip; className?: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Only set when opened by click/tap, not hover — see backdrop comment below.
  const [pinned, setPinned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const tipW = Math.min(288, window.innerWidth - 32);
    const tipH = 150; // estimated tooltip height

    // Prefer positioning to the RIGHT of the button, vertically centered.
    // This avoids the tooltip falling over chart content below the title bar.
    let left = r.right + 8;
    let top  = r.top + r.height / 2 - tipH / 2;

    // If not enough room on the right, flip to the left
    if (left + tipW > window.innerWidth - 8) {
      left = Math.max(8, r.left - tipW - 8);
    }

    // Clamp vertically within viewport
    top = Math.max(8, Math.min(top, window.innerHeight - tipH - 8));

    setPos({ top, left });
    setVisible(true);
  }, []);

  const hide = useCallback(() => { setVisible(false); setPinned(false); }, []);
  const toggle = useCallback(() => {
    if (visible) { hide(); } else { show(); setPinned(true); }
  }, [visible, show, hide]);

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={e => { e.stopPropagation(); toggle(); }}
        className={cn("text-muted hover:text-accent transition-colors shrink-0", className)}
        aria-label={`Info: ${tip.title}`}
      >
        <Info size={13} />
      </button>

      {visible && pos && (
        <>
          {/* Click-away backdrop — closes tooltip on mobile tap. Only rendered when opened
              by click/tap (pinned), never for a plain hover: this is a full-viewport
              fixed div, which sits on top of the trigger button itself wherever it is on
              screen. With a stationary mouse, showing it on hover stole the hover target
              from the button (mouseleave -> hide -> button exposed again -> mouseenter ->
              show -> backdrop again -> ...), flickering the tooltip open/closed forever. */}
          {pinned && <div className="fixed inset-0 z-[9998]" onClick={hide} />}
          <div
            className="fixed z-[9999] rounded-xl bg-surface border border-border shadow-xl p-4 space-y-2 text-left"
            style={{ top: pos.top, left: pos.left, width: Math.min(288, window.innerWidth - 32) }}
          >
            <p className="text-sm font-semibold text-primary">{tip.title}</p>
            <p className="text-xs text-muted leading-relaxed">{tip.what}</p>
            <p className="text-xs text-primary leading-relaxed">{tip.why}</p>
            {tip.range && (
              <p className="text-xs text-accent font-medium">{tip.range}</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
