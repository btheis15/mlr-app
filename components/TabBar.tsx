"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";
import { useUnreadNotifications } from "@/lib/hooks";
import { Icon } from "@/components/Icon";
import { haptic } from "@/lib/haptics";
import { AnimatedNumber } from "@/components/AnimatedNumber";

// Icons are names from the hand-rolled line-icon set (components/Icon.tsx);
// the fest tab wears a tent (the gathering), not the old crossed swords.
const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/posts", label: "Feed", icon: "feed" },
  { href: "/family-fest", label: "Family Fest", icon: "fest" },
  // The Activity feed — everything that happened involving you. Tab label and
  // page title are aligned on "Activity" (one name per thing).
  { href: "/notifications", label: "Activity", icon: "bell" },
  // Profile (your account, settings, sign-out) is back in the last slot. People
  // (the member directory) moved off the tab bar to a card on Home.
  { href: "/profile", label: "Profile", icon: "person" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  // During the event week, mark the Family Fest tab "live" so the takeover is
  // discoverable from anywhere in the resort app.
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  // Unread (unseen, unexpired) notification count → red badge on the bell.
  const unread = useUnreadNotifications();

  // Drop the tab bar out of the way while the on-screen keyboard is open. On iOS
  // a `position: fixed` bottom bar gets stranded mid-screen between the field and
  // the keyboard (it's anchored to the layout viewport, which doesn't shrink), so
  // we slide it off-screen whenever the visual viewport reports a keyboard.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const check = () => setKeyboardOpen(window.innerHeight - vv.height > 120);
    check();
    vv.addEventListener("resize", check);
    // On iOS the visualViewport fires a resize with wrong dimensions during the
    // background→foreground transition, which locks the bar off-screen. Reset
    // immediately when the app becomes visible, then re-check once settled.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setKeyboardOpen(false);
        settleTimer = setTimeout(check, 300);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", onVisible);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return (
    <nav
      aria-hidden={keyboardOpen}
      // Solid (not bg-card/95 + backdrop-blur): on iOS a `position: fixed` bar
      // with a backdrop-filter composites on its own layer that WebKit samples at
      // a stale offset during scroll, so the bar appears to lift off the bottom
      // with page content bleeding below it. An opaque bg removes the glitch.
      // `translate-y-0` (vs no transform) keeps it on a stable compositor layer
      // so its position tracks the viewport cleanly during scroll.
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-card transition-transform duration-200 ${keyboardOpen ? "translate-y-full" : "translate-y-0"}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const isFest = tab.href === "/family-fest";
          const live = isFest && (season?.isLive || season?.isWrap);
          const isNotif = tab.href === "/notifications";
          // The Family Fest tab wears the fest's heraldic wine so it reads as
          // its own theme; the rest use the resort's forest green.
          const color = isFest
            ? active
              ? "font-semibold text-fest"
              : "text-fest/60"
            : active
              ? "font-semibold text-primary"
              : "text-foreground/50";
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => haptic("light")}
                className={`press flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${color}`}
              >
                <span className="relative">
                  {/* Active = bolder stroke + a spring pop. The pop replays on
                      each activation because the key flips off→on, remounting
                      this span (a class swap alone wouldn't restart the keyframe).
                      Badges live on the OUTER span so they don't scale with it.
                      Color comes from the Link's text class (fest wine vs forest
                      green) via the icon's currentColor. */}
                  <span
                    key={active ? "on" : "off"}
                    className={`block transition-transform ${active ? "scale-110 tab-icon-pop" : ""}`}
                  >
                    <Icon
                      name={tab.icon}
                      size={22}
                      strokeWidth={active ? 2.4 : 1.8}
                      className="block"
                    />
                  </span>
                  {live && (
                    <span className="absolute -right-1.5 -top-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fest/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-fest" />
                    </span>
                  )}
                  {isNotif && unread > 0 && (
                    <span
                      aria-label={`${unread} new`}
                      className="absolute -right-2.5 -top-1 flex min-w-[1.05rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[1.05rem] text-white ring-2 ring-card"
                    >
                      {unread > 99 ? "99+" : <AnimatedNumber value={unread} duration={350} />}
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
