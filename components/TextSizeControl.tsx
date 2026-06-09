"use client";

import { useEffect, useState } from "react";

// Base font size (px) applied to <html>. The whole app is rem/em-based, so this
// one knob scales every bit of text and spacing proportionally. 17 is the design
// default (see globals.css). Keep this list in sync with the boot script in
// app/layout.tsx that applies the saved choice before first paint.
export const TEXT_SCALE_KEY = "mlr-text-scale";
const SIZES = [
  { key: "normal", label: "Normal", sample: "text-base", px: 17 },
  { key: "large", label: "Larger", sample: "text-lg", px: 19 },
  { key: "largest", label: "Largest", sample: "text-xl", px: 21 },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

function applyScale(px: number) {
  if (typeof document !== "undefined") document.documentElement.style.fontSize = `${px}px`;
}

/**
 * Lets anyone bump the app's text size — a real help for older eyes, and a
 * gentler lever than browser zoom (which we also now allow). The choice is
 * remembered per device and re-applied before paint by the boot script in
 * layout, so there's no flash of small text on the next visit.
 */
export function TextSizeControl() {
  const [active, setActive] = useState<SizeKey>("normal");

  useEffect(() => {
    const saved = localStorage.getItem(TEXT_SCALE_KEY) as SizeKey | null;
    if (saved && SIZES.some((s) => s.key === saved)) setActive(saved);
  }, []);

  const pick = (s: (typeof SIZES)[number]) => {
    setActive(s.key);
    applyScale(s.px);
    try {
      localStorage.setItem(TEXT_SCALE_KEY, s.key);
    } catch {
      /* private mode / storage disabled — the live change still applies */
    }
  };

  return (
    <div
      role="group"
      aria-label="Text size"
      className="flex items-stretch gap-2 rounded-2xl bg-card p-2 ring-1 ring-border"
    >
      {SIZES.map((s) => {
        const on = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => pick(s)}
            aria-pressed={on}
            className={`press flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2.5 ${
              on ? "bg-primary text-white" : "text-foreground/70 hover:bg-primary/5"
            }`}
          >
            <span className={`font-bold leading-none ${s.sample}`}>A</span>
            <span className="text-[11px] font-medium leading-none">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
