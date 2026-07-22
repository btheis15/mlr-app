"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Count-up/down tween for a changing number (vote counts, dues totals, RSVP
 * tallies, unread badges). Pure requestAnimationFrame — no framer-motion needed.
 * `tabular-nums` keeps digits from jiggling horizontally as they change width.
 * Honors Reduce Motion (renders the target instantly). Matches the sibling
 * stock-game AnimatedNumber (450ms cubic ease-out).
 */
export function AnimatedNumber({
  value,
  duration = 450,
  format = (n) => String(Math.round(n)),
  className = "",
}: {
  value: number;
  duration?: number;
  /** Format the (fractional, mid-tween) display value. Round as you see fit. */
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    const from = fromRef.current;
    const to = value;
    if (reduce || from === to || duration <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = to; // if interrupted, next tween starts from here
    };
  }, [value, duration]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
