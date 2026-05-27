"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { LogoWordmark } from "./logo";

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

  const close = () => setMobileOpen(false);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-16 items-end px-4 pb-3 border-b border-border justify-between">
        <LogoWordmark size={34} />
        <button onClick={close} className="md:hidden p-1.5 rounded-lg text-muted hover:text-primary transition">
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
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
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-xl bg-surface border border-border text-muted hover:text-primary shadow-sm transition"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar — fixed on mobile, sticky on desktop */}
      <aside className={cn(
        "flex flex-col border-r border-border bg-surface overflow-y-auto",
        mobileOpen
          ? "fixed inset-y-0 left-0 z-50 w-64 h-screen"
          : "hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 md:w-56"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}
