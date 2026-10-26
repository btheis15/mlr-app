"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { SeasonalLogoFX } from "@/components/SeasonalLogoFX";
import { onQuietOnce } from "@/lib/appReady";
import { useIsBareRoute } from "@/lib/bareRoutes";

// App-open splash. A near-white wash (the app's own background) so it blends
// with the white screen the app naturally shows while loading — then the GREEN
// cabin logo pops in centered while a short seasonal animation plays over it
// (falling leaves in fall, snow in winter, flowers blooming in spring, a shining
// sun in summer — see SeasonalLogoFX). Once it has held long enough for that to
// play AND the app is ready, the whole splash simply fades away, revealing the
// app underneath; the header logo (which carries the seasonal *snapshot* of the
// same scene) is just sitting there on top.
//
// Robustness: reduce-motion users get the still seasonal logo for a shorter hold
// (no animation); tap-to-skip works at any point.
const HOLD_MS = 2500; // pop + seasonal animation plays (SeasonalLogoFX ≈ 2.4s)
const HOLD_REDUCED_MS = 1300; // reduce-motion: no animation to wait for
const FADE_MS = 500; // splash fade-out
// Safety cap: if the auth check is still pending this long (slow/offline
// network), fade anyway rather than sit on the splash forever. Kept under the
// CSS `splash-wash` self-clear window so JS always finishes the hand-off first.
const MAX_WAIT_MS = 4500;
// After auth settles, the splash also waits (briefly, bounded) for the
// first-paint readiness registry (lib/appReady) to go quiet — i.e. for any
// COLD data loads (nothing seeded from cache) to land — so the first revealed
// frame is complete instead of popping cards in right after. On a warm open
// every card seeds from its persisted cache, nothing registers, and this adds
// ~0ms. MAX_WAIT_MS above remains the absolute ceiling either way.
const EXTRA_QUIET_MS = 700;

export function SplashIntro() {
  // Hold the splash until the initial auth check has settled, so the app's first
  // visible paint is already the right member/guest view — no post-splash shift.
  const { authReady } = useIdentity();
  const bare = useIsBareRoute();
  const [phase, setPhase] = useState<"intro" | "fading" | "done">("intro");
  // The two gates for fading: the minimum hold has elapsed, and either auth
  // resolved or the safety cap fired. `started` guards against re-entry from the
  // effect re-running as those inputs settle.
  const [held, setHeld] = useState(false);
  const [forced, setForced] = useState(false);
  const started = useRef(false);

  const finish = () => setPhase("done");

  useEffect(() => {
    // On a bare route (the master editor opened from iOS), skip the splash
    // entirely — no logo flash on the way into the editor.
    if (bare) return;
    const reduce = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    const tHold = setTimeout(() => setHeld(true), reduce ? HOLD_REDUCED_MS : HOLD_MS);
    const tMax = setTimeout(() => setForced(true), MAX_WAIT_MS);
    return () => {
      clearTimeout(tHold);
      clearTimeout(tMax);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the exit once we've held a beat AND auth has settled (or the cap
  // hit). The normal path defers up to EXTRA_QUIET_MS more for cold data loads
  // (see above); the MAX_WAIT_MS `forced` path fires immediately regardless —
  // it exists to guarantee the splash can never hang. `started` means "the fade
  // actually began", so a forced fire while the quiet-wait is still pending
  // cancels the wait and fades right away.
  const quietCancel = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (started.current) return;
    const fade = () => {
      if (started.current) return;
      started.current = true;
      setPhase("fading");
      setTimeout(finish, FADE_MS + 60);
    };
    if (forced) {
      quietCancel.current?.();
      quietCancel.current = null;
      fade();
      return;
    }
    if (held && authReady && !quietCancel.current) {
      quietCancel.current = onQuietOnce(EXTRA_QUIET_MS, fade);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, authReady, forced]);
  // Unmount: drop any pending quiet-wait so it can't fire into a dead tree.
  useEffect(
    () => () => {
      quietCancel.current?.();
      quietCancel.current = null;
    },
    [],
  );

  if (bare || phase === "done") return null;

  return (
    <div
      onClick={finish}
      aria-hidden
      // `splash-wash` is the CSS-driven safety net: even if JS never runs, the
      // whole overlay animates to opacity:0 + pointer-events:none on its own, so
      // it can't trap the app. In the normal flow JS removes it well before then.
      className="splash-wash fixed inset-0 z-[100]"
    >
      {/* Everything fades together (on an inner layer: the wash animation owns the
          outer one's opacity). */}
      <div
        className="absolute inset-0 flex items-center justify-center bg-background px-8"
        style={{ opacity: phase === "intro" ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out` }}
      >
        {/* The wrapper is exactly the logo's box, so the seasonal overlay lines up. */}
        <div className="splash-logo relative h-44 max-w-[82%]" style={{ aspectRatio: "1340 / 896" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-logo-green.png" alt="" className="block h-full w-full" />
          <SeasonalLogoFX animate />
        </div>
      </div>
    </div>
  );
}
