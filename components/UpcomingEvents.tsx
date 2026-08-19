"use client";

import Link from "next/link";
import { useState } from "react";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useCurrentFestSeason } from "@/lib/useFestSeason";
import { useEventHosting } from "@/lib/eventHosts";
import { useEvents } from "@/lib/hooks";
import { EMPTY_SUMMARY, effectiveStatus, upcomingEvents } from "@/lib/events";
import { useIdentity } from "@/components/IdentityProvider";
import { EventCard } from "@/components/EventCard";
import { EventSheet } from "@/components/EventSheet";
import type { AttendanceStatus, ResortEvent } from "@/lib/types";

/**
 * "Upcoming Up North" — the resort-events block on Home. The nearest event is a
 * spotlight card with an inline Going/Maybe/Can't-make control; the next couple
 * are quiet rows, with a "See all ›" link to the full /events calendar. Computed
 * client-side (useDemoDate) like FamilyFestSpotlight, and it renders nothing if
 * there's nothing upcoming — keeping Home lean. Family Fest is skipped here while
 * its own takeover spotlight is showing (planning/live/wrap) so it isn't doubled.
 */
export function UpcomingEvents() {
  const { today } = useDemoDate();
  const ffSeason = useCurrentFestSeason();
  const { isAdmin, userId } = useIdentity();
  // ⚠️ `reload` is needed even though Home deliberately runs WITHOUT realtime:
  // the event sheet's add/remove-attendee actions have no other way to refresh
  // here, and without it they silently appeared to do nothing.
  const { events, summaries, mine, loading, canRsvp, setStatus, reload } = useEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  // ⚠️ Host-aware permissions, resolved server-side — the SAME hook /events uses,
  // so the one shared EventSheet can't be quietly stricter on Home than on the
  // calendar. Called before the early return below to keep hook order stable.
  // `oldRule` is the pre-0209 predicate, used only as the pre-migration fallback.
  const { hosts, permFor, reload: reloadHosting } = useEventHosting(
    events,
    (e) => isAdmin || (!!userId && e.createdBy === userId),
  );

  if (!today || loading) return null;

  const myStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };

  let up = upcomingEvents(events, today);
  if (ffSeason?.isTakeover) up = up.filter((e) => e.kind !== "family_fest");
  // Don't make anyone stay stuck on a "can't go" card here — once you've RSVP'd
  // "Can't make", the event drops off Home. It's still in the full /events
  // calendar (under "Can't make it") if you want to find or change it.
  up = up.filter((e) => myStatus(e) !== "not_going");
  if (up.length === 0) return null;

  const first = up[0];
  const secondary = up.slice(1, 3);
  const openEvent = up.find((e) => e.id === openId) ?? null;

  return (
    // `data-home-events` lets the Home hero-logo fit know events are present, so
    // it anchors on the Help/People row; with no events this block is absent and
    // the fit drops to "Around the resort" instead (see lib/appLogoFit.ts).
    <section data-home-events className="space-y-3">
      <div className="flex items-baseline justify-between px-0.5">
        <h2 className="text-sm font-semibold">📅 Upcoming Up North</h2>
        <Link href="/events" className="press text-xs font-medium text-primary">
          See all ›
        </Link>
      </div>

      <EventCard
        event={first}
        summary={summaries[first.id] ?? EMPTY_SUMMARY}
        myStatus={myStatus(first)}
        today={today}
        variant="spotlight"
        onOpen={() => setOpenId(first.id)}
        onSetStatus={canRsvp ? (s) => setStatus(first.id, s) : undefined}
      />

      {secondary.map((e) => (
        <EventCard
          key={e.id}
          event={e}
          summary={summaries[e.id] ?? EMPTY_SUMMARY}
          myStatus={myStatus(e)}
          today={today}
          variant="compact"
          onOpen={() => setOpenId(e.id)}
        />
      ))}

      {openEvent && (
        <EventSheet
          event={openEvent}
          summary={summaries[openEvent.id] ?? EMPTY_SUMMARY}
          mine={mine[openEvent.id] ?? null}
          today={today}
          onSetStatus={(s, days) => setStatus(openEvent.id, s, days)}
          onClose={() => setOpenId(null)}
          canManage={permFor(openEvent.id).canManage}
          canDelete={permFor(openEvent.id).canDelete}
          hosts={hosts.get(openEvent.id) ?? []}
          onChanged={() => {
            reload();
            reloadHosting();
          }}
        />
      )}
    </section>
  );
}
