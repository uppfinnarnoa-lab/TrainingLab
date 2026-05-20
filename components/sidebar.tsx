"use client";

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

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-border bg-surface"
      style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: "14rem", zIndex: 40 }}
    >
      {/* Logo */}
      <div className="flex h-16 items-end px-4 pb-3 border-b border-border">
        <LogoWordmark size={28} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
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
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-primary transition-colors"
        >
          <Settings size={16} />
          Settings
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
