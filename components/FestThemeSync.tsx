"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isFamilyFestPath } from "@/lib/festPath";

const FF_ATTR = "data-ff"; // on <html> while viewing a Family Fest route — see html[data-ff] in globals.css

// `.ff-section` (app/family-fest/layout.tsx) only paints its OWN content box
// parchment — it doesn't reach the viewport-level canvas painted by <html>'s
// own ambient background, so that forest-green wash still showed through
// during rubber-band bounce at the top/bottom of the screen, and around any
// content shorter than the viewport. This keeps <html> itself toggled to the
// parchment ambient while on a Family Fest route, mirroring SplashIntro's
// data-splash attribute pattern.
export function FestThemeSync() {
  const pathname = usePathname();
  useEffect(() => {
    if (isFamilyFestPath(pathname)) {
      document.documentElement.setAttribute(FF_ATTR, "");
    } else {
      document.documentElement.removeAttribute(FF_ATTR);
    }
  }, [pathname]);
  return null;
}
