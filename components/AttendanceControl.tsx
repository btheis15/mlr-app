"use client";

import type { AttendanceStatus } from "@/lib/types";

// The Facebook-style RSVP: a 3-way segmented control (Going / Maybe / Can't make).
// Presentational only — the parent decides what a tap does (write the RSVP, or
// prompt sign-in for a guest). The selected option fills with its solid color +
// white text; the rest stay quiet on white. All solid, LIGHT-MODE-safe colors
// (never a dark translucent surface tint — see globals.css transparency rule).

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
  className = "",
}: {
  value: AttendanceStatus | null;
  onChange: (status: AttendanceStatus) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const pad = size === "sm" ? "py-1.5 text-xs" : "py-2.5 text-sm";
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`} role="group" aria-label="Your RSVP">
      {OPTIONS.map((o) => {
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
