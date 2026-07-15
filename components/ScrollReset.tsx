"use client";

import { useEffect } from "react";

// `#app-scroll` (the <main> in app/layout.tsx) is the app's one scroll
// container (see globals.css's note on it) and, unlike this component's
// parent — app/template.tsx's per-navigation wrapper — it does NOT remount
// on route changes, since it lives in the outer, persistent RootLayout. So
// its scrollTop would otherwise carry over from whatever page you were
// previously on. This remounts alongside template.tsx on every navigation
// (same lifecycle PullToRefresh used to ride) and resets it to the top,
// matching the browser's native "new page starts scrolled to top" behavior.
// Renders nothing — a pure side effect.
export function ScrollReset() {
  useEffect(() => {
    document.getElementById("app-scroll")?.scrollTo({ top: 0 });
  }, []);
  return null;
}
