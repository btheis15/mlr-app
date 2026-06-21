"use client";

import { requestInstall } from "@/lib/install";

/**
 * The "add it first, sign in once" reminder. Shown when a **guest taps Sign in
 * while in the browser** (NOT the installed Home-Screen app) on **iOS** —
 * IdentityProvider gates it to `isIos() && !isStandalone()` before mounting it.
 *
 * Why it exists: on iOS, Safari and the Home-Screen PWA keep **separate** logins
 * (the installed app gets its own storage). So a member who signs in here and
 * only *then* adds MLR to their Home Screen has to sign in a **second** time
 * inside the icon app. This catches that — add it first, sign in once.
 *
 * Why iOS-only: only iOS isolates the Home-Screen app's storage from the
 * browser's. Installed PWAs on Android / desktop Chrome reuse the browser's
 * session, so there's no double sign-in to warn about there.
 *
 * No one-tap "Add to Home Screen" on iOS — Apple ships no such web API — so the
 * button hands off to the same step-by-step walkthrough the first-run nag uses
 * (`requestInstall()` → InstallHint). The full steps stay one tap behind the
 * button instead of flooding this reminder. This is the same affordance the
 * Home/Profile/Help `InstallButton` uses, so it behaves the way people expect.
 */
export function InstallFirstNudge({
  onClose,
  onSignInAnyway,
}: {
  onClose: () => void;
  onSignInAnyway: () => void;
}) {
  // Close this sheet first so the walkthrough isn't stacked underneath it, then
  // ask InstallHint to run the install flow (the iOS Safari steps).
  const addToHomeScreen = () => {
    onClose();
    requestInstall();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-first-title"
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
    >
      {/* Scrim — tapping it just closes; the buttons are the real choices. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="scrim-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      {/* Panel: bottom sheet on phones, centred card on larger screens. Capped +
          scrollable so the largest text size on a small phone can't clip it. */}
      <div className="sheet-panel sm:pop-panel relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl ring-1 ring-border sm:rounded-3xl">
        <div className="overflow-y-auto px-6 pb-2 pt-7 text-center">
          <span className="mx-auto block text-5xl leading-none">📲</span>
          <h2
            id="install-first-title"
            className="mt-3 text-2xl font-bold tracking-tight"
          >
            Add MLR first — sign in once
          </h2>
          <p className="mx-auto mt-3 max-w-xs text-[15px] leading-snug text-foreground/70">
            The <b>MLR</b> app on your Home Screen keeps its <b>own</b> sign-in.
            Sign in here first and you&apos;ll have to sign in{" "}
            <b>again</b> after you add it.
          </p>
          <p className="mx-auto mt-2 max-w-xs text-[15px] leading-snug text-foreground/70">
            Add it to your Home Screen now and you only sign in <b>once</b>.
          </p>
        </div>

        {/* Sticky footer so the buttons are always reachable. */}
        <div className="border-t border-border bg-card px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
          <button
            onClick={addToHomeScreen}
            className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-base font-semibold text-white shadow-sm"
          >
            <span aria-hidden>📲</span> Add to Home Screen
          </button>
          <button
            onClick={onSignInAnyway}
            className="press mt-2 w-full rounded-2xl py-3 text-sm font-semibold text-foreground/65"
          >
            Sign in here anyway
          </button>
          <p className="mt-1 text-center text-xs text-foreground/45">
            We&apos;ll show you how — it takes a few seconds.
          </p>
        </div>
      </div>
    </div>
  );
}
