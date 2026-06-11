"use client";

import { useEffect, useState } from "react";
import { RESORT } from "@/lib/data";

// App-open splash. A near-white wash (the app's own background) so it blends with
// the white screen the app naturally shows while loading — then the GREEN logo
// pops in, the motto rises below it in green, it holds a few seconds, and fades
// to reveal the app. Rendered from the server markup so it covers from the first
// paint; respects reduce-motion; tap-to-skip.
//
// Robustness: the fade-out + click-through is CSS-driven (`splash-wash` ends at
// opacity:0 + pointer-events:none), so the overlay always clears itself even if
// JS hydrates late on spotty wifi — it can never trap the app. The React timer
// just removes the node cleanly afterward.
export function SplashIntro() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Skip the motion for reduce-motion users (the overlay is removed at once).
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setGone(true);
      return;
    }
    const done = setTimeout(() => setGone(true), 3400);
    return () => clearTimeout(done);
  }, []);

  if (gone) return null;

  return (
    <div
      onClick={() => setGone(true)}
      aria-hidden
      className="splash-wash fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background px-8 text-center"
    >
      {/* Green-on-transparent logo (recolored from brand-logo.jpg) on the white wash. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-logo-green.png" alt="" className="splash-logo h-44 w-auto max-w-[82%]" />
      <p className="splash-motto -mt-1 text-sm font-medium tracking-wide text-primary/80">
        {RESORT.tagline}
      </p>
    </div>
  );
}
