"use client";

import { useEffect, useState } from "react";

/**
 * iOS "Add to Home Screen" nudge. Shows a one-time dismissible banner on
 * mobile Safari (which has no beforeinstallprompt event), so the PWA can be
 * installed to the home screen. Dismissal is remembered in localStorage.
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
      <div className="mt-2 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm shadow-lg ring-1 ring-border">
        <span className="text-base">📲</span>
        <p className="flex-1 text-foreground/80">
          Install: tap <span className="font-semibold">Share</span> then{" "}
          <span className="font-semibold">Add to Home Screen</span>.
        </p>
        <button
          onClick={() => {
            localStorage.setItem("install-hint-dismissed", "1");
            setShow(false);
          }}
          className="rounded-full px-2 py-1 text-foreground/50 hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
