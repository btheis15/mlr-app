"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";

// App-open splash. A near-white wash (the app's own background) so it blends
// with the white screen the app naturally shows while loading — then the GREEN
// cabin logo pops in centered, holds a beat, and then *flies* up into the
// top-left app header, zooming down to the header logo's exact size and
// position. The real header logo (#app-logo) is kept HIDDEN for the whole
// splash (CSS: `html[data-splash] #app-logo { opacity: 0 }`) so there's no
// second copy to blur against; the instant the fly lands, we drop the overlay
// and the attribute together, so the logo appears to be *placed* into the
// header — a clean hand-off, not a cross-fade.
//
// How the fly is exact (a FLIP transition): we measure the live header logo's
// bounding rect at runtime and translate/scale the splash logo's center onto
// it, so it lands pixel-perfect on any screen size. The hidden header logo is
// opacity:0 (not display:none), so it's still laid out and measurable. Both
// logos are the same image + aspect ratio and both are horizontally centered,
// so a single translate+scale maps one onto the other.
//
// Robustness: reduce-motion users skip straight to the app (the attribute is
// never set, so the header logo shows normally); tap-to-skip works at any
// point; and if the header logo can't be found (unexpected), we just clear
// rather than trap the app.
const HOLD_MS = 1300; // center pop + min hold before the logo can fly
const FLY_MS = 720; // fly + zoom into the header
// Safety cap: if the auth check is still pending this long (slow/offline
// network), fly anyway rather than sit on the splash forever. Kept under the
// CSS `splash-wash` self-clear window so JS always finishes the hand-off first.
const MAX_WAIT_MS = 4500;
const SPLASH_ATTR = "data-splash"; // on <html> while the splash owns the logo

export function SplashIntro() {
  // Hold the splash until the initial auth check has settled, so the app's first
  // visible paint is already the right member/guest view — no post-splash shift.
  const { authReady } = useIdentity();
  const [phase, setPhase] = useState<"intro" | "flying" | "done">("intro");
  const logoRef = useRef<HTMLImageElement>(null);
  const [flyTransform, setFlyTransform] = useState<string | undefined>();
  // The two gates for starting the fly: the minimum hold has elapsed, and either
  // auth resolved or the safety cap fired. `started` guards against re-entry from
  // the effect re-running as those inputs settle.
  const [held, setHeld] = useState(false);
  const [forced, setForced] = useState(false);
  const reduceRef = useRef(false);
  const started = useRef(false);

  // Clear the overlay AND reveal the header logo in the same beat, so the
  // hand-off reads as "the logo was placed there" with no overlap/blur.
  const finish = () => {
    document.documentElement.removeAttribute(SPLASH_ATTR);
    setPhase("done");
  };

  useEffect(() => {
    reduceRef.current = Boolean(
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
    // Reduce-motion users skip the fly, but we still hold the plain logo screen
    // until auth resolves (a hard cut, no animation) so they don't see the shift
    // either. The header logo is only hidden when we're going to fly into it.
    if (!reduceRef.current) document.documentElement.setAttribute(SPLASH_ATTR, "");
    const tHold = setTimeout(() => setHeld(true), HOLD_MS);
    const tMax = setTimeout(() => setForced(true), MAX_WAIT_MS);
    return () => {
      clearTimeout(tHold);
      clearTimeout(tMax);
      document.documentElement.removeAttribute(SPLASH_ATTR);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the exit once we've held a beat AND auth has settled (or the cap hit).
  useEffect(() => {
    if (started.current) return;
    if (forced || (held && authReady)) {
      started.current = true;
      startFly();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, authReady, forced]);

  const startFly = () => {
    const target = document.getElementById("app-logo");
    const el = logoRef.current;
    if (reduceRef.current || !target || !el) {
      finish();
      return;
    }
    const from = el.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const scale = to.height / from.height;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    // Drop the centering "pop" animation (its fill would pin transform) and arm
    // the transition first; apply the target transform on the next frames so the
    // browser animates from the centered state instead of snapping.
    setPhase("flying");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlyTransform(`translate(${dx}px, ${dy}px) scale(${scale})`)),
    );
    setTimeout(finish, FLY_MS + 60);
  };

  if (phase === "done") return null;

  return (
    <div
      onClick={finish}
      aria-hidden
      // `splash-wash` is the CSS-driven safety net: even if JS never runs, the
      // whole overlay animates to opacity:0 + pointer-events:none on its own, so
      // it can't trap the app. In the normal flow JS removes it well before then.
      className="splash-wash fixed inset-0 z-[100] flex items-center justify-center px-8"
    >
      {/* White wash behind the logo; fades out as the logo flies up, revealing
          the app underneath. */}
      <div
        className="absolute inset-0 bg-background"
        style={{ opacity: phase === "intro" ? 1 : 0, transition: `opacity ${FLY_MS}ms ease-out` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={logoRef}
        src="/brand-logo-green.png"
        alt=""
        className={`relative h-44 w-auto max-w-[82%] ${phase === "intro" ? "splash-logo" : ""}`}
        style={{
          transform: flyTransform,
          transition: phase === "flying" ? `transform ${FLY_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : undefined,
          willChange: "transform",
        }}
      />
    </div>
  );
}
