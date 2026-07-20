"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppImages } from "@/lib/useAppImages";
import { siteImageSrc } from "@/lib/appImages";

/**
 * The top-of-Home chrome: the green MLR cabin logo, centered, tapping goes Home.
 * Renders only on Home. Size is fixed via CSS clamp in app/globals.css (#app-logo)
 * at ~10–11% of viewport height. Tagged `id="app-logo"` so SplashIntro can
 * measure the spot and fly the splash logo into it.
 */
export function AppHeader() {
  const onHome = usePathname() === "/";
  const images = useAppImages();

  if (!onHome) return null;

  return (
    <header className="flex justify-center pb-1 pt-1 lg:hidden">
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
          src={siteImageSrc(images, "home_logo")}
          alt="Muskellunge Lake Resort"
          className="block w-auto max-w-full"
        />
      </Link>
    </header>
  );
}
