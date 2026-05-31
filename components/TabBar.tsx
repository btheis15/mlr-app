"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/activities", label: "Activities", icon: "🎣" },
  { href: "/family-fest", label: "Family Fest", icon: "🎉" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/profile", label: "Profile", icon: "👤" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  // During the event week, mark the Family Fest tab "live" so the takeover is
  // discoverable from anywhere in the resort app.
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const live =
            tab.href === "/family-fest" && (season?.isLive || season?.isWrap);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  active ? "text-primary" : "text-foreground/50"
                }`}
              >
                <span className="relative text-lg leading-none">
                  {tab.icon}
                  {live && (
                    <span className="absolute -right-1.5 -top-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campfire/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-campfire" />
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
