"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/posts", label: "Feed", icon: "📣" },
  { href: "/family-fest", label: "Family Fest", icon: "🎉" },
  { href: "/profile", label: "Profile", icon: "👤" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  // During the event week, mark the Family Fest tab "live" so the takeover is
  // discoverable from anywhere in the resort app.
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);

  // Drop the tab bar out of the way while the on-screen keyboard is open. On iOS
  // a `position: fixed` bottom bar gets stranded mid-screen between the field and
  // the keyboard (it's anchored to the layout viewport, which doesn't shrink), so
  // we slide it off-screen whenever the visual viewport reports a keyboard.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => setKeyboardOpen(window.innerHeight - vv.height > 120);
    onResize();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return (
    <nav
      aria-hidden={keyboardOpen}
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur transition-transform duration-200 ${keyboardOpen ? "translate-y-full" : ""}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const isFest = tab.href === "/family-fest";
          const live = isFest && (season?.isLive || season?.isWrap);
          // The Family Fest tab wears the fest's heraldic wine so it reads as
          // its own theme; the rest use the resort's forest green.
          const color = isFest
            ? active
              ? "font-semibold text-[#8b2e2e]"
              : "text-[#8b2e2e]/60"
            : active
              ? "font-semibold text-primary"
              : "text-foreground/50";
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`press flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${color}`}
              >
                <span
                  className={`relative text-lg leading-none transition-transform ${
                    active ? "scale-110" : ""
                  }`}
                >
                  {tab.icon}
                  {live && (
                    <span className="absolute -right-1.5 -top-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8b2e2e]/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8b2e2e]" />
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
