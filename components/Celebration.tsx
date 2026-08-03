"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import { ModalPortal } from "@/components/ModalPortal";

// Northwoods accent tokens — the confetti wears the resort palette (richer on P3
// via the globals.css @supports layer).
const COLORS = [
  "var(--color-primary)",
  "var(--color-accent)",
  "var(--color-lake)",
  "var(--color-sun)",
  "var(--color-dusk)",
  "var(--color-fest)",
];

/**
 * A one-shot confetti burst for a delightful moment (RSVP "going", a poll vote,
 * an Ask-for-Help request getting "covered", dues paid). Mount it when the moment
 * happens; it calls `onDone` when finished so the parent can unmount it:
 *
 *   {celebrate && <Celebration onDone={() => setCelebrate(false)} />}
 *
 * Fixed, click-through overlay. Deterministic piece layout (index hash, no
 * Math.random) so it's SSR/hydration-safe. Respects Reduce Motion — renders
 * nothing and resolves immediately.
 */
export function Celebration({ onDone, count = 26 }: { onDone?: () => void; count?: number }) {
  const reduce =
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

  const pieces = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const h1 = (((i + 1) * 2654435761) >>> 0) % 1000 / 1000;
      const h2 = (((i + 1) * 40503) >>> 0) % 1000 / 1000;
      const angle = (i / count) * Math.PI * 2 + h1 * 0.7;
      const dist = 90 + h2 * 150;
      return {
        dx: Math.round(Math.cos(angle) * dist),
        dy: Math.round(Math.sin(angle) * dist + 70), // gravity bias
        rot: Math.round((h1 - 0.5) * 720),
        color: COLORS[i % COLORS.length],
        size: 6 + Math.round(h2 * 6),
        delay: +(h2 * 0.06).toFixed(3),
        dur: +(1.1 + h1 * 0.8).toFixed(2),
        round: i % 3 === 0,
      };
    });
  }, [count]);

  useEffect(() => {
    if (reduce) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => onDone?.(), 2000);
    return () => clearTimeout(t);
  }, [reduce, onDone]);

  if (reduce) return null;

  return (
    <ModalPortal>
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center" aria-hidden>
      <div className="relative">
        {pieces.map((p, i) => (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: p.dx, y: p.dy, opacity: 0, rotate: p.rot, scale: 1 }}
            transition={{ duration: p.dur, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: "absolute",
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.round ? "9999px" : "2px",
            }}
          />
        ))}
      </div>
    </div>
    </ModalPortal>
  );
}
