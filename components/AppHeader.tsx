"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/components/IdentityProvider";
import { fitAppLogo } from "@/lib/appLogoFit";

/**
 * The top-of-Home chrome: the green MLR cabin logo, centered, as the app's
 * hero — tapping it goes Home. It renders **only on Home**; the other tabs have
 * their own titles/back-links and a Profile tab of their own, so there's no
 * persistent bar (and no stray profile icon) floating across them.
 *
 * The logo is a responsive hero — it grows to fill the top so the marked
 * `[data-fit-anchor]` card (the Ask-for-Help / People row) lands as the last
 * fully-visible thing above the tab bar. A CSS `clamp()` (`#app-logo` in
 * app/globals.css) is the no-JS / pre-hydration baseline; the shared `fitAppLogo`
 * (lib/appLogoFit.ts) refines it against the live layout. It fits at load (and
 * when the beta card resolves / on viewport change) but NOT on live reflow — so
 * opening an accordion just scrolls, it never resizes the logo. Tagged
 * `id="app-logo"` so the SplashIntro can measure this spot — using the SAME fit —
 * and fly the splash logo into it.
 */
export function AppHeader() {
  const onHome = usePathname() === "/";
  // Whether the beta "Ask for Help" tile shows changes the anchor row's size, so
  // re-fit when it resolves.
  const { isBetaTester } = useIdentity();

  useEffect(() => {
    if (!onHome) return;
    if (!document.getElementById("app-logo")) return;

    // Fit while the initial layout settles — the cards above the anchor (Family
    // Fest spotlight, upcoming events, the first-visit Welcome card, the beta
    // tile) finish loading/measuring over the first ~2s, which is exactly while
    // the splash overlay is still covering the screen, so these adjustments
    // aren't visible. Then DISCONNECT: once it's locked, expanding an accordion
    // just scrolls — it never resizes the logo. Rotation still re-fits via the
    // listeners below.
    const fit = () => { fitAppLogo(); };
    fit();
    const ro = new ResizeObserver(fit);
    const main = document.querySelector("main");
    if (main) ro.observe(main);
    const stop = setTimeout(() => ro.disconnect(), 3000);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      clearTimeout(stop);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [onHome, isBetaTester]);

  if (!onHome) return null;

  return (
    <header className="flex justify-center pb-1 pt-1">
      <Link href="/" aria-label="Muskellunge Lake Resort — Home" className="press min-w-0">
        {/* The green cabin-in-the-pines brand logo (same mark as the opening
            splash), not the stylized wordmark. Its height is responsive — a CSS
            clamp in app/globals.css (#app-logo) refined at runtime by the effect
            above to fill the top as the app's hero; `w-auto max-w-full` keeps the
            aspect ratio and prevents overflow on narrow screens. Tagged
            `app-logo` so the SplashIntro can measure this exact spot and fly the
            splash logo into it for a seamless hand-off. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          id="app-logo"
          src="/brand-logo-green.png"
          alt="Muskellunge Lake Resort"
          className="block w-auto max-w-full"
        />
      </Link>
    </header>
  );
}
