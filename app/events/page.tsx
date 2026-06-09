"use client";

import { useState } from "react";
import { BackLink } from "@/components/BackLink";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { SkeletonList } from "@/components/Skeleton";
import { EventCard } from "@/components/EventCard";
import { EventSheet } from "@/components/EventSheet";
import { EventComposer } from "@/components/EventComposer";
import { useIdentity } from "@/components/IdentityProvider";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useEvents } from "@/lib/hooks";
import { EMPTY_SUMMARY, effectiveStatus, pastEvents, upcomingEvents } from "@/lib/events";
import type { AttendanceStatus, ResortEvent } from "@/lib/types";

// The full resort calendar: every upcoming gathering with a Going/Maybe/Can't-make
// RSVP and a tap-through to who's coming, plus past events. Admins create + edit
// events here ("+ New event"). Counts stay live via the events + event_attendance
// Realtime subscriptions in useEvents. Degrades to a read-only preview with no
// backend (same idiom as /request-stay).

type Composer = { mode: "new" } | { mode: "edit"; event: ResortEvent } | null;

export default function EventsPage() {
  const { today } = useDemoDate();
  const { isAdmin } = useIdentity();
  const { events, summaries, mine, loading, canRsvp, setStatus, reload } = useEvents({ realtime: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer>(null);
  const [showPast, setShowPast] = useState(false);

  const up = today ? upcomingEvents(events, today) : [];
  const past = today ? pastEvents(events, today) : [];
  const openEvent = events.find((e) => e.id === openId) ?? null;
  const myStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">📅 Events</h1>
        <p className="text-sm text-foreground/60">
          What&rsquo;s coming up at the lake — let everyone know if you&rsquo;re Going, Maybe, or can&rsquo;t make it.
        </p>
      </header>

      {!isSupabaseConfigured && (
        <ComingSoonCTA
          icon="📅"
          title="RSVPs are coming soon"
          note="You'll be able to tap Going / Maybe / Can't make and see who's attending right here."
        />
      )}

      {isAdmin && isSupabaseConfigured && (
        <button
          onClick={() => setComposer({ mode: "new" })}
          className="press w-full rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          + New event
        </button>
      )}

      {loading ? (
        <SkeletonList />
      ) : up.length === 0 && past.length === 0 ? (
        <ComingSoonCTA
          icon="🌲"
          title="No events on the calendar yet"
          note={isAdmin ? "Tap + New event to add the first one." : "Check back soon — events will show up here."}
        />
      ) : (
        <>
          {up.length > 0 && (
            <section className="space-y-3">
              {up.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  summary={summaries[e.id] ?? EMPTY_SUMMARY}
                  myStatus={myStatus(e)}
                  today={today!}
                  variant="card"
                  onOpen={() => setOpenId(e.id)}
                  onSetStatus={canRsvp ? (s) => setStatus(e.id, s) : undefined}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="space-y-2">
              <button
                onClick={() => setShowPast((v) => !v)}
                aria-expanded={showPast}
                className="press px-0.5 text-sm font-semibold text-foreground/70"
              >
                Past events {showPast ? "▾" : "▸"}
              </button>
              {showPast &&
                past.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    summary={summaries[e.id] ?? EMPTY_SUMMARY}
                    myStatus={myStatus(e)}
                    today={today!}
                    variant="compact"
                    onOpen={() => setOpenId(e.id)}
                  />
                ))}
            </section>
          )}
        </>
      )}

      {openEvent && today && (
        <EventSheet
          event={openEvent}
          summary={summaries[openEvent.id] ?? EMPTY_SUMMARY}
          mine={mine[openEvent.id] ?? null}
          today={today}
          onSetStatus={(s, days) => setStatus(openEvent.id, s, days)}
          onClose={() => setOpenId(null)}
          isAdmin={isAdmin}
          onEdit={
            isAdmin && openEvent.persisted
              ? () => {
                  setComposer({ mode: "edit", event: openEvent });
                  setOpenId(null);
                }
              : undefined
          }
          onChanged={reload}
        />
      )}

      {composer && (
        <EventComposer
          event={composer.mode === "edit" ? composer.event : null}
          onClose={() => setComposer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
