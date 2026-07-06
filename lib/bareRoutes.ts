"use client";

// "Bare" routes render as a focused, full-window page WITHOUT the app chrome
// (install nag, splash, push prompt). The Family Fest master
// editor is opened from the iOS app, so it must drop straight into the editor —
// no "Add to Home Screen" flash or splash on the way in.

import { usePathname } from "next/navigation";

const BARE_ROUTES = ["/family-fest/master"];

export function useIsBareRoute(): boolean {
  const pathname = usePathname();
  return BARE_ROUTES.includes(pathname);
}
