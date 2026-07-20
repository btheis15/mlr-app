"use client";

import { useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { SkeletonList } from "@/components/Skeleton";
import { EventCard } from "@/components/EventCard";
import { EventSheet } from "@/components/EventSheet";
import { EventComposer } from "@/components/EventComposer";
import { MeetingSection } from "@/components/MeetingSection";
import { MeetingComposer } from "@/components/MeetingComposer";
import { useIdentity } from "@/components/IdentityProvider";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useEvents } from "@/lib/hooks";
import { EMPTY_SUMMARY, effectiveStatus, pastEvents, upcomingEvents } from "@/lib/events";
import { fetchCanOrganize } from "@/lib/meetings";
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
  const [showDeclined, setShowDeclined] = useState(false);

  // Family-wide date polling (migration 0122) — admin-only to organize, open to
  // every signed-in member to vote. Mirrors CommitteeDetail's canOrganize/
  // members wiring, just with the plain member directory instead of a room
  // roster (there's no room here — it's everyone).
  const [canOrganizePoll, setCanOrganizePoll] = useState(false);
  const [composePoll, setComposePoll] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; avatarUrl?: string | null }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchCanOrganize({ type: "family" }).then((v) => {
      if (!cancelled) setCanOrganizePoll(v);
    });
    const sb = supabase;
    if (sb) {
      void sb
        .from("profiles")
        .select("id, display_name, avatar_url")
        .then(({ data }) => {
          if (cancelled) return;
          setMembers(
            (data ?? []).map((p) => ({ id: p.id, name: p.display_name || "Member", avatarUrl: p.avatar_url })),
          );
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // ?open=<id> deep-links straight into an event's sheet (e.g. from a
  // finalized meeting poll's "View the event" link).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  const openEvent = events.find((e) => e.id === openId) ?? null;
  const myStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };

  const allUpcoming = today ? upcomingEvents(events, today) : [];
  // Events you've said you can't make tuck into their own collapsible group below
  // (like "Past events") instead of crowding the calendar — still here to find or
  // change your RSVP, just not in your face.
  const declined = allUpcoming.filter((e) => myStatus(e) === "not_going");
  const up = allUpcoming.filter((e) => myStatus(e) !== "not_going");
  const past = today ? pastEvents(events, today) : [];

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">📅 Events</h1>
        <p className="text-sm text-foreground/60">
          What&rsquo;s coming up Up North — let everyone know if you&rsquo;re Going, Maybe, or can&rsquo;t make it.
        </p>
      </header>

      {!isSupabaseConfigured && (
        <ComingSoonCTA
          icon="📅"
          title="RSVPs are coming soon"
          note="You'll be able to tap Going / Maybe / Can't make and see who's attending right here."
        />
      )}

      {isSupabaseConfigured && (
        <MeetingSection surface="card" scope={{ type: "family" }} members={members} />
      )}

      {isAdmin && isSupabaseConfigured && (
        <div className="flex gap-2">
          <button
            onClick={() => setComposer({ mode: "new" })}
            className="press flex-1 rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
          >
            + New event
          </button>
          {canOrganizePoll && (
            <button
              onClick={() => setComposePoll(true)}
              className="press flex-1 rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
            >
              📅 Propose dates
            </button>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : up.length === 0 && declined.length === 0 && past.length === 0 ? (
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

          {declined.length > 0 && (
            <section className="space-y-2">
              <button
                onClick={() => setShowDeclined((v) => !v)}
                aria-expanded={showDeclined}
                className="press px-0.5 text-sm font-semibold text-foreground/70"
              >
                Can&rsquo;t make it ({declined.length}) {showDeclined ? "▾" : "▸"}
              </button>
              {showDeclined &&
                declined.map((e) => (
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

      {composePoll && (
        <MeetingComposer
          scope={{ type: "family" }}
          roomLabel="everyone at MLR"
          onClose={() => setComposePoll(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
}
