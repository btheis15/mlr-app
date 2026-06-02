"use client";

import { useState } from "react";

// A small "share this app" affordance for the home page. On phones it opens the
// native share sheet (Messages / Mail / AirDrop); on desktop (or anywhere the
// Web Share API is missing) it copies the link instead. The shared URL is the
// current origin, so it always points at whichever live deploy the person is
// actually using — no stale hardcoded link.
export function ShareApp() {
  const [copied, setCopied] = useState(false);

  const appUrl = () =>
    typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";

  const share = async () => {
    const url = appUrl();
    const data = {
      title: "Muskellunge Lake Resort",
      text: "Join us on the Muskellunge Lake Resort app — schedule, photos, dining, and Family Fest. Open this link and add it to your home screen:",
      url,
    };

    // Native share sheet (iOS Safari, Android Chrome, some desktop browsers).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        // User dismissed the share sheet — do nothing (don't also copy).
        if (err instanceof Error && err.name === "AbortError") return;
        // Any other failure falls through to the copy path below.
      }
    }

    // Fallback: copy the link to the clipboard.
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort (no clipboard access): surface the URL to copy by hand.
      if (typeof window !== "undefined") window.prompt("Copy this link to share the app:", url);
    }
  };

  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={share}
        aria-label="Share this app with others"
        className="press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/15"
      >
        <span aria-hidden>{copied ? "✓" : "📤"}</span>
        {copied ? "Link copied — paste it anywhere" : "Share this app with family"}
      </button>
    </div>
  );
}
