"use client";

import { useEffect, useState } from "react";
import { fetchEvents } from "@/lib/events";
import type { ResortEvent } from "@/lib/types";

export interface EventTarget {
  eventId: string | null;
  excludeNotAttending: boolean;
}

/**
 * Shared "link this to an event" control for the admin broadcast tools
 * (callouts, the banner, notifications) — an optional event picker plus an
 * "only show to people attending" checkbox, defaulted ON the moment an event
 * is picked (see lib/eventTargeting.ts for the exact rule: it hides this only
 * from someone who explicitly RSVP'd "Can't make it", never a no-response).
 */
export function EventTargetPicker({ value, onChange }: { value: EventTarget; onChange: (v: EventTarget) => void }) {
  const [events, setEvents] = useState<ResortEvent[]>([]);

  useEffect(() => {
    fetchEvents().then(setEvents);
  }, []);

  const onPickEvent = (id: string) => {
    if (!id) {
      onChange({ eventId: null, excludeNotAttending: value.excludeNotAttending });
      return;
    }
    // Picking an event fresh (there wasn't one before) defaults the checkbox
    // on; switching between two events keeps whatever the admin already chose.
    onChange({ eventId: id, excludeNotAttending: value.eventId ? value.excludeNotAttending : true });
  };

  return (
    <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground/70">Link to an event (optional)</span>
        <select
          value={value.eventId ?? ""}
          onChange={(e) => onPickEvent(e.target.value)}
          className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">No specific event</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.title}</option>
          ))}
        </select>
      </label>
      {value.eventId && (
        <label className="flex items-center gap-2 text-xs text-foreground/70">
          <input
            type="checkbox"
            checked={value.excludeNotAttending}
            onChange={(e) => onChange({ ...value, excludeNotAttending: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          Don&rsquo;t show to people who RSVP&rsquo;d &ldquo;Can&rsquo;t make it&rdquo;
        </label>
      )}
    </div>
  );
}
