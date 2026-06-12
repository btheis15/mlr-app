"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";

// brand-logo-green.png intrinsic ratio (1340×896) — used to cap the logo height
// by the width actually available to it, so an explicit height never forces
// `max-w-full` to kick in and squish the mark on a narrow screen.
const LOGO_ASPECT = 1340 / 896;
// Breathing room left below the "Get involved" card. It matches the gap between
// the two resort groups (HomeResortGroups `space-y-3` → 12px), so the NEXT card
// ("Around the resort") lands right at the tab-bar fold and stays hidden — the
// screen reads as "full" with Get involved as the last fully-visible card.
const FIT_MARGIN = 12;
const MIN_LOGO = 64; // never shrink below the original h-16

/**
 * The persistent top app chrome — your profile photo in the top-left corner
 * (Facebook/X style; a generic "blank profile" icon until you add a photo)
 * linking to Profile. It shows on every tab, so Profile is always one tap away.
 *
 * The big MLR cabin logo, however, is shown **only on Home** (centered beside
 * the avatar) — the other tabs carry their own titles/back-links, so the hero
 * logo there would just be wasted space. Tapping the photo opens Profile;
 * tapping the logo goes Home. The right-side spacer matches the avatar width so
 * the logo stays optically centered.
 *
 * On Home the logo is a responsive hero — it grows to fill the top so "Get
 * involved" lands as the last fully-visible card above the tab bar. A CSS
 * `clamp()` (`#app-logo` in app/globals.css) gives a baseline from the viewport
 * (the no-JS / pre-hydration fallback); the effect below refines it against the
 * LIVE layout. Because the logo can be much taller than the avatar, the row is
 * top-aligned (`items-start`) to keep the profile photo pinned top-left.
 */
export function AppHeader() {
  const { user } = useIdentity();
  const onHome = usePathname() === "/";

  // Size the hero logo to the live layout, not just the viewport. Pure CSS can't
  // do this: the stack above "Get involved" varies per user (the beta "Ask for
  // Help" card, Family Fest takeover weeks, a longer announcement…), so a fixed
  // CSS constant clips the card for some people and leaves a gap for others.
  // Only runs on Home, where the hero logo + "Get involved" card exist.
  useEffect(() => {
    if (!onHome) return;
    const logo = document.getElementById("app-logo");
    if (!logo) return;

    const fit = () => {
      const heading = Array.from(document.querySelectorAll("h2")).find(
        (h) => h.textContent?.trim() === "Get involved",
      );
      // Anchor on the collapsed card BAR (the button) — its bottom doesn't move
      // when the accordion opens, so tapping the card never resizes the logo.
      const card = heading?.closest("button");
      const tabBar = document.querySelector("nav.fixed"); // the fixed TabBar
      if (!card || !tabBar) return;

      const fold = tabBar.getBoundingClientRect().top;
      const cardBottom = card.getBoundingClientRect().bottom;
      const current = logo.getBoundingClientRect().height;

      // cardBottom moves 1:1 with the logo height, so this is a single step:
      // land the card's bottom FIT_MARGIN px above the fold.
      let next = current + (fold - cardBottom) - FIT_MARGIN;
      // Cap by the width available to the logo (avatar + spacer + gaps flank it:
      // 40 + 40 + 16 = 96px) so the aspect ratio is never broken.
      const header = logo.closest("header");
      const avail = (header?.clientWidth ?? window.innerWidth) - 96;
      next = Math.max(MIN_LOGO, Math.min(next, avail / LOGO_ASPECT));

      if (Math.abs(next - current) > 1) logo.style.height = `${next}px`;
    };

    fit();
    // Re-fit when content reflows (e.g. the async beta card mounting above "Get
    // involved") and on viewport changes. Anchoring on the collapsed bar means
    // opening an accordion doesn't move our anchor, so this can't loop on taps.
    const ro = new ResizeObserver(fit);
    const main = document.querySelector("main");
    if (main) ro.observe(main);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [onHome]);

  return (
    <header className="flex items-start justify-between gap-2 pb-1 pt-1">
      <Link
        href="/profile"
        aria-label="Your profile"
        className="press shrink-0 rounded-full"
      >
        <Avatar name={user?.name ?? ""} url={user?.avatarUrl} size={40} fallback="icon" />
      </Link>

      {onHome && (
        <>
          <Link href="/" aria-label="Muskellunge Lake Resort — Home" className="press min-w-0">
            {/* The green cabin-in-the-pines brand logo (same mark as the opening
                splash), not the stylized wordmark. Its height is responsive — a
                CSS clamp in app/globals.css (#app-logo) refined at runtime by the
                effect above to fill the top as the app's hero; `w-auto max-w-full`
                keeps the aspect ratio and prevents overflow on narrow screens.
                Tagged `app-logo` so the SplashIntro can measure this exact spot
                and fly the splash logo into it for a seamless hand-off. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              id="app-logo"
              src="/brand-logo-green.png"
              alt="Muskellunge Lake Resort"
              className="block w-auto max-w-full"
            />
          </Link>

          {/* Spacer to balance the avatar so the logo stays centered. */}
          <span aria-hidden className="h-10 w-10 shrink-0" />
        </>
      )}
    </header>
  );
}
