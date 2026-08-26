"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatDateRange, formatTime, formatEventTime } from "@/lib/format";
import { eventsForDay, dinnerForDay } from "@/lib/schedule";
import { festAlbumHref } from "@/lib/data";
import { Protected } from "@/components/Guard";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchJoinState } from "@/lib/roles";
import { useCachedResource } from "@/lib/swrCache";
import type { ScheduleEvent, Dinner } from "@/lib/types";

/**
 * Stale-while-revalidate cache for Family Fest committee membership, keyed by the
 * viewer's email (guests share the "self" bucket). This component remounts on every
 * home visit; without the cache `isMember` resets to `false`, so for an actual
 * member the "🙋 Join the Family Fest committee" CTA flashes in and then vanishes
 * once the async membership check resolves. Holding the last-known value lets a
 * returning member paint the correct (CTA-hidden) state immediately while the
 * effect still re-derives membership in the background — so a member who *left* the
 * committee gets the CTA back on the next refetch (never sticks). Rides the
 * shared SWR cache under `festMember.<uid>` — the SAME key FestStatus uses, so
 * both surfaces share one deduped fetch and one persisted snapshot, and a cold
 * open paints the correct member/non-member view immediately.
 */

/**
 * The Family Fest presence on the resort home — a compact, phase-aware summary
 * (a glance, not the whole hub) that links to the fest tab, plus one smart
 * shortcut: the Family Fest committee CHAT if you're a member, or the JOIN
 * request if you're not.
 *
 * Phase shifts with the shared season model (lib/festSeason.ts): off-season →
 * quiet banner; planning → a short "taking shape" line; live → today's events;
 * wrap → a photos nudge. Phase is computed client-side so it's correct on both
 * the static Pages build and Vercel.
 */
