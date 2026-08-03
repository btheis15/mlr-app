"use client";

import { useEffect } from "react";

/**
 * iOS on-screen-keyboard fix for the one scroll container (`#app-scroll`).
 *
 * On iOS Safari / a standalone PWA the software keyboard **overlays** the
 * layout viewport — it does NOT shrink it (the viewport's
 * `interactiveWidget: "resizes-content"` only affects Android Chrome, see
 * `app/layout.tsx`). So any form whose fields/buttons sit near the bottom of a
 * long, normally-scrolled page (the admin Committees editors, the "+ Add a
 * member" search, the per-member area editor, …) ends up with its results and
 * Save/Done controls stranded BEHIND the keyboard, with no scroll room left to
 * bring them up above it. Desktop has no keyboard, so it only bites on mobile —
 * which is exactly the "works on desktop, can't scroll to it on mobile" report.
 *
 * This measures how much of the viewport the keyboard is covering (via the
 * `visualViewport` API — the same signal the chat rooms pin themselves with)
 * and feeds it to `#app-scroll` as an extra bottom padding through the
 * `--keyboard-inset` custom property. That creates precisely the scroll room
 * needed to lift bottom-anchored content clear of the keyboard.
 *
 * Self-zeroing everywhere it isn't needed: on Android the layout viewport
 * shrinks with the keyboard, so `innerHeight ≈ visualViewport.height` and the
 * overlap computes to ~0; on desktop there's no keyboard at all. The active
 * chat rooms overlay the page (fixed height pinned to the visual viewport) and
 * don't scroll `#app-scroll`, so the extra padding underneath is invisible
 * there — no interference with their own finely-tuned keyboard handling.
 */
export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const main = document.getElementById("app-scroll");
    if (!vv || !main) return;

    const apply = () => {
      // Height of the layout viewport the keyboard is occluding at the bottom.
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Ignore sub-threshold noise (URL bar show/hide, rubber-band) so we only
      // pad for a real keyboard.
      main.style.setProperty("--keyboard-inset", overlap > 120 ? `${Math.round(overlap)}px` : "0px");
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      main.style.removeProperty("--keyboard-inset");
    };
  }, []);

  return null;
}
