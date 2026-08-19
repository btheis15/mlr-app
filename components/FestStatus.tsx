"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { Protected, useGuest } from "@/components/Guard";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchJoinState } from "@/lib/roles";
import { useCachedResource } from "@/lib/swrCache";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatTime, formatEventTime } from "@/lib/format";
import { eventsForDay, dinnerForDay, dayTimeline } from "@/lib/schedule";
import { FEST_ALBUM_HREF } from "@/lib/data";
import { eventDays } from "@/lib/events";
import { firstName } from "@/lib/privacy";
import { DinnerDetailsEditSheet } from "@/components/DinnerDetailsEditSheet";
import { ScheduleDetailsEditSheet } from "@/components/ScheduleDetailsEditSheet";
import { DinnerSheet, ScheduleSheet } from "@/components/FestPlanner";
import { StartNextFestYear } from "@/components/StartNextFestYear";
import { ScheduleSignupSlots } from "@/components/ScheduleSignupSlots";
import { TournamentSection } from "@/components/TournamentView";
import {
  canEditFest,
  fetchMemberOptions,
  fetchDinnerDrafts,
  fetchScheduleDrafts,
  type FestMemberOption,
  type DinnerDraft,
  type ScheduleDraft,
} from "@/lib/festContent";
import type { ScheduleEvent, Dinner } from "@/lib/types";

/**
 * Stale-while-revalidate cache for "is the viewer a Family Fest committee member?".
 * `FestStatus` remounts on every navigation into the Family Fest section; without
 * this, `isFestMember` resets to `false` and the "Want to help plan? Join the
 * Family Fest committee" CTA flashes for members who actually belong, until the
 * async join-state fetch resolves. Holding the last-known value in memory lets a
 * returning member paint the correct (no-CTA) view immediately while a background
 * refetch reconciles it. Rides the shared SWR cache under `festMember.<uid>` —
 * the SAME key FamilyFestSpotlight uses, so the two surfaces share one deduped
 * fetch and one persisted snapshot. The revalidate can still flip it back to
 * `false`, so a revoked membership never sticks.
 */

/**
 * The focal block at the top of the Family Fest section. During the event week
 * it surfaces EVERYTHING for today inline — each event with time, location,
 * description, what to bring, and who's in charge (tap-to-call/text), plus
 * tonight's dinner with the head chef — so nobody has to dig the day of. Before
 * the week it's a countdown (+ volunteer prompt while planning); after, a
 * "post your photos" nudge.
 */
