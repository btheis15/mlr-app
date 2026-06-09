"use client";

import { useSheetDismiss } from "@/lib/hooks";

/**
 * Full-screen photo viewer — tap a photo to see the whole, uncropped image.
 * Plays an open animation on mount and a matching close animation on
 * tap/scrim/Escape, then calls `onClose` (honoring reduced-motion). Mount it
 * only when there's a url, and **key it by url** so a new photo remounts with a
 * fresh open animation (which also cancels any in-flight close):
 *
 *   {photo && <Lightbox key={photo} url={photo} onClose={() => setPhoto(null)} />}
 *
 * `z` overrides the stacking layer for surfaces that already sit high (the
 * full-screen chat shell passes "z-[55]").
 */
export function Lightbox({ url, onClose, z = "z-50" }: { url: string; onClose: () => void; z?: string }) {
  const { closing, close } = useSheetDismiss(onClose);

  return (
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/90 p-4 ${closing ? "scrim-out" : "scrim-in"}`}
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
        src={url}
        alt=""
        className={`max-h-full max-w-full object-contain ${closing ? "pop-close" : "pop-panel"}`}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
