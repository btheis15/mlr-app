"use client";

import { useEffect, useState } from "react";
import { isIos, isStandalone } from "@/lib/push";

/**
 * iOS "Add to Home Screen" walkthrough. Mobile Safari has no
 * `beforeinstallprompt` event, so we can't trigger the install — we can only
 * teach. This shows a near-full-screen, scrim-backed takeover the FIRST time a
 * non-savvy visitor opens the site in Safari, walking them through every real
 * tap including the easy-to-miss "View More" step Apple hides the
 * "Add to Home Screen" row behind.
 *
 * Deliberately hard to dismiss by accident (the whole point — folks kept
 * tapping away and never finding it again):
 *   - tapping the scrim does NOT close it
 *   - there's no tiny ✕; you must tap a clear, labelled button
 *   - "Maybe later" only hides it for this visit and it returns next launch,
 *     so an accidental dismissal is self-healing. Only "Got it — done!"
 *     remembers the dismissal for good.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Reuse the shared detection in lib/push so the iPadOS-13+ "Macintosh UA"
    // case is covered here too — otherwise this banner never shows on iPad Safari
    // and iPad users get no nudge to install (a prerequisite for push on iOS).
    const dismissed = localStorage.getItem("install-hint-dismissed") === "1";
    if (isIos() && !isStandalone() && !dismissed) setShow(true);
  }, []);

  if (!show) return null;

  // Permanent: they told us they finished.
  const dismissForGood = () => {
    localStorage.setItem("install-hint-dismissed", "1");
    setShow(false);
  };
  // Temporary: hide for now, but show again next launch (accidental-tap proof).
  const remindLater = () => setShow(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-hint-title"
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
    >
      {/* Scrim — intentionally NOT click-to-close. */}
      <div className="scrim-in absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel: bottom sheet on phones, centred card on larger screens. */}
      <div className="sheet-panel sm:pop-panel relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl ring-1 ring-border sm:rounded-3xl">
        <div className="overflow-y-auto px-6 pb-2 pt-7">
          <div className="text-center">
            <span className="mx-auto block text-5xl leading-none">📲</span>
            <h2
              id="install-hint-title"
              className="mt-3 text-2xl font-bold tracking-tight"
            >
              Add MLR to your Home Screen
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-[15px] leading-snug text-foreground/70">
              Add it to your home screen to get the full experience:
            </p>
          </div>

          <ul className="mt-5 space-y-3">
            <Benefit icon="🏠" title="One tap to open">
              An <b>MLR</b> icon lands on your home screen and opens full-screen
              like a real app — no more hunting through Safari for the link.
            </Benefit>
            <Benefit icon="🔔" title="Get push notifications">
              Be the first to know — event reminders, announcements, and your
              cabin-request updates land right on your phone.
            </Benefit>
            <Benefit icon="⚡" title="Fast &amp; always signed in">
              It loads instantly every time and keeps you logged in, so you
              never have to fish for the link or sign in again.
            </Benefit>
          </ul>

          <p className="mt-6 text-center text-sm font-semibold text-foreground/80">
            Here&apos;s how — it takes a few seconds:
          </p>

          <ol className="mt-3 space-y-4">
            <Step n="1">
              Tap the <b>Share</b> button{" "}
              <Chip>
                <ShareGlyph />
              </Chip>{" "}
              at the bottom of Safari.
            </Step>

            <Step n="2">
              Don&apos;t see <b>Add to Home Screen</b>? Tap{" "}
              <Chip>
                View More <span className="text-base leading-none">⌄</span>
              </Chip>{" "}
              to reveal the full list.
            </Step>

            <Step n="3">
              Tap{" "}
              <Chip>
                <span className="text-base leading-none">⊕</span> Add to Home
                Screen
              </Chip>
            </Step>

            <Step n="4">
              Tap the blue <b>Add</b>{" "}button in the top-right corner.
              That&apos;s it — look for the <b>MLR</b> icon on your home screen!
            </Step>
          </ol>
        </div>

        {/* Sticky footer so the buttons are always reachable. */}
        <div className="border-t border-border bg-card px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
          <button
            onClick={dismissForGood}
            className="press w-full rounded-2xl bg-primary py-3.5 text-base font-semibold text-white shadow-sm"
          >
            Got it — done!
          </button>
          <button
            onClick={remindLater}
            className="press mt-2 w-full rounded-2xl py-2.5 text-sm font-medium text-foreground/60"
          >
            Maybe later
          </button>
        </div>
      </div>

      {/* Arrow pointing down to Safari's real Share toolbar — only useful as a
          bottom sheet, so phones only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center sm:hidden"
      >
        <span className="animate-bounce text-2xl text-white/80 drop-shadow motion-reduce:animate-none">
          ↓
        </span>
      </div>
    </div>
  );
}

function Benefit({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-xl leading-none">{icon}</span>
      <p className="text-[15px] leading-snug text-foreground/85">
        <b className="font-semibold">{title}</b> —{" "}
        <span className="text-foreground/70">{children}</span>
      </p>
    </li>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
        {n}
      </span>
      <p className="text-[15px] leading-relaxed text-foreground/85">{children}</p>
    </li>
  );
}

/** Inline "button" pill that mimics the iOS share-sheet control being named. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-middle text-[13px] font-semibold text-primary">
      {children}
    </span>
  );
}

/** The iOS Share glyph: a box with an up-arrow. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </svg>
  );
}
