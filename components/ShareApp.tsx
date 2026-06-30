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

  // Rendered as a full-width card matching RowLink, so it sits in the
  // "App & help" group at the same size as the other rows.
  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share this app with family"
      className="press flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span aria-hidden className="shrink-0 text-2xl">{copied ? "✓" : "📤"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {copied ? "Link copied!" : "Share this app with family"}
        </p>
        <p className="mt-0.5 text-xs text-foreground/60">
          {copied ? "Paste it anywhere to invite someone." : "Send the link so anyone can join."}
        </p>
      </div>
      <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>
        ›
      </span>
    </button>
  );
}
