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
import { Logo, LogoWordmark } from "./logo";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

const nav = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { href: "/activities", icon: Activity,        label: "Activities" },
  { href: "/history",    icon: History,         label: "Activity History" },
  { href: "/stats",      icon: BarChart3,       label: "Statistics" },
  { href: "/planner",    icon: Calendar,        label: "Planner" },
  { href: "/coach",      icon: MessageSquare,   label: "Coach" },
  { href: "/races",      icon: Trophy,          label: "Races & PBs" },
];

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

  const mobileMenuButton = (
    <button
      onClick={() => setMobileOpen(true)}
      className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-xl bg-surface border border-border text-muted hover:text-primary shadow-sm transition"
      aria-label="Open menu"
    >
      <Menu size={20} />
    </button>
  );

  // ── Collapsed rail (desktop only — mobile always uses the full drawer) ───
  if (!mobileOpen && collapsed) {
    return (
      <>
        {mobileMenuButton}
        <aside className="hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen md:shrink-0 md:w-14 border-r border-border bg-surface items-center py-3 gap-1">
          <button
            onClick={toggleCollapsed}
            title="Expand sidebar"
            className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition mb-2"
          >
            <Logo size={24} />
          </button>

          <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-1 w-full px-2">
            {nav.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={cn(
                    "p-2.5 rounded-xl transition-colors",
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-primary"
                  )}
                >
                  <Icon size={18} />
                </Link>
              );
            })}
          </nav>

          <Link
            href="/settings"
            title="Settings"
            className="p-2.5 rounded-xl text-muted hover:bg-surface-2 hover:text-primary transition-colors"
          >
            <Settings size={16} />
          </Link>
          <ThemeToggle />
        </aside>
      </>
    );
  }

  // ── Full sidebar — expanded desktop, or the mobile drawer ────────────────
  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-16 items-end px-4 pb-3 border-b border-border justify-between">
        <LogoWordmark size={34} />
        {mobileOpen ? (
          <button onClick={close} aria-label="Close menu" className="md:hidden p-1.5 rounded-lg text-muted hover:text-primary transition">
            <X size={18} />
          </button>
        ) : (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            className="hidden md:inline-flex p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-2 transition"
          >
            <PanelLeftClose size={16} />
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
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-primary"
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border p-3 flex items-center justify-between">
        <Link
          href="/settings"
          onClick={close}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-primary transition-colors"
        >
          <Settings size={16} />
          Settings
        </Link>
        <ThemeToggle />
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
        "flex flex-col border-r border-border bg-surface",
        mobileOpen
          ? "fixed top-0 left-0 z-50 w-56 h-[100dvh] overflow-y-auto"
          : "hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 md:w-48 md:overflow-y-auto"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}
