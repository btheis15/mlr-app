// Shared "fit the Home hero logo" measurement. The green MLR logo in the Home
// header (#app-logo) is a responsive hero: it grows so the marked
// [data-fit-anchor] card (the Ask-for-Help / People row) lands as the last
// fully-visible thing above the tab bar. The size depends on the live Home
// layout — which differs by login state (guest vs member show different cards),
// so the final height genuinely varies.
//
// This lives in one place because TWO callers must agree on it byte-for-byte:
//   • AppHeader — the live owner, fits on mount / beta-tile resolve / rotation.
//   • SplashIntro — locks the logo to its FINAL fitted size BEFORE measuring the
//     fly target, so the splash logo flies to the exact spot and doesn't "snap"
//     size/position after landing.

// brand-logo-green.png intrinsic ratio (1340×896) — caps the logo height by the
// width available, so an explicit height never makes it overflow / squish.
const LOGO_ASPECT = 1340 / 896;
// Breathing room below the last fully-visible card so the screen reads as "full"
// with that row last and the next section just past the fold.
const FIT_MARGIN = 12;
const MIN_LOGO = 64; // never shrink below the original h-16

/**
 * Recompute and apply #app-logo's height against the live Home layout, landing
 * the [data-fit-anchor] row's bottom FIT_MARGIN px above the tab bar (the fold).
 * Returns the target height it computed, or null when the pieces aren't on
 * screen (not Home / pre-mount) so callers can bail. anchorBottom moves 1:1 with
 * the logo height, so a single call lands it — call it again to confirm it's
 * stable (the layout above the anchor can still be settling).
 */
export function fitAppLogo(): number | null {
  const logo = document.getElementById("app-logo");
  if (!logo) return null;
  const anchor = document.querySelector("[data-fit-anchor]");
  const tabBar = document.querySelector("nav.fixed"); // the fixed TabBar
  if (!anchor || !tabBar) return null;

  const fold = tabBar.getBoundingClientRect().top;
  const anchorBottom = anchor.getBoundingClientRect().bottom;
  const current = logo.getBoundingClientRect().height;

  let next = current + (fold - anchorBottom) - FIT_MARGIN;
  const header = logo.closest("header");
  const avail = header?.clientWidth ?? window.innerWidth;
  next = Math.max(MIN_LOGO, Math.min(next, avail / LOGO_ASPECT));

  if (Math.abs(next - current) > 1) logo.style.height = `${next}px`;
  return next;
}

/**
 * Wait until #app-logo's height has stopped changing — i.e. AppHeader's fit has
 * settled on the final size for the resolved (guest vs member) layout — then run
 * `done`. **Observe-only**: it never sets the size (AppHeader owns that); it just
 * watches the value and waits for it to be final, so the splash flies to the
 * right spot and the logo doesn't snap after landing. Needs a couple of
 * consecutive unchanged frames to call it settled; bounded by `maxFrames` so it
 * always eventually fires.
 */
export function whenAppLogoStable(done: () => void, maxFrames = 30): void {
  const read = (): number | null => {
    const logo = document.getElementById("app-logo");
    return logo ? logo.getBoundingClientRect().height : null;
  };
  let last = read();
  let stableFrames = 0;
  let frames = 0;
  const step = () => {
    requestAnimationFrame(() => {
      const h = read();
      frames++;
      if (h == null) {
        done();
        return;
      }
      if (last != null && Math.abs(h - last) <= 1) stableFrames++;
      else stableFrames = 0;
      last = h;
      if (stableFrames >= 2 || frames >= maxFrames) {
        done();
        return;
      }
      step();
    });
  };
  step();
}
