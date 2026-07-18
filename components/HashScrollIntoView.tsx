"use client";

import { useEffect } from "react";

/**
 * Scrolls the element named by the URL hash (`/path#some-id`) into view within
 * the app's single scroll container (`#app-scroll`). The app disables native
 * document scrolling (html/body `overflow: hidden`), and `ScrollReset` snaps
 * `#app-scroll` to the top on every navigation — so a bare `#hash` link won't
 * land on its target on its own. This runs on a `requestAnimationFrame` (after
 * mount effects, so after `ScrollReset` and once the target is laid out) and
 * also on `hashchange`, so deep-links like the desktop SideNav's admin
 * shortcuts (`/admin/alerts#home-callouts`) reliably land on their section.
 *
 * Renders nothing — a pure side effect. Mount it inside the page content (past
 * any auth gate) so the target actually exists when it runs.
 */
export function HashScrollIntoView() {
  useEffect(() => {
    const scrollToHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);
  return null;
}
