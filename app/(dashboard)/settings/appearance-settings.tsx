"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useColorScheme, COLOR_SCHEMES, type ColorScheme } from "@/components/color-scheme-provider";

const SCHEME_OPTIONS: { value: ColorScheme; label: string; light: string; dark: string }[] = [
  { value: "forest", label: "Forest", light: "#059669", dark: "#6EE7B7" },
  { value: "ocean",  label: "Ocean",  light: "#0284C7", dark: "#38BDF8" },
  { value: "ember",  label: "Ember",  light: "#EA580C", dark: "#FB923C" },
  { value: "mono",   label: "Mono",   light: "#18181B", dark: "#E4E4E7" },
  { value: "slate",  label: "Slate",  light: "#2563EB", dark: "#60A5FA" },
  { value: "sky",    label: "Sand",   light: "#7C3AED", dark: "#A78BFA" },
];

export function AppearanceSettings() {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const { scheme, setScheme } = useColorScheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-24" />;

  const modes = [
    { value: "light",  label: "Light",  icon: Sun },
    { value: "dark",   label: "Dark",   icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  const isDark = resolvedTheme === "dark";

  return (
    <div className="space-y-6">
      {/* Mode picker */}
      <div>
        <p className="text-sm font-medium text-primary mb-1">Mode</p>
        <p className="text-xs text-muted mb-3">Choose between light mode, dark mode, or follow your system setting.</p>
        <div className="flex gap-2">
          {modes.map(({ value, label, icon: Icon }) => {
            const active = theme === value || (value !== "system" && theme === undefined && resolvedTheme === value);
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border px-5 py-3 text-xs font-medium transition-all",
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-muted hover:border-accent/40 hover:text-primary"
                )}
              >
                <Icon size={18} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Color scheme picker */}
      <div>
        <p className="text-sm font-medium text-primary mb-1">Color scheme</p>
        <p className="text-xs text-muted mb-3">Choose a color palette. Each scheme has its own light and dark variant.</p>
        <div className="flex gap-3 flex-wrap">
          {SCHEME_OPTIONS.map(opt => {
            const active = scheme === opt.value;
            const dotColor = isDark ? opt.dark : opt.light;
            return (
              <button
                key={opt.value}
                onClick={() => setScheme(opt.value)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all",
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-muted hover:border-accent/40 hover:text-primary"
                )}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-border"
                  style={{ backgroundColor: dotColor }}
                />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