export function FamilyFestSpotlight({
  name,
  tagline,
  startDate,
  endDate,
  schedule,
  dinners,
}: {
  name: string;
  tagline: string;
  startDate: string;
  endDate: string;
  schedule: ScheduleEvent[];
  dinners: Dinner[];
}) {
  const season = useFestSeason(startDate, endDate);
  // Each fest year has its own photo album (a Drop Box keyed by year), so the
  // wrap-up nudge names THIS year's — a frozen link would have kept sending new
  // photos into 2026's folder.
  const albumHref = festAlbumHref(Number(endDate.slice(0, 4)));
  const { today } = useDemoDate();
  const { user, userId } = useIdentity();
  // Members get no CTA; the shared, persisted snapshot means no CTA flash for
  // a returning member even on a cold open, and the revalidate re-derives so
  // leaving the committee re-shows the CTA.
  const { data: isMember } = useCachedResource<boolean>(
    user && userId ? `festMember.${userId}` : null,
    false,
    async () => {
      const cid = await fetchCommitteeId("family-fest");
      if (!cid) return false;
      return (await fetchJoinState(cid, userId)) === "member";
    },
    { persist: "local" },
  );

  // Members don't need a redirect — their chats live on the Feed/Chats tab now.
  // Only non-members get a shortcut (to join the committee).
  const festCTA = isMember ? null : (
    <Link
      href="/committees/family-fest"
      className="press flex items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold text-primary ring-1 ring-border"
    >
      <span>🙋 Join the Family Fest committee</span>
      <span aria-hidden className="text-foreground/40">
        ›
      </span>
    </Link>
  );

  let card: React.ReactNode;

  if (season?.isLive) {
    // Live week — the WHOLE day right here (every event + tonight's dinner),
    // not just a teaser: nobody should have to click through just to see
    // what's later today.
    const todays = eventsForDay(schedule, today);
    const dinner = dinnerForDay(dinners, today);
    card = (
      <Link
        href="/family-fest"
        className="press block rounded-2xl bg-gradient-to-br from-campfire/20 via-sun/15 to-dusk/25 p-4 ring-1 ring-dusk/30 shadow-sm"
      >
        <LiveDotLabel>{name} · happening now</LiveDotLabel>
        <p className="mt-1 text-lg font-semibold">
          Day {season.dayNumber} of {season.totalDays} Up North 🎆
        </p>
        {todays.length > 0 || dinner ? (
          <ul className="mt-2 space-y-2">
            {[
              ...todays.map((e) => ({ kind: "event" as const, time: e.start ?? "", event: e })),
              ...(dinner ? [{ kind: "dinner" as const, time: dinner.time ?? "", dinner }] : []),
            ]
              .sort((a, b) => a.time.localeCompare(b.time))
              .map((item) =>
                item.kind === "event" ? (
                  <li key={item.event.id} className="rounded-xl bg-background/50 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {item.event.emoji} {item.event.title}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-foreground/60">
                        {formatEventTime(item.event)}
                        {item.event.end ? `–${formatTime(item.event.end)}` : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">
                      📍 <Protected label="Sign in for location">{item.event.location}</Protected>
                    </p>
                  </li>
                ) : (
                  <li key="dinner" className="rounded-xl bg-background/50 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {item.dinner.emoji} Dinner · {item.dinner.title}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-foreground/60">
                        {formatTime(item.dinner.time)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">
                      📍 <Protected label="Sign in for location">{item.dinner.location}</Protected>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{item.dinner.menu}</p>
                  </li>
                )
              )}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-foreground/70">{tagline}</p>
        )}
        <p className="mt-2 text-xs font-medium text-campfire">
          Open Family Fest for more →
        </p>
      </Link>
    );
  } else if (season?.isWrap) {
    // Wrap — nudge photos for two weeks, into the shared Family Fest album.
    card = (
      <Link
        href={albumHref}
        className="press block rounded-2xl bg-gradient-to-br from-campfire/20 via-sun/15 to-dusk/25 p-4 ring-1 ring-dusk/30 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
          🎆 {name} · that&rsquo;s a wrap
        </p>
        <p className="mt-1 text-lg font-semibold">Thanks for a great week Up North</p>
        <p className="mt-1 text-sm text-foreground/70">
          Add every photo &amp; video from the week to the shared Family Fest album — everyone can browse and download them.
        </p>
        <p className="mt-2 text-xs font-medium text-campfire">📸 Upload your photos to the Family Fest album →</p>
      </Link>
    );
  } else if (season?.isPlanning) {
    // Planning — a short "taking shape" summary (no full schedule list here;
    // that lives on the fest tab).
    card = (
      <Link
        href="/family-fest"
        className="press block rounded-2xl bg-gradient-to-br from-campfire/15 via-sun/10 to-dusk/20 p-4 ring-1 ring-dusk/25"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
            🎉 {name} · planning underway
          </p>
          <p className="shrink-0 text-[11px] font-medium text-foreground/50">
            {formatDateRange(startDate, endDate)}
          </p>
        </div>
        <p className="mt-1 text-base font-semibold">
          {season.isSoon
            ? "Almost here — final plans coming together"
            : `${season.daysUntilStart} days out — here's what's taking shape`}
        </p>
        <p className="mt-1 text-sm text-foreground/60">See the week &amp; who&rsquo;s coming →</p>
      </Link>
    );
  } else if (season?.isConcluded) {
    // Concluded — this year's fest is done. Says thank you and points at the
    // archive, rather than the generic off-season "returns next summer", which
    // read oddly two weeks after everyone got home from the actual fest.
    card = (
      <Link
        href="/family-fest"
        className="press block rounded-2xl bg-gradient-to-br from-campfire/15 via-sun/10 to-dusk/20 p-4 ring-1 ring-dusk/20"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
              🎆 {name} · that&rsquo;s a wrap
            </p>
            <p className="mt-1 text-sm font-semibold">Thank you for a great Family Fest</p>
            <p className="mt-0.5 text-xs text-muted">See you next year — look back at Past Years →</p>
          </div>
          <span className="shrink-0 text-3xl">🏰</span>
        </div>
      </Link>
    );
  } else {
    // Off-season — the quiet banner (a fest with dates still far ahead).
    card = (
      <Link
        href="/family-fest"
        className="press block rounded-2xl bg-gradient-to-br from-campfire/15 via-sun/10 to-dusk/20 p-4 ring-1 ring-dusk/20"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
              🎉 Family Fest
            </p>
            <p className="mt-1 text-sm font-semibold">Family Fest returns next summer</p>
          </div>
          <span className="text-3xl">🎆</span>
        </div>
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      {card}
      {festCTA}
    </div>
  );
}

function LiveDotLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campfire/70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-campfire" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-campfire">{children}</p>
    </div>
  );
}
