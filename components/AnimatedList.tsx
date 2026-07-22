"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * FLIP re-ordering for ranked lists: a row glides to its new slot on a
 * sort/rank change instead of teleporting. Wrap each list item in an
 * <AnimatedRow key={stableId}> — the key must be a STABLE identity (not the
 * index) so framer can track a row across reorders.
 *
 * `layout="position"` animates position only (not size), GPU-transform based —
 * the RangeTabs/leaderboard spring (500/40) from the sibling stock-game app.
 * Pass `animate={false}` on any path that re-renders every frame from a gesture
 * (e.g. a live drag) so rows snap with the finger instead of springing behind.
 * Honors Reduce Motion via MotionProvider's global reducedMotion="user".
 */
export function AnimatedRow({
  children,
  className = "",
  animate = true,
}: {
  children: ReactNode;
  className?: string;
  animate?: boolean;
}) {
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <motion.div
      layout="position"
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
