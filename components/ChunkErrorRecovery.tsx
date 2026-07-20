"use client";

import { useEffect } from "react";

/**
 * Auto-recover from a stale-deployment chunk/module load failure instead of
 * leaving someone stuck on a broken page mid-session.
 *
 * Every deploy replaces the previous build's content-hashed JS/CSS files. If a
 * tab (or an installed PWA that's been open a while) is still running an OLD
 * build and then tries to fetch a NEW chunk it hadn't loaded yet — a route it
 * hadn't visited, a dynamic import — that request can 404 against the new
 * deployment. Next.js throws a `ChunkLoadError` (or a "Loading chunk … failed"
 * / "Loading CSS chunk … failed" message) for this; webpack/Turbopack surface
 * it as either a thrown error (dynamic import) or an `<script>`/`<link>` load
 * failure, which the browser reports as a plain `error` event with no
 * message, not a catchable JS exception. This listens for both shapes and does
 * one hard reload — which re-fetches the current HTML shell (served
 * must-revalidate — see next.config.ts) and, via its fresh chunk URLs, the
 * matching current build.
 *
 * This does NOT help a failed *top-level navigation* (the browser/OS-level
 * "This page couldn't load" screen on opening the app) — that happens before
 * any of this code runs. It only helps an already-running session hitting a
 * stale sub-resource fetch.
 *
 * Loop-guarded via sessionStorage: if reloading doesn't actually fix it (e.g.
 * the app is genuinely down), we don't reload forever — one attempt per
 * 30 seconds.
 */

const RELOAD_GUARD_KEY = "mlr.chunkRecovery.lastReload";
const RELOAD_COOLDOWN_MS = 30_000;

function looksLikeChunkFailure(message: string | undefined | null, filename: string | undefined | null): boolean {
  const text = `${message ?? ""} ${filename ?? ""}`;
  return /ChunkLoadError|Loading (chunk|CSS chunk) .* failed|Failed to fetch dynamically imported module/i.test(text);
}

function recentlyReloaded(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    return Date.now() - last < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function reloadOnce() {
  if (recentlyReloaded()) return;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* ignore — worst case we reload more than once */
  }
  window.location.reload();
}

export function ChunkErrorRecovery() {
  useEffect(() => {
    // Thrown exceptions (dynamic import() failures) — Next/React surface these
    // via the global `error` event with a real Error object.
    const onError = (event: ErrorEvent) => {
      if (looksLikeChunkFailure(event.message, event.error?.stack)) reloadOnce();
    };
    // A <script>/<link> tag itself failing to load fires a plain `error` event
    // on that element (capture phase — it doesn't bubble), with no message.
    const onResourceError = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href;
      if (typeof src === "string" && /_next\/static\/(chunks|css)\//.test(src)) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === "string" ? reason : reason?.message;
      if (looksLikeChunkFailure(message, reason?.stack)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("error", onResourceError, true); // capture — resource errors don't bubble
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("error", onResourceError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
