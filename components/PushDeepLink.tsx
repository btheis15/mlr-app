"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible. Routes a TAPPED push notification to its deep link.
 *
 * The service worker ([`public/sw.js`](public/sw.js)) tries
 * `WindowClient.navigate()` first, but that's unsupported (and rejects) in an
 * installed PWA — notably on iOS, which is exactly where most of the family
 * runs this app. That used to mean tapping a notification merely FOCUSED the
 * app on whatever page it was already showing and silently dropped the deep
 * link, so "Cass shared a new post" left you hunting the feed for the post by
 * hand. When navigate() isn't available the SW posts the url here instead and
 * we route with the app's own router — which always works, and stays a
 * client-side transition rather than a full reload.
 *
 * Routing through `router.push()` also means `useUrlParam` picks the new
 * `?post=` / `&m=` value up (history.pushState is patched to fire
 * `mlr:locationchange`, see lib/hooks.ts), so `useDeepLinkFlash` scrolls to and
 * flashes the item — the same behavior as tapping the row in the Activity tab.
 */
export function PushDeepLink() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== "mlr:navigate" || typeof data.url !== "string") return;
      // Never follow an absolute/cross-origin url out of the app — resolve it
      // against our own origin and keep only the in-app path.
      let path: string;
      try {
        const u = new URL(data.url, window.location.origin);
        if (u.origin !== window.location.origin) return;
        path = `${u.pathname}${u.search}${u.hash}`;
      } catch {
        return;
      }
      router.push(path);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
