"use client";

import { useEffect, useRef, useState } from "react";

// Drag to position + zoom a picked photo inside a circular frame, then export
// a square 512×512 JPEG. The square's inscribed circle is exactly what shows
// as the round avatar (Avatar uses object-cover), so it's WYSIWYG.
const VIEW = 288; // on-screen viewport size (px)
const OUT = 512; // exported image size (px)

export function AvatarCropper({
  file,
  onCancel,
  onSave,
}: {
  file: File;
  onCancel: () => void;
  onSave: (out: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const urlRef = useRef("");
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const reduceMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finish = (fn: () => void) => {
    if (reduceMotion()) return fn();
    setClosing(true);
    timer.current = setTimeout(fn, 440);
  };

  useEffect(() => {
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseCover = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const k = baseCover * zoom; // displayed px per source px
  const dw = img ? img.naturalWidth * k : VIEW;
  const dh = img ? img.naturalHeight * k : VIEW;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(VIEW - dw, x)),
    y: Math.min(0, Math.max(VIEW - dh, y)),
  });

  // Center on load; keep covered when zoom changes.
  useEffect(() => {
    if (img) {
      setTx((VIEW - dw) / 2);
      setTy((VIEW - dh) / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);
  useEffect(() => {
    setTx((x) => clamp(x, ty).x);
    setTy((y) => clamp(tx, y).y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const c = clamp(drag.current.tx + (e.clientX - drag.current.x), drag.current.ty + (e.clientY - drag.current.y));
    setTx(c.x);
    setTy(c.y);
  };
  const onUp = () => {
    drag.current = null;
  };

  const save = async () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sSize = VIEW / k; // source px shown across the viewport
    ctx.drawImage(img, -tx / k, -ty / k, sSize, sSize, 0, 0, OUT, OUT);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob) finish(() => onSave(new File([blob], "avatar.jpg", { type: "image/jpeg" })));
  };

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 ${closing ? "scrim-out" : "scrim-in"}`} role="dialog" aria-modal="true">
      <div className={`w-full max-w-sm space-y-4 rounded-3xl bg-background p-5 ring-1 ring-border ${closing ? "pop-close" : "pop-panel"}`}>
        <p className="text-center text-sm font-semibold">Position your photo</p>
        <div
          className="relative mx-auto cursor-grab overflow-hidden rounded-2xl bg-black/10 active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW, touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urlRef.current}
              alt=""
              draggable={false}
              style={{ width: dw, height: dh, transform: `translate(${tx}px, ${ty}px)`, transformOrigin: "0 0", maxWidth: "none" }}
            />
          )}
          {/* Circular guide: darken the corners outside the round avatar area. */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/70" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground/60">
          <span>Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[var(--color-primary)]" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => finish(onCancel)} className="press rounded-full px-4 py-2 text-sm font-medium text-foreground/55">Cancel</button>
          <button type="button" onClick={save} className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white">Use photo</button>
        </div>
      </div>
    </div>
  );
}
