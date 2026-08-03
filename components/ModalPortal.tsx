"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { isFamilyFestPath } from "@/lib/festPath";

/**
 * Portals a full-viewport overlay (pop-up / modal / lightbox / full-screen
 * viewer) to <body> so it ALWAYS sits over the whole app — the bottom TabBar
 * included.
 *
 * Why this is required, not cosmetic: route content is wrapped in `.page-enter`
 * (app/template.tsx), whose slide-in animation transforms that element. On iOS
 * Safari a once-transformed element stays the containing block AND stacking
 * context for its `position: fixed` descendants **permanently — even after the
 * animation ends** (the `backwards` fill removes the transform at rest, which
 * is why desktop is fine, but WebKit keeps the containing-block behavior). So an
 * overlay rendered inline inside a page gets (a) clipped to the page's box
 * instead of the viewport and (b) its z-index confined BELOW the fixed TabBar
 * (z-40, a root-level sibling of #app-scroll) — the tab bar paints on top and
 * its bottom controls are unreachable. Portaling to <body> escapes that subtree
 * entirely; this is the same fix the shared Sheet component uses.
 *
 * Re-applies the Family Fest theme class by route: portaling exits the
 * `.ff-section` subtree, which would otherwise drop an FF pop-up back to the
 * resort's forest-green palette — same pathname-based reapplication Sheet does.
 *
 * The overlay child keeps its own `fixed inset-0 z-[…]` root (use z ≥ 50 so it
 * clears the tab bar once it's in the root stacking context).
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  // Only mount after the first client tick (no `document` during SSR/prerender).
  // Overlays only ever open in response to an interaction, so this never affects
  // the static HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ff = isFamilyFestPath(usePathname());
  if (!mounted) return null;

  return createPortal(
    ff ? <div className="ff-section">{children}</div> : <>{children}</>,
    document.body,
  );
}
