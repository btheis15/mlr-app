"use client";

// Custom pull-to-refresh for the iOS standalone PWA. Native PTR is disabled by
// design (`overscroll-behavior-y: none` on html/body keeps the fixed TabBar
// from bouncing — see globals.css), so this re-adds it by hand: drag down while
// the document scroller is at the top → a small forest-green indicator follows
// with ~0.4 resistance; release past ~70px (dampened) → one `location.reload()`
// (data hooks refetch on load; UpdateBanner handles new builds). Touch-only.
// Guards: skips when any dialog/sheet is open ([role="dialog"]), when the touch
// starts inside an element with its own vertical scroll (chat lists, sheet
// bodies), and axis-locks so CalloutStack's horizontal swipes never engage it.
// Mounted in app/template.tsx; renders via a portal to <body> so the
// `.page-enter` transform animation can't break its fixed positioning.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DAMPING = 0.4; // resistance on the raw drag
const THRESHOLD = 70; // dampened px that arm a refresh
const MAX_PULL = 104; // dampened travel cap
const LIFT = 46; // indicator starts this far above the top edge

type Phase = "idle" | "pulling" | "refreshing";

export function PullToRefresh() {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false); // gesture accepted as a vertical pull
  const dead = useRef(false); // gesture abandoned until next touchstart
  const reloaded = useRef(false); // reload exactly once
  const reduceMotion = useRef(false);

  useEffect(() => {
    setMounted(true);
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const scrollTop = () => document.scrollingElement?.scrollTop ?? 0;

    // True if the touch landed inside an element that scrolls vertically on its
    // own (sheet bodies, chat message lists) — those own the drag, not us.
    const inInnerScroller = (target: EventTarget | null) => {
      let el = target instanceof Element ? target : null;
      while (el && el !== document.body && el !== document.documentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return true;
        el = el.parentElement;
      }
      return false;
    };

    const show = (px: number) => {
      pullRef.current = px;
      setPull(px);
    };

    const reset = () => {
      engaged.current = false;
      start.current = null;
      setPhase("idle");
      show(0);
    };

    const onStart = (e: TouchEvent) => {
      dead.current = true;
      if (reloaded.current || e.touches.length !== 1) return;
      if (document.querySelector('[role="dialog"]')) return; // sheet/overlay open
      if (scrollTop() > 0) return;
      if (inInnerScroller(e.target)) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      dead.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (dead.current || !start.current) return;
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (!engaged.current) {
        // Axis lock: a horizontal-first drag (CalloutStack card swipe) bails.
        if (Math.abs(dx) > 10 && Math.abs(dx) > dy) { dead.current = true; return; }
        // The page took the gesture (scrolled down) — bail.
        if (dy < -4 || scrollTop() > 0) { dead.current = true; return; }
        // Engage only once clearly vertical, still pinned to the top.
        if (dy > 12 && dy > Math.abs(dx) * 1.5) {
          engaged.current = true;
          setPhase("pulling");
        } else return;
      }
      if (scrollTop() > 0) { dead.current = true; reset(); return; }
      show(Math.min(Math.max(dy, 0) * DAMPING, MAX_PULL));
    };

    const onEnd = (e: TouchEvent) => {
      if (!engaged.current) { start.current = null; return; }
      const armed = e.type === "touchend" && pullRef.current >= THRESHOLD;
      if (armed && !reloaded.current) {
        reloaded.current = true;
        setPhase("refreshing");
        show(THRESHOLD);
        // Let the spinner paint before the page starts unloading.
        requestAnimationFrame(() => requestAnimationFrame(() => location.reload()));
      } else {
        reset();
      }
    };

    // Passive on purpose: we never preventDefault — overscroll-behavior already
    // suppresses the native bounce, so tracking alone can't cause scroll jank.
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onEnd, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (!mounted) return null;

  const refreshing = phase === "refreshing";
  const progress = Math.min(pull / THRESHOLD, 1);
  // Reduce-motion: no travel/flip — the indicator just fades in at rest.
  const style: React.CSSProperties = reduceMotion.current
    ? { opacity: refreshing ? 1 : progress, transform: "translateY(10px)", transition: "opacity 0.2s" }
    : {
        opacity: refreshing ? 1 : Math.min(pull / (LIFT * 0.75), 1),
        transform: `translateY(${(refreshing ? THRESHOLD : pull) - LIFT}px)`,
        transition: phase === "pulling" ? "none" : "transform 0.2s ease, opacity 0.2s ease",
      };

  return createPortal(
    <div className="ptr" aria-hidden style={style}>
      <div className="ptr-circle">
        {refreshing ? (
          <svg className="ptr-spin" width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="33" strokeDashoffset="12" />
          </svg>
        ) : (
          <svg
            className="ptr-arrow"
            style={{ transform: progress >= 1 && !reduceMotion.current ? "rotate(180deg)" : undefined }}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M8 2.5v11m0 0 4.5-4.5M8 13.5 3.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>,
    document.body,
  );
}
