"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * The single global framer-motion config, mounted once in app/layout.tsx.
 * `reducedMotion="user"` makes every `motion.*` component in the tree honor the
 * OS "Reduce Motion" setting automatically — the JS-spring twin of the CSS
 * `@media (prefers-reduced-motion: reduce)` guard in globals.css, so both layers
 * degrade together. This is the only global motion config; everything else is
 * per-component (see the ARCHITECTURE.json motionKitToPort section).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
