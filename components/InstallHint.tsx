"use client";

import { useEffect, useState } from "react";

/**
 * iOS "Add to Home Screen" nudge. Shows a one-time dismissible card on mobile
 * Safari (which has no beforeinstallprompt event) explaining — in plain terms —
 * how to install the app to the home screen so it opens full-screen like a real
 * app. Written to be obvious for less app-savvy folks. Dismissal is remembered.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    // `standalone` only exists on iOS Safari; true when already installed.
    const standalone =
      "standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem("install-hint-dismissed") === "1";
    if (isIos && !standalone && !dismissed) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-md px-4 pt-[env(safe-area-inset-top)]">
      <div className="mt-2 rounded-2xl bg-card p-4 shadow-lg ring-1 ring-border">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none">📲</span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Add this to your phone</p>
            <p className="mt-0.5 text-sm text-foreground/70">
              So it opens full-screen like a real app — no hunting for a link.
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem("install-hint-dismissed", "1");
              setShow(false);
            }}
            className="-mr-1 -mt-1 rounded-full px-2 py-1 text-foreground/50 hover:text-foreground"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        <ol className="mt-3 space-y-1.5 text-sm text-foreground/80">
          <li className="flex items-center gap-2">
            <Step n="1" />
            <span>
              Tap the <span className="font-semibold">Share</span> button
              <span className="mx-1 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">
                ↑
              </span>
              at the bottom of Safari
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Step n="2" />
            <span>
              Choose <span className="font-semibold">Add to Home Screen</span>
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}

function Step({ n }: { n: string }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
      {n}
    </span>
  );
}
