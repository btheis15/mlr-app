"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PWA "a newer version is out" nudge.
 *
 * Web apps — especially an iOS Home-Screen PWA — keep running the version they
 * launched with until they're fully closed and reopened, so people sit on a
 * stale build without knowing ("I don't see the new feature"). This detects a
 * fresh deploy and offers a one-tap refresh that reloads *without* the manual
 * close/reopen.
 *
 * How it knows: `NEXT_PUBLIC_BUILD_ID` is baked into this bundle at build time,
 * and the same value is published as /version.json (see next.config.ts). We poll
 * that file; if it differs from the running id, a newer build has shipped.
 */

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const POLL_MS = 5 * 60 * 1000; // gentle background check

async function fetchLatest(): Promise<string | null> {
  try {
    // no-store + unique query so neither the browser nor a CDN serves a cached
    // copy — we always want the truly-latest version.json.
    const res = await fetch(`${BASE}/version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function hardReload() {
  // The SW doesn't cache (public/sw.js), but clear any Cache Storage anyway so a
  // future caching layer can't strand people. Then a real navigation refetches
  // the shell (served must-revalidate), updating the standalone PWA in place.
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const dismissed = useRef(false);

  const check = useCallback(async () => {
    if (!CURRENT || dismissed.current) return;
    const latest = await fetchLatest();
    if (latest && latest !== CURRENT) setStale(true);
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    // Re-check when the app is brought back to the foreground — the most common
    // moment someone's been sitting on an old build.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const id = window.setInterval(check, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.clearInterval(id);
    };
  }, [check]);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm text-white shadow-sm"
    >
      <span aria-hidden className="text-base leading-none">↻</span>
      <span className="min-w-0 flex-1 font-medium">A new version of the app is available.</span>
      <button
        type="button"
        onClick={hardReload}
        className="press shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold ring-1 ring-white/40"
      >
        Refresh
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          dismissed.current = true;
          setStale(false);
        }}
        className="press shrink-0 rounded-full px-1.5 text-white/80"
      >
        ✕
      </button>
    </div>
  );
}
