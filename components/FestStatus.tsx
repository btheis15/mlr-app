"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { Protected, useGuest } from "@/components/Guard";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchJoinState } from "@/lib/roles";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatTime, plural } from "@/lib/format";
import { eventsForDay, dinnerForDay } from "@/lib/schedule";
import { firstName } from "@/lib/privacy";
import type { ScheduleEvent, Dinner } from "@/lib/types";

/**
 * Stale-while-revalidate cache for "is the viewer a Family Fest committee member?".
 * `FestStatus` remounts on every navigation into the Family Fest section; without
 * this, `isFestMember` resets to `false` and the "Want to help plan? Join the
 * Family Fest committee" CTA flashes for members who actually belong, until the
 * async join-state fetch resolves. Holding the last-known value in memory lets a
 * returning member paint the correct (no-CTA) view immediately while a background
 * refetch reconciles it. Keyed by viewer identity (login email, "self" for a
 * guest) so one member's membership can't leak to another. Memory-only (per
 * session) and written *only after* a client fetch — never during SSR/render — so
 * a cold load starts empty (matching the original `false` default) and can't cause
 * a hydration mismatch. The refetch can still flip it back to `false`, so a
 * revoked membership never sticks. Mirrors `eventsCache`/`useEvents` in lib/hooks.ts.
 */
const festStatusMemberCache = new Map<string, boolean>();

/**
 * The focal block at the top of the Family Fest section. During the event week
 * it surfaces EVERYTHING for today inline — each event with time, location,
 * description, what to bring, and who's in charge (tap-to-call/text), plus
 * tonight's dinner with the head chef — so nobody has to dig the day of. Before
 * the week it's a countdown (+ volunteer prompt while planning); after, a
 * "post your photos" nudge.
 */
export function FestStatus({
  startDate,
  endDate,
  events,
  dinners,
}: {
  startDate: string;
  endDate: string;
  events: ScheduleEvent[];
  dinners: Dinner[];
}) {
  const season = useFestSeason(startDate, endDate);
  const { today: t } = useDemoDate();
  const { user } = useIdentity();

  // Members of the Family Fest committee don't need the "join" prompt.
  // Warm cache ⇒ paint the resolved value immediately (no CTA flash for members);
  // the effect below still refetches to keep it current (and can revoke).
  const key = user?.email ?? "self";
  const [isFestMember, setIsFestMember] = useState(festStatusMemberCache.get(key) ?? false);
  useEffect(() => {
    let active = true;
    if (!user) {
      setIsFestMember(false);
      return;
    }
    (async () => {
      const cid = await fetchCommitteeId("family-fest");
      if (!cid || !active) return;
      const state = await fetchJoinState(cid);
      if (active) {
        const member = state === "member";
        setIsFestMember(member);
        // Client-only write (post-fetch) — never during SSR/render. Stores the
        // latest truth, so a revoked membership overwrites a cached `true`.
        festStatusMemberCache.set(user.email ?? "self", member);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (season?.isLive) {
    const today = eventsForDay(events, t);
    const dinner = dinnerForDay(dinners, t);
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-primary/10 p-4 text-center">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Happening today
          </p>
          <p className="mt-1 text-xl font-bold text-primary">
            Day {season.dayNumber} of {season.totalDays}
          </p>
          <p className="text-sm text-foreground/60">
            Everything you need for today, right here.
          </p>
        </div>

        {today.map((e) => (
          <TodayEvent key={e.id} e={e} />
        ))}
        {dinner && <TodayDinner d={dinner} />}
        {today.length === 0 && !dinner && (
          <p className="rounded-2xl bg-card p-4 text-center text-sm text-foreground/60 ring-1 ring-border">
            Nothing scheduled today — enjoy the lake! 🛶
          </p>
        )}
      </div>
    );
  }

  if (season?.isWrap) {
    return (
      <div className="rounded-2xl bg-primary/10 p-4 text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
          That&rsquo;s a wrap
        </p>
        <p className="mt-1 text-lg font-bold text-primary">Thanks for a great week 🎆</p>
        <p className="mt-1 text-sm text-foreground/60">
          Post any photos you didn&rsquo;t get to share
          {season.wrapDaysLeft > 0
            ? ` — the album's open ${season.wrapDaysLeft} more ${plural(season.wrapDaysLeft, "day")}.`
            : "."}
        </p>
        <Link href="/posts" className="press mt-2 inline-block text-sm font-semibold text-primary">
          Post your photos →
        </Link>
      </div>
    );
  }

  // off-season / planning
  return (
    <div className="space-y-3">
      <Countdown target={startDate} />
      {season?.isPlanning && !isFestMember && (
        <Link
          href="/committees/family-fest"
          className="press flex items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-center text-sm font-semibold text-primary ring-1 ring-border"
        >
          🙋 Want to help plan? Join the Family Fest committee ›
        </Link>
      )}
    </div>
  );
}

/** Today's event, fully expanded — the day-of detail people need at a glance. */
function TodayEvent({ e }: { e: ScheduleEvent }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex gap-3">
        <span className="text-2xl">{e.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{e.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">
              {formatTime(e.start)}
              {e.end ? `–${formatTime(e.end)}` : ""}
            </span>
          </div>
          <p className="text-xs text-foreground/50">📍 <Protected label="Sign in for location">{e.location}</Protected></p>
          <p className="mt-1 text-xs text-foreground/70">{e.description}</p>
          {e.bring && (
            <p className="mt-1 text-xs text-foreground/60">
              🎒 <span className="text-foreground/40">Bring:</span> {e.bring}
            </p>
          )}
        </div>
      </div>
      {e.lead && <Contact label="In charge" name={e.lead.name} phone={e.lead.phone} />}
    </div>
  );
}

/** Tonight's dinner, expanded — menu + head chef contact. */
function TodayDinner({ d }: { d: Dinner }) {
  return (
    <div className="rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
      <div className="flex gap-3">
        <span className="text-2xl">{d.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Dinner · {d.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">{d.time}</span>
          </div>
          <p className="text-xs text-foreground/50">
            📍 <Protected label="Sign in for location">{d.location}</Protected> · prep starts {d.prepTime}
          </p>
          <p className="mt-1 text-xs text-foreground/70">{d.menu}</p>
        </div>
      </div>
      <Contact label="Head chef" name={d.chef.name} phone={d.chef.phone} />
    </div>
  );
}

function Contact({ label, name, phone }: { label: string; name: string; phone?: string }) {
  const { guest, promptSignIn } = useGuest();
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
      <p className="min-w-0 flex-1 truncate text-xs text-foreground/60">
        <span className="text-foreground/40">{label}:</span> {guest ? firstName(name) : name}
      </p>
      {!phone ? null : guest ? (
        <button
          onClick={promptSignIn}
          className="press rounded-full bg-background px-2.5 py-1.5 text-xs text-foreground/45 ring-1 ring-border"
        >
          🔒 Sign in
        </button>
      ) : (
        <>
          <a
            href={`tel:${phone}`}
            aria-label={`Call ${name}`}
            className="press rounded-full bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
          >
            📞
          </a>
          <a
            href={`sms:${phone}`}
            aria-label={`Text ${name}`}
            className="press rounded-full bg-accent/10 px-2.5 py-1.5 text-xs text-accent"
          >
            💬
          </a>
        </>
      )}
    </div>
  );
}

