"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  BarChart3,
  Calendar,
  MessageSquare,
  Trophy,
  Settings,
  History,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Logo, LogoText, logoPullIn } from "./logo";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";
const ICON_SIZE = 18;
const LOGO_SIZE = 30;

const nav = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { href: "/activities", icon: Activity,        label: "Activities" },
  { href: "/history",    icon: History,         label: "Activity History" },
  { href: "/stats",      icon: BarChart3,       label: "Statistics" },
  { href: "/planner",    icon: Calendar,        label: "Planner" },
  { href: "/coach",      icon: MessageSquare,   label: "Coach" },
  { href: "/races",      icon: Trophy,          label: "Races & PBs" },
];

// Shared with every row's label span so text reveals/hides by clipping width
// in place, instead of swapping layouts — icons never resize or shift.
const labelClass = (rail: boolean) =>
  cn(
    "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200",
    rail ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100"
  );

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  const close = () => setMobileOpen(false);
  const rail = collapsed && !mobileOpen;

  const mobileMenuButton = (
    <button
      onClick={() => setMobileOpen(true)}
      className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-xl bg-surface border border-border text-muted hover:text-primary shadow-sm transition"
      aria-label="Open menu"
    >
      <Menu size={20} />
    </button>
  );

  const sidebarContent = (
    <>
      {/* Logo — icon stays fixed size/position, wordmark text clips away.
          Left inset matches the nav icons' left edge (nav's own px-3 + each
          Link's px-3 = 24px), not a literal center — a centered logo would
          float inconsistently above the left-aligned nav column below it. */}
      <div className={cn("flex h-16 items-end pb-3 border-b border-border shrink-0", rail ? "px-3 justify-center" : "pl-6 pr-3")}>
        <Logo size={LOGO_SIZE} className="shrink-0" style={rail ? undefined : { marginRight: logoPullIn(LOGO_SIZE) }} />
        <span className={labelClass(rail)}>
          <LogoText size={LOGO_SIZE} />
        </span>
        {mobileOpen && (
          <button onClick={close} aria-label="Close menu" className="md:hidden ml-auto p-1.5 rounded-lg text-muted hover:text-primary transition shrink-0">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-4 px-3 space-y-1">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={close}
              title={rail ? label : undefined}
              className={cn(
                "flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                rail ? "gap-0 justify-center" : "gap-3",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-primary"
              )}
            >
              <Icon size={ICON_SIZE} className="shrink-0" />
              <span className={labelClass(rail)}>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom — Settings, theme toggle, and collapse sit on one row when
          expanded; stack (each full-width) when collapsed, since three icon
          buttons don't fit the narrow rail side by side. */}
      <div className="border-t border-border px-2 py-3">
        <div className={cn("flex items-center gap-1", rail && "flex-col")}>
          <Link
            href="/settings"
            onClick={close}
            title={rail ? "Settings" : undefined}
            className={cn(
              "flex items-center rounded-xl py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-primary transition-colors min-w-0",
              rail ? "w-full px-3 gap-0 justify-center" : "flex-1 px-2 gap-2"
            )}
          >
            <Settings size={ICON_SIZE} className="shrink-0" />
            <span className={labelClass(rail)}>Settings</span>
          </Link>

          <ThemeToggle className={rail ? "w-full flex justify-center px-3 py-2.5 rounded-xl" : "flex justify-center px-2 py-2.5 rounded-xl shrink-0"} />

          {!mobileOpen && (
            <button
              onClick={toggleCollapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "hidden md:flex items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-primary transition-colors shrink-0",
                rail ? "w-full px-3 py-2.5" : "px-2 py-2.5"
              )}
            >
              {collapsed ? <PanelLeftOpen size={ICON_SIZE} className="shrink-0" /> : <PanelLeftClose size={ICON_SIZE} className="shrink-0" />}
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {mobileMenuButton}

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar — fixed on mobile, sticky on desktop */}
      <aside className={cn(
        "flex flex-col border-r border-border bg-surface transition-[width] duration-200",
        mobileOpen
          ? "fixed top-0 left-0 z-50 w-56 h-[100dvh] overflow-y-auto"
          : rail
            ? "hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 md:w-16 md:overflow-x-hidden md:overflow-y-auto"
            : "hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 md:w-48 md:overflow-x-hidden md:overflow-y-auto"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}
