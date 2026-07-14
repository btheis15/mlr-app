"use client";

import type { CabinRoomAvailability } from "@/lib/types";

/**
 * Shared room/area picker for a cabin that's been broken into named rooms
 * (migration 0092) — a checklist of rooms with live availability for the
 * chosen date range, letting someone pick exactly which spot(s) they want
 * (so two solo travelers can tell if they'd be sharing a room) instead of
 * just a bare guest count. Used by both CabinRequestSheet (new bookings) and
 * the admin's per-booking room editor.
 */
export function CabinRoomPicker({
  rooms,
  selected,
  onToggle,
  loading,
}: {
  rooms: CabinRoomAvailability[];
  selected: Set<string>;
  onToggle: (roomId: string) => void;
  loading?: boolean;
}) {
  if (loading) {
    return <p className="rounded-xl bg-background px-3 py-2.5 text-xs text-faint ring-1 ring-border">Checking room availability…</p>;
  }
  if (rooms.length === 0) {
    return <p className="rounded-xl bg-background px-3 py-2.5 text-xs text-faint ring-1 ring-border">No rooms to show.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rooms.map((r) => {
        const on = selected.has(r.roomId);
        const disabled = !r.available && !on;
        const status = !r.active ? "Temporarily closed" : !r.available ? "Already booked" : null;
        return (
          <button
            key={r.roomId}
            type="button"
            onClick={() => onToggle(r.roomId)}
            disabled={disabled}
            aria-pressed={on}
            className={`press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
              on
                ? "bg-primary/10 ring-primary/40"
                : disabled
                  ? "bg-background/50 text-foreground/40 ring-border"
                  : "bg-background ring-border hover:ring-primary/30"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] leading-none ${
                on ? "border-primary bg-primary text-white" : "border-border"
              }`}
              aria-hidden
            >
              {on ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{r.name}</span>
              <span className="block text-xs text-muted">
                🛏️ {r.beds} bed{r.beds === 1 ? "" : "s"}
                {status && <span className={disabled ? "text-accent" : "text-muted"}> · {status}</span>}
              </span>
              {r.description?.trim() && <span className="mt-0.5 block text-xs text-faint">{r.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
