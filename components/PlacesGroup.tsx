"use client";

import { useState, type ReactNode } from "react";
import type { PlaceAccent } from "@/lib/places";
import { haptic } from "@/lib/haptics";

// Literal class strings (not interpolated) so Tailwind's scanner emits them.
const CHIP: Record<PlaceAccent, string> = {
  primary: "bg-primary/12 text-primary",
  lake: "bg-lake/12 text-lake",
  campfire: "bg-campfire/12 text-campfire",
  sun: "bg-sun/12 text-sun",
  dusk: "bg-dusk/12 text-dusk",
};

/**
 * A collapsible group of Local Places cards. Full-card header: an accent-tinted
 * icon chip, the group title, a "N places" count, and a chevron.
 *
 * CONTROLLED (useState + a real <button>), not a native <details>/<summary>.
 * Native <details> on iOS has a two-tap-to-open quirk (the first tap is eaten by
 * the hover/gesture pass, so it "did nothing"); a button's onClick fires on the
 * first tap, and `.press` (touch-action: manipulation) rules out the residual
 * double-tap-zoom delay. Reveal uses the app's grid-rows 0fr→1fr technique so it
 * animates to content height; children stay mounted (toggled inert), matching
 * the shared CollapsibleSection. Renders nothing when the group is empty.
 */
export function PlacesGroup({
  title,
  emoji,
  accent,
  count,
  children,
}: {
  title: string;
  emoji: string;
  accent: PlaceAccent;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="press flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border"
      >
        <span
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${CHIP[accent]}`}
          aria-hidden
        >
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {count} {count === 1 ? "place" : "places"}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            inert={!open}
            className={`min-h-0 space-y-2 pt-2 transition-opacity duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
