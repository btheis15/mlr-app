"use client";

import type { AttendanceStatus } from "@/lib/types";

// The Facebook-style RSVP: a segmented control (Going / Maybe / Can't make).
// Presentational only — the parent decides what a tap does (write the RSVP, or
// prompt sign-in for a guest). The selected option fills with its solid color +
// white text; the rest stay quiet on white. All solid, LIGHT-MODE-safe colors
// (never a dark translucent surface tint — see globals.css transparency rule).
// `hideMaybe` drops the middle option for day-by-day planning (Family Fest), where
// the question is just which days you'll be there.

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
  onChange: (status: AttendanceStatus) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Drop the "Maybe" option (Family Fest planning is Going / Can't make only). */
  hideMaybe?: boolean;
  className?: string;
}) {
  const pad = size === "sm" ? "py-1.5 text-xs" : "py-2.5 text-sm";
  const options = hideMaybe ? OPTIONS.filter((o) => o.value !== "maybe") : OPTIONS;
  return (
    <div
      className={`grid gap-2 ${hideMaybe ? "grid-cols-2" : "grid-cols-3"} ${className}`}
      role="group"
      aria-label="Your RSVP"
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`press rounded-xl font-semibold ring-1 disabled:opacity-50 ${pad} ${
              on ? o.on : "bg-card text-foreground/60 ring-border"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
