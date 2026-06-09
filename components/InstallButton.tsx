"use client";

import { useEffect, useState } from "react";
import { isStandalone } from "@/lib/push";
import { requestInstall } from "@/lib/install";

/**
 * "Add to Home Screen" button. Asks `InstallHint` to run the install flow —
 * the native one-tap prompt on Android/desktop Chrome, the Safari walkthrough on
 * iOS. Hidden once the app is already installed (running standalone).
 *
 * This is the way back for the many people who tapped "Maybe later" on the
 * first-run nag, and the only install entry point Android users ever get.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  // Resolve standalone only after mount — `isStandalone()` is client-only and
  // would mismatch the prerendered HTML otherwise.
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    setInstalled(isStandalone());
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (installed !== false) return null; // null = pre-mount, true = already installed

  return (
    <button
      type="button"
      onClick={requestInstall}
      className={`press flex w-full items-center justify-center gap-2 rounded-2xl bg-card py-3 text-sm font-semibold text-primary ring-1 ring-primary/20 ${className}`}
    >
      <span aria-hidden>📲</span> Add MLR to your home screen
    </button>
  );
}
