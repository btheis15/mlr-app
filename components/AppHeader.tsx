"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppImages } from "@/lib/useAppImages";
import { siteImageSrc } from "@/lib/appImages";
import { SeasonalLogoFX } from "@/components/SeasonalLogoFX";

/**
 * The top-of-Home chrome: the green MLR cabin logo, centered, tapping goes Home.
 * Renders only on Home. Size is fixed via CSS clamp in app/globals.css (#app-logo)
 * at ~10–11% of viewport height. Carries a still seasonal "snapshot" of the
 * splash's animation (leaves / snow / flowers / sun) over the logo.
 */
export function AppHeader() {
  const onHome = usePathname() === "/";
  const images = useAppImages();

  if (!onHome) return null;

  return (
    <header className="flex justify-center pb-1 pt-1">
      <Link href="/" aria-label="Muskellunge Lake Resort — Home" className="press relative min-w-0">
        {/* The green cabin-in-the-pines brand logo (same mark as the opening
            splash), not the stylized wordmark. Its height is responsive — a CSS
            clamp in app/globals.css (#app-logo) refined at runtime by the effect
            above to fill the top as the app's hero; `w-auto max-w-full` keeps the
            aspect ratio and prevents overflow on narrow screens. The link box is
            exactly the logo's box, so the seasonal overlay lines up with it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          id="app-logo"
          src={siteImageSrc(images, "home_logo")}
          alt="Muskellunge Lake Resort"
          className="block w-auto max-w-full"
        />
        <SeasonalLogoFX animate={false} />
      </Link>
    </header>
  );
}
