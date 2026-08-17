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
import { PrivateActivityComposer } from "@/components/PrivateActivityComposer";
import { PrivateActivitySheet } from "@/components/PrivateActivitySheet";
import { useIdentity } from "@/components/IdentityProvider";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useEvents, usePrivateActivities } from "@/lib/hooks";
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
  const { isAdmin, user, userId, promptSignIn } = useIdentity();
  const { events, summaries, mine, loading, canRsvp, setStatus, reload } = useEvents({ realtime: true });
  const { activities, reload: reloadActivities } = usePrivateActivities();
  const [openId, setOpenId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer>(null);
  const [showPast, setShowPast] = useState(false);
  const [showDeclined, setShowDeclined] = useState(false);

  // Private activities — a member-created, invite-only game/get-together (0150).
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const openActivity = activities.find((a) => a.id === openActivityId) ?? null;
  const liveActivities = activities.filter((a) => !a.archivedAt);
  const archivedActivities = activities.filter((a) => a.archivedAt);

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
    const params = new URLSearchParams(window.location.search);
    const id = params.get("open");
    if (id) setOpenId(id);
    const act = params.get("activity");
    if (act) setOpenActivityId(act);
  }, []);

  const openEvent = events.find((e) => e.id === openId) ?? null;
  const myStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };
  // Any signed-in member can create an event (0187) — editing/deleting it, and
  // assigning work items to it, is admin OR that event's own creator.
  const canManageEvent = (e: ResortEvent) => isAdmin || (!!userId && e.createdBy === userId);

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

      {isSupabaseConfigured && (
        <div className="flex gap-2">
          <button
            onClick={() => (user ? setComposer({ mode: "new" }) : promptSignIn())}
            className="press flex-1 rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
          >
            + New event
          </button>
          {isAdmin && canOrganizePoll && (
            <button
              onClick={() => setComposePoll(true)}
              className="press flex-1 rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
            >
              📅 Propose dates
            </button>
          )}
        </div>
      )}

      {/* Anyone can spin up a private activity — an invite-only game/get-together
          nobody else sees, with an optional tournament. */}
      {isSupabaseConfigured && (
        <button
          onClick={() => (user ? setCreatingActivity(true) : promptSignIn())}
          className="press w-full rounded-2xl bg-accent/10 py-3 text-sm font-semibold text-accent ring-1 ring-accent/20"
        >
          🎉 Create an activity
        </button>
      )}

      {(liveActivities.length > 0 || archivedActivities.length > 0) && (
        <section className="space-y-2">
          <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">Your activities</h2>
          {liveActivities.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpen={() => setOpenActivityId(a.id)} />
          ))}
          {archivedActivities.length > 0 && (
            <>
              <button
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="press px-0.5 pt-1 text-sm font-semibold text-foreground/60"
              >
                Finished &amp; archived ({archivedActivities.length}) {showArchived ? "▾" : "▸"}
              </button>
              {showArchived &&
                archivedActivities.map((a) => (
                  <ActivityRow key={a.id} activity={a} onOpen={() => setOpenActivityId(a.id)} muted />
                ))}
            </>
          )}
        </section>
      )}

      {loading ? (
        <SkeletonList />
      ) : up.length === 0 && declined.length === 0 && past.length === 0 ? (
        <ComingSoonCTA
          icon="🌲"
          title="No events on the calendar yet"
          note={isSupabaseConfigured ? "Tap + New event to add the first one." : "Check back soon — events will show up here."}
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
          canManage={canManageEvent(openEvent)}
          onEdit={
            canManageEvent(openEvent) && openEvent.persisted
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

      {creatingActivity && (
        <PrivateActivityComposer
          members={members}
          myId={userId}
          onClose={() => setCreatingActivity(false)}
          onCreated={(id) => {
            void reloadActivities();
            setOpenActivityId(id);
          }}
        />
      )}

      {openActivity && (
        <PrivateActivitySheet
          activity={openActivity}
          members={members}
          myId={userId}
          onClose={() => setOpenActivityId(null)}
          onChanged={reloadActivities}
        />
      )}
    </div>
  );
}

function ActivityRow({
  activity,
  onOpen,
  muted = false,
}: {
  activity: import("@/lib/privateActivities").PrivateActivity;
  onOpen: () => void;
  muted?: boolean;
}) {
  const count = activity.members.length;
  return (
    <button
      onClick={onOpen}
      className={`press flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left ring-1 ring-border ${muted ? "opacity-60" : ""}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-xl">{activity.emoji || "🎉"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold leading-tight">{activity.title}</span>
        <span className="block truncate text-xs text-foreground/55">
          <span className="font-medium text-primary">Private</span>
          {activity.tournamentEnabled ? " · 🏆 Tournament" : ""}
          {` · ${count} ${count === 1 ? "person" : "people"}`}
        </span>
      </span>
      <span className="shrink-0 text-foreground/30">›</span>
    </button>
  );
}
