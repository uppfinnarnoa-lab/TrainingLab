"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/settings",         label: "Integrations" },
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/sports",  label: "Training Types" },
  { href: "/settings/goals",   label: "Goals" },
  { href: "/settings/account", label: "Account" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border -mx-1 px-1">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px",
              active
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-primary"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
