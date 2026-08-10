"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSheetDismiss } from "@/lib/hooks";
import { ModalPortal } from "@/components/ModalPortal";
import { mediaSrc } from "@/lib/mediaToken";

/**
 * Full-screen photo viewer — tap a photo to see the whole, uncropped image.
 * Plays an open animation on mount and a matching close animation on
 * tap/scrim/Escape, then calls `onClose` (honoring reduced-motion). Mount it
 * only when there's a url, and **key it by url** so a new photo remounts with a
 * fresh open animation (which also cancels any in-flight close):
 *
 *   {photo && <Lightbox key={photo} url={photo} onClose={() => setPhoto(null)} />}
 *
 * Pass `photos` — every photo in the same group (a post's media, a chat
 * message's attachments, a work item's) — to make it a **swipeable carousel**
 * starting at `url`, so you can move through the rest without closing and
 * reopening. With one photo (or none passed) it renders exactly as before.
 * Videos must NOT be in `photos`: they play inline in the grid and would
 * render as a broken <img> here — pass only the image urls.
 *
 * `z` overrides the stacking layer for surfaces that already sit high (the
 * full-screen chat shell passes "z-[55]").
 */
export function Lightbox({
  url,
  photos,
  onClose,
  z = "z-50",
}: {
  url: string;
  photos?: string[];
  onClose: () => void;
  z?: string;
}) {
  const { closing, close } = useSheetDismiss(onClose); // also wires Escape
  const list = photos && photos.length > 1 ? photos : null;
  const startIndex = list ? Math.max(0, list.indexOf(url)) : 0;

  if (!list) {
    return (
      <ModalPortal>
      <div
        className={`fixed inset-0 ${z} flex items-center justify-center bg-black/90 p-4 ${closing ? "scrim-out pointer-events-none" : "scrim-in"}`}
        onClick={close}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={close}
          className="press absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white"
          aria-label="Close photo"
        >
          ×
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaSrc(url)}
          alt=""
          className={`max-h-full max-w-full object-contain ${closing ? "pop-close" : "pop-panel"}`}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      </ModalPortal>
    );
  }

  return (
    <ModalPortal>
      <PhotoCarousel photos={list} startIndex={startIndex} closing={closing} close={close} z={z} />
    </ModalPortal>
  );
}

// Swipe between every photo in the group — native scroll-snap (the same
// mechanism as the Drop Box's FolderCarousel), plus edge arrows and ←/→ on
// desktop. No `pop-panel` here: it animates a transform, which fights the
// scroller's initial scrollLeft positioning, so the scrim fade carries the open.
function PhotoCarousel({
  photos,
  startIndex,
  closing,
  close,
  z,
}: {
  photos: string[];
  startIndex: number;
  closing: boolean;
  close: () => void;
  z: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didInit = useRef(false);
  const [active, setActive] = useState(startIndex);
  // Distinguish a tap-to-dismiss from the tail of a swipe: a scroll-snap drag
  // can still fire a click, which would close the viewer mid-swipe.
  const down = useRef({ x: 0, y: 0 });

  // Open on the tapped photo — via a CALLBACK REF so it fires when the scroller
  // actually attaches. ModalPortal mounts its children one tick late, so a
  // mount effect ran with scrollerRef still null and never re-ran, opening the
  // viewer on the first photo instead of the tapped one.
  const attachScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      if (el && !didInit.current) {
        didInit.current = true;
        el.scrollLeft = startIndex * el.clientWidth;
      }
    },
    [startIndex],
  );

  const step = (dir: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Read the live position rather than the closure-captured `active`, so the
    // once-registered keydown handler always steps from where we actually are.
    const cur = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    const next = Math.max(0, Math.min(photos.length - 1, cur + dir));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  // ←/→ step. Escape is already handled by useSheetDismiss in the parent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 ${z} flex flex-col bg-black/90 ${closing ? "scrim-out pointer-events-none" : "scrim-in"}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button
          onClick={close}
          className="press flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white"
          aria-label="Close photo"
        >
          ×
        </button>
        <span className="text-sm font-medium tabular-nums">
          {active + 1} / {photos.length}
        </span>
        {/* Balances the ✕ so the counter stays centered. */}
        <span className="h-10 w-10" aria-hidden="true" />
      </div>

      <div
        ref={attachScroller}
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onClick={(e) => {
          // Tapping the photo itself never closes, matching the single-photo
          // viewer above; only the backdrop around it does.
          if ((e.target as HTMLElement).tagName === "IMG") return;
          // And only a real tap — a scroll-snap swipe can still fire a click,
          // which would otherwise dismiss the viewer mid-swipe.
          if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 10) close();
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain"
      >
        {photos.map((p, i) => (
          <div key={`${p}-${i}`} className="flex w-full shrink-0 snap-center items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaSrc(p)} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>

      {/* Edge arrows (mainly desktop; swipe is primary on touch). */}
      <button
        aria-label="Previous photo"
        onClick={() => step(-1)}
        className="press absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 px-3 py-4 text-white sm:block"
      >
        ‹
      </button>
      <button
        aria-label="Next photo"
        onClick={() => step(1)}
        className="press absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 px-3 py-4 text-white sm:block"
      >
        ›
      </button>
    </div>
  );
}
