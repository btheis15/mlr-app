"use client";

import { useState } from "react";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useEvents } from "@/lib/hooks";
import { EMPTY_SUMMARY, effectiveStatus } from "@/lib/events";
import { useIdentity } from "@/components/IdentityProvider";
import { AttendanceControl } from "@/components/AttendanceControl";
import { EventSheet } from "@/components/EventSheet";

// The Family Fest RSVP, surfaced near the top of the Family Fest hub: tap Going /
// Maybe / Can't make, optionally pick which days, and see who's coming (via the
// shared EventSheet). Scoped to the synthesized Family Fest event so it's the same
// attendance shown on Home and /events. Renders nothing until mounted/loaded.
const FEST_EVENT_ID = "family-fest-2026";

export function FestRsvp() {
  const { today } = useDemoDate();
  const { isAdmin } = useIdentity();
  const { events, summaries, mine, loading, setStatus } = useEvents();
  const [open, setOpen] = useState(false);

  if (!today || loading) return null;
  const event = events.find((e) => e.id === FEST_EVENT_ID);
  if (!event) return null;

  const m = mine[event.id] ?? null;
  const myStatus = m ? effectiveStatus(m.status, m.days) : null;
  const summary = summaries[event.id] ?? EMPTY_SUMMARY;
  const c = summary.counts;
  const counts = [
    c.going ? `${c.going} going` : null,
    c.maybe ? `${c.maybe} maybe` : null,
    c.notGoing ? `${c.notGoing} can’t make` : null,
  ].filter(Boolean);

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Are you coming to Family Fest?</p>
        <button onClick={() => setOpen(true)} className="press shrink-0 text-xs font-medium text-primary">
          Who&rsquo;s coming ›
        </button>
      </div>

      <AttendanceControl value={myStatus} onChange={(s) => setStatus(event.id, s)} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-foreground/55">
          {counts.length ? counts.join(" · ") : "No RSVPs yet — be the first"}
        </p>
        {event.dayRsvp && (
          <button onClick={() => setOpen(true)} className="press shrink-0 text-xs font-medium text-primary">
            Pick specific days ›
          </button>
        )}
      </div>

      {open && (
        <EventSheet
          event={event}
          summary={summary}
          mine={m}
          today={today}
          onSetStatus={(s, days) => setStatus(event.id, s, days)}
          onClose={() => setOpen(false)}
          isAdmin={isAdmin}
        />
      )}
    </section>
  );
}
