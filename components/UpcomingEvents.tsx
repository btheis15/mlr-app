"use client";

import Link from "next/link";
import { useState } from "react";
import { FAMILY_FEST } from "@/lib/data";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useFestSeason } from "@/lib/useFestSeason";
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
  const ffSeason = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const { isAdmin } = useIdentity();
  const { events, summaries, mine, loading, canRsvp, setStatus } = useEvents();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!today || loading) return null;

  let up = upcomingEvents(events, today);
  if (ffSeason?.isTakeover) up = up.filter((e) => e.kind !== "family_fest");
  if (up.length === 0) return null;

  const first = up[0];
  const secondary = up.slice(1, 3);
  const openEvent = up.find((e) => e.id === openId) ?? null;
  const myStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };

  return (
    <section className="space-y-3">
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
          isAdmin={isAdmin}
        />
      )}
    </section>
  );
}
