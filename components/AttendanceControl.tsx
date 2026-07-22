"use client";

import { useState } from "react";
import type { AttendanceStatus } from "@/lib/types";
import { Celebration } from "@/components/Celebration";
import { haptic } from "@/lib/haptics";

// The Facebook-style RSVP: a segmented control (Going / Maybe / Can't make).
// Presentational-ish — the parent decides what a tap does (write the RSVP, or
// prompt sign-in for a guest); this component just owns the tap's in-flight +
// failure UI so every RSVP surface (spotlight, list, sheet) gets it for free.
// The selected option fills with its solid color + white text; the rest stay
// quiet on white. All solid, LIGHT-MODE-safe colors (never a dark translucent
// surface tint — see globals.css transparency rule). `hideMaybe` drops the
// middle option for day-by-day planning (Family Fest), where the question is
// just which days you'll be there.

const OPTIONS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "going", label: "Going", on: "bg-primary text-white ring-primary" },
  { value: "maybe", label: "Maybe", on: "bg-sun text-white ring-sun" },
  { value: "not_going", label: "Can’t make", on: "bg-foreground text-white ring-foreground" },
];

export function AttendanceControl({
  value,
  onChange,
  size = "md",
  disabled = false,
  hideMaybe = false,
  className = "",
}: {
  value: AttendanceStatus | null;
  /** Write the RSVP. Return (or resolve to) `false` on failure and this
   *  control shows an inline retry message; anything else counts as success. */
  onChange: (status: AttendanceStatus) => void | boolean | Promise<void | boolean>;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Drop the "Maybe" option (Family Fest planning is Going / Can't make only). */
  hideMaybe?: boolean;
  className?: string;
}) {
  const pad = size === "sm" ? "py-1.5 text-xs" : "py-2.5 text-sm";
  const options = hideMaybe ? OPTIONS.filter((o) => o.value !== "maybe") : OPTIONS;
  // One control instance ⇒ one event, so this local state is inherently
  // per-event: while a tap is saving, further taps are ignored (buttons
  // disabled) instead of firing a second write; a failed one shows inline
  // rather than just quietly reverting on the next reload.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confetti when a member newly RSVPs "going" (not on a re-tap of the same
  // choice). A small delight moment on the app's most common happy action.
  const [celebrate, setCelebrate] = useState(false);

  const tap = async (status: AttendanceStatus) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const wasGoing = value === "going";
    try {
      const ok = await onChange(status);
      if (ok === false) {
        setError("Couldn't save — try again.");
      } else if (status === "going" && !wasGoing) {
        haptic("success");
        setCelebrate(true);
      } else {
        haptic("light");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      {celebrate && <Celebration onDone={() => setCelebrate(false)} />}
      <div className={`grid gap-2 ${hideMaybe ? "grid-cols-2" : "grid-cols-3"}`} role="group" aria-label="Your RSVP">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled || saving}
              aria-pressed={on}
              onClick={() => tap(o.value)}
              className={`press rounded-xl font-semibold ring-1 disabled:opacity-50 ${pad} ${
                on ? o.on : "bg-card text-foreground/60 ring-border"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 px-0.5 text-xs font-medium text-accent">{error}</p>}
    </div>
  );
}