export function FestStatus({
  name: festName,
  tagline: festTagline,
  startDate,
  endDate,
  events,
  dinners,
  onContentSaved,
}: {
  /** This fest's own name/tagline — carried over as the starting point when an
   *  editor opens next year from the concluded state (see StartNextFestYear). */
  name: string;
  tagline: string;
  startDate: string;
  endDate: string;
  events: ScheduleEvent[];
  dinners: Dinner[];
  /** Called after an edit saves from the "Happening today" cards below, so
   *  the caller's own useFestContent() instance re-fetches — mirrors
   *  FestWeek's identical prop (see migration 0099). */
  onContentSaved?: () => void;
}) {
  const season = useFestSeason(startDate, endDate);
  const { today: t } = useDemoDate();
  const { user, userId } = useIdentity();

  // Full admin/committee editing (mirrors FestWeek's identical wiring) — the
  // "Happening today" cards are always fully expanded (no tap needed), so
  // unlike FestWeek's collapsible rows, the edit button here just sits
  // directly on the card. Chef/crew get the narrower DinnerDetailsEditSheet
  // for their own dinner; full editors get the Planner's own DinnerSheet/
  // ScheduleSheet, same as FestWeek.
  // The real session uid (available on the first client tick) drives the
  // chef/crew self-edit checks below — no async getCurrentUserId round-trip.
  const uid = userId;
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [dinnerDrafts, setDinnerDrafts] = useState<DinnerDraft[]>([]);
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>([]);
  const festDayOptions = eventDays(startDate, endDate);

  // Cached edit-permission — seeds the last-known value instantly (memory across
  // tab switches, persisted across cold opens) so the Edit affordances don't pop
  // in a frame or two late while the can_edit_fest RPC re-resolves on each visit.
  const { data: canEditAll } = useCachedResource<boolean>(
    user && userId ? `canEditFest.${userId}` : null,
    false,
    canEditFest,
    { persist: "local" },
  );

  const reloadAdminData = useCallback(() => {
    fetchMemberOptions().then(setMembers);
    fetchDinnerDrafts().then(setDinnerDrafts);
    fetchScheduleDrafts().then(setScheduleDrafts);
  }, []);

  // Once we know the viewer can edit, pull the Planner drafts + member list the
  // full-edit sheets need (a chef/crew self-editor never pays for this).
  useEffect(() => {
    if (canEditAll) reloadAdminData();
  }, [canEditAll, reloadAdminData]);

  const onSaved = () => {
    onContentSaved?.();
    if (canEditAll) reloadAdminData();
  };

  // Members of the Family Fest committee don't need the "join" prompt.
  // Seeded from the shared cache (no CTA flash for members, even on a cold
  // open); the revalidate keeps it current and can revoke.
  const { data: isFestMember } = useCachedResource<boolean>(
    user && userId ? `festMember.${userId}` : null,
    false,
    async () => {
      const cid = await fetchCommitteeId("family-fest");
      if (!cid) return false;
      return (await fetchJoinState(cid, userId)) === "member";
    },
    { persist: "local" },
  );

  if (season?.isLive) {
    // Anytime events (migration 0139) live in the "Anytime all week" group, not
    // in a day's "Happening today" list.
    const today = eventsForDay(events, t).filter((e) => !e.anytime);
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

        {/* Events + the dinner in one time-ordered timeline, so the dinner
            appears where it falls in the day, not always last. */}
        {dayTimeline(today, dinner).map((it) =>
          it.kind === "event" ? (
            <TodayEvent
              key={it.event.id}
              e={it.event}
              uid={uid}
              canEditAll={canEditAll}
              draft={scheduleDrafts.find((d) => d.id === it.event.id) ?? null}
              days={festDayOptions}
              members={members}
              onSaved={onSaved}
            />
          ) : (
            <TodayDinner
              key={`dinner-${it.dinner.id}`}
              d={it.dinner}
              uid={uid}
              canEditAll={canEditAll}
              draft={dinnerDrafts.find((d) => d.id === it.dinner.id) ?? null}
              days={festDayOptions}
              members={members}
              onSaved={onSaved}
            />
          ),
        )}
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
          Drop every photo &amp; video from the week into the shared Family Fest album — everyone can browse and download them.
        </p>
        <Link href={FEST_ALBUM_HREF} className="press mt-2 inline-block text-sm font-semibold text-primary">
          📸 Upload your photos to the Family Fest album →
        </Link>
      </div>
    );
  }

  if (season?.isConcluded) {
    // The fest is history. This branch exists because the off-season fallthrough
    // below rendered `<Countdown target={startDate} />` for a start date in the
    // PAST — which clamps to zero and reads "🎉 Family Fest is on — welcome Up
    // North!", so a finished fest advertised itself as live indefinitely. It
    // says thank you instead, and points at the archive where the week now
    // lives. Editors get the one thing that's actually next: set next year's
    // dates, which flips this whole section back to a countdown on its own.
    const year = Number(endDate.slice(0, 4));
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-primary/10 p-4 text-center">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            That&rsquo;s a wrap on {Number.isInteger(year) ? year : "this year"}
          </p>
          <p className="mt-1 text-lg font-bold text-primary">
            Thank you for a great Family Fest 🎆
          </p>
          <p className="mt-1 text-sm text-muted">See you next year!</p>
        </div>
        <Link
          href="/family-fest/past"
          className="press flex items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold text-primary ring-1 ring-border"
        >
          <span>🗓️ Look back at Past Years</span>
          <span aria-hidden className="text-foreground/40">
            ›
          </span>
        </Link>
        <Link
          href={FEST_ALBUM_HREF}
          className="press flex items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold text-primary ring-1 ring-border"
        >
          <span>📸 Photos &amp; videos from the week</span>
          <span aria-hidden className="text-foreground/40">
            ›
          </span>
        </Link>
        {canEditAll && (
          <StartNextFestYear
            current={{ name: festName, tagline: festTagline, startDate, endDate }}
            currentYear={year}
            onCreated={() => onContentSaved?.()}
          />
        )}
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

/** Today's event, fully expanded — the day-of detail people need at a glance.
 *  Carries the same in-place edit affordance as FestWeek's EventRow, just
 *  without the tap-to-expand step (this card is already fully shown). */
function TodayEvent({
  e,
  uid,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  e: ScheduleEvent;
  uid: string | null;
  canEditAll: boolean;
  draft: ScheduleDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const canEditThis =
    canEditAll || Boolean(uid && (e.leadUserId === uid || (e.crewUserIds ?? []).includes(uid)));
  const fullEdit = canEditAll && Boolean(draft);
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex gap-3">
        <span className="text-2xl">{e.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{e.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">
              {formatEventTime(e)}
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
          {(e.links ?? []).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {e.links!.map((l, i) => (
                <a
                  key={i}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                >
                  🔗 {l.label?.trim() || "Open link"}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      {e.signupEnabled && (
        <div className="mt-3">
          <ScheduleSignupSlots target={e} kind="schedule" canManage={canEditThis} members={members} />
        </div>
      )}
      {/* Was missing here entirely — FestWeek's EventRow (the Overview
          accordion) already gated the same way on tournamentEnabled, but this
          "Happening today" card (the ONLY place a live-week viewer sees an
          event, since FestStatus takes over the top of the page) never got
          the Tournament section wired in, so a tournament-enabled activity
          showed sign-ups but no way to set up/watch its bracket during the
          live week. No `open` gate needed — this card is always fully shown. */}
      {e.tournamentEnabled && (
        <div className="mt-3">
          <TournamentSection host={{ kind: "schedule", id: e.id }} canManage={canEditThis} itemTitle={e.title} enabled />
        </div>
      )}
      {e.lead && <Contact label="In charge" name={e.lead.name} phone={e.lead.phone} />}
      {canEditThis && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="press mt-3 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
        >
          ✏️ Edit this event
        </button>
      )}
      {editing && fullEdit && draft && (
        <ScheduleSheet
          draft={draft}
          days={days}
          members={members}
          nextPosition={draft.position}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
      {editing && !fullEdit && (
        <ScheduleDetailsEditSheet
          event={e}
          onClose={() => setEditing(false)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/** Tonight's dinner, expanded — menu + head chef contact. Same edit story as
 *  FestWeek's DinnerRow: full editors get the Planner's DinnerSheet, the
 *  chef/crew get the narrower DinnerDetailsEditSheet for their own dinner. */
function TodayDinner({
  d,
  uid,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  d: Dinner;
  uid: string | null;
  canEditAll: boolean;
  draft: DinnerDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const canEditThis = canEditAll || Boolean(uid && (d.chefUserId === uid || d.crewUserIds.includes(uid)));
  const fullEdit = canEditAll && Boolean(draft);
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex gap-3">
        <span className="text-2xl">{d.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Dinner · {d.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">{formatTime(d.time)}</span>
          </div>
          <p className="text-xs text-foreground/50">
            📍 <Protected label="Sign in for location">{d.location}</Protected> · prep starts {formatTime(d.prepTime)}
          </p>
          <p className="mt-1 text-xs text-foreground/70">{d.menu}</p>
        </div>
      </div>
      <Contact label="Head chef" name={d.chef.name} phone={d.chef.phone} />
      {canEditThis && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="press mt-3 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
        >
          ✏️ Edit this dinner
        </button>
      )}
      {editing && fullEdit && draft && (
        <DinnerSheet
          draft={draft}
          days={days}
          members={members}
          nextPosition={draft.position}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
      {editing && !fullEdit && (
        <DinnerDetailsEditSheet dinner={d} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}
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

