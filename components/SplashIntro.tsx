"use client";

import { useEffect, useState } from "react";
import { RESORT } from "@/lib/data";

// App-open splash: a full-screen forest-green wash (the logo's exact green) that
// the logo pops into, the motto rises below, then the whole thing fades to reveal
// the app. Plays once per session (a true relaunch is a fresh session), respects
// reduce-motion, and is tap-to-skip. Rendered from the server markup so it covers
// from the first paint (no flash of the app underneath); the client then plays /
// skips it. Mounted globally in layout.tsx.
const SESSION_KEY = "mlr-splash";

export function SplashIntro() {
  const [gone, setGone] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let already = false;
    try {
      already = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* private mode — just play it */
    }
    if (reduce || already) {
      setGone(true);
      return;
    }
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    const fade = setTimeout(() => setFading(true), 1900); // start the fade-out
    const done = setTimeout(() => setGone(true), 2450); // unmount after it
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      onClick={() => setGone(true)}
      aria-hidden
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-logo px-8 text-center transition-opacity duration-500 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* The logo's own green matches the wash, so only the white art shows. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-logo.jpg" alt="" className="splash-logo h-40 w-auto max-w-[78%]" />
      <p className="splash-motto mt-1 text-sm font-medium tracking-wide text-white/85">
        {RESORT.tagline}
      </p>
    </div>
  );
}
