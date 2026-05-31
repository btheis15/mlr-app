"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// In-section navigation for the Family Fest area. A horizontally scrollable row
// of labeled pills (icon + word, big tap targets) so it's obvious and easy —
// especially for less app-savvy folks — without crowding the bottom tab bar.
const SECTIONS = [
  { href: "/family-fest", label: "Overview", icon: "🏰" },
  { href: "/family-fest/schedule", label: "Schedule", icon: "🗓️" },
  { href: "/family-fest/dinners", label: "Dinners", icon: "🍽️" },
  { href: "/family-fest/crew", label: "Crew", icon: "👨‍👩‍👧‍👦" },
  { href: "/family-fest/photos", label: "Photos", icon: "📸" },
  { href: "/family-fest/pay", label: "Pay", icon: "💸" },
] as const;

export function FamilyFestNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Family Fest sections"
      className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max gap-2">
        {SECTIONS.map((s) => {
          const active =
            s.href === "/family-fest"
              ? pathname === "/family-fest"
              : pathname.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap ring-1 transition-colors ${
                  active
                    ? "bg-primary text-white ring-primary"
                    : "bg-card text-foreground/70 ring-border"
                }`}
              >
                <span aria-hidden>{s.icon}</span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
