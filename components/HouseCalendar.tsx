"use client";

import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus, HouseStay, ResortEvent } from "@/lib/types";
import { useEvents, useHouseCalendar, useSheetDismiss } from "@/lib/hooks";
import { Sheet } from "@/components/Sheet";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { eventDays, effectiveStatus, EMPTY_SUMMARY, upcomingEvents, isOngoing } from "@/lib/events";
import { isStayActive, isStayPast, stayLabel, stayHeadCount } from "@/lib/houseCalendar";
import {
  fetchHouseMembers,
  fetchHouseRosterMembers,
  impliedStays,
  occupantsOnDay,
  stayingCount,
  type HouseMember,
  type HouseRosterMember,
  type ImpliedStay,
} from "@/lib/housePresence";
import { useCachedResource } from "@/lib/swrCache";
import { isSupabaseConfigured } from "@/lib/supabase";
import { formatDateRange, relativeDays } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { PrivateName } from "@/components/Guard";
import { SkeletonList } from "@/components/Skeleton";
import { EventCard } from "@/components/EventCard";
import { EventSheet } from "@/components/EventSheet";
import { HouseStayComposer } from "@/components/HouseStayComposer";
import { HouseStaySheet } from "@/components/HouseStaySheet";
import { useIdentity } from "@/components/IdentityProvider";

// The house calendar: an Apple-Calendar-style month grid + an agenda of who's
// staying and when, with resort-wide MLR events overlaid on both so a house never
// misses a family-wide gathering. Members add their own stays; overlapping stays
// show who's up at the same time. Reuses the events RSVP surface (EventCard /
// EventSheet) for the MLR overlay.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const MONTH_LABEL = (y: number, m0: number) =>
  new Date(y, m0, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** A flat array of ISO-day strings (or null blanks) laid out Sun→Sat for a month. */
function monthCells(year: number, m0: number): (string | null)[] {
  const startDow = new Date(year, m0, 1).getDay();
  const daysInMonth = new Date(year, m0 + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoOf(year, m0, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function HouseCalendar({
  houseId,
  houseName,
}: {
  houseId: string;
  houseName: string;
}) {
  const { today } = useDemoDate();
  const { user, isAdmin, effectiveUserId } = useIdentity();
  const { stays, loading, canWrite, addStay, editStay, removeStay } = useHouseCalendar(houseId);
  const events = useEvents({ realtime: true });

  // "Is this my stay?" resolves against the EFFECTIVE viewer, so an admin
  // previewing as another member sees THAT member's Edit affordances rather than
  // their own (a raw auth.getUser() always returns the real admin). Available on
  // the first client tick, so no round-trip and no affordance pop-in. The server
  // still enforces author-or-admin on every edit.
  const uid = effectiveUserId;

  const [composer, setComposer] = useState<{ mode: "new" } | { mode: "edit"; stay: HouseStay } | null>(null);
  const [openStayId, setOpenStayId] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  // Visible month — defaults to today's month once "today" is known.
  const [month, setMonth] = useState<{ y: number; m0: number } | null>(null);
  const view = month ?? (today ? { y: +today.slice(0, 4), m0: +today.slice(5, 7) - 1 } : { y: 2026, m0: 0 });

  // Day → stays / events that cover it (string compare is safe on ISO dates).
  const staysByDay = useMemo(() => {
    const map: Record<string, HouseStay[]> = {};
    for (const s of stays) for (const d of eventDays(s.startDate, s.endDate)) (map[d] ??= []).push(s);
    return map;
  }, [stays]);
  const eventsByDay = useMemo(() => {
    const map: Record<string, ResortEvent[]> = {};
    for (const e of events.events) for (const d of eventDays(e.startDate, e.endDate)) (map[d] ??= []).push(e);
    return map;
  }, [events.events]);

  const cells = monthCells(view.y, view.m0);
  const shiftMonth = (delta: number) => {
    const base = new Date(view.y, view.m0 + delta, 1);
    setMonth({ y: base.getFullYear(), m0: base.getMonth() });
  };

  const openStay = stays.find((s) => s.id === openStayId) ?? null;
  const openEvent = events.events.find((e) => e.id === openEventId) ?? null;

  const myEventStatus = (e: ResortEvent): AttendanceStatus | null => {
    const m = events.mine[e.id];
    return m ? effectiveStatus(m.status, m.days) : null;
  };
  const canEditStay = (s: HouseStay) => isAdmin || (!!uid && s.createdBy === uid);

  // Agenda splits.
  const upcomingStays = today ? stays.filter((s) => !isStayPast(s, today)) : stays;
  const pastStays = today ? stays.filter((s) => isStayPast(s, today)).reverse() : [];
  const upcomingResort = today ? upcomingEvents(events.events, today) : [];

  // ⚠️ "Who's staying" is not just `house_stays`. A member of this house who's
  // RSVP'd going to a resort event will be AT the house for it, whether or not
  // they ever typed a stay — so they belong in the list (see lib/housePresence).
  // House-scoped cache key; membership is RLS-gated and wiped on signOut.
  const { data: members } = useCachedResource<HouseMember[]>(
    isSupabaseConfigured ? `houseMembers.${houseId}` : null,
    [],
    () => fetchHouseMembers(houseId),
    { persist: "local" },
  );
  // ⚠️ …and the house's people who have NO app account yet (family_roster,
  // 0123). They can't RSVP themselves, but a host can add them to an event, and
  // being assigned to this house means they're staying HERE. Billy is assigned to
  // MJT House and coming up; before this the calendar didn't know he existed,
  // because the derivation only looked at `profiles`.
  const { data: rosterMembers } = useCachedResource<HouseRosterMember[]>(
    isSupabaseConfigured ? `houseRoster.${houseId}` : null,
    [],
    () => fetchHouseRosterMembers(houseId),
    { persist: "local" },
  );
  // Built from each event's `summary.going` rather than a raw attendance list —
  // `useEvents` doesn't expose the raw rows, and `going` is already rolled up by
  // `effectiveStatus`, so a Maybe can't leak in on the way through. The rows keep
  // their `days` map, so the per-day narrowing still works.
  const goingRows = useMemo(
    () => Object.values(events.summaries).flatMap((s) => s.going),
    [events.summaries],
  );
  const implied = useMemo(
    () =>
      today
        ? impliedStays({ events: events.events, attendance: goingRows, members, rosterMembers, stays, today })
        : [],
    [events.events, goingRows, members, rosterMembers, stays, today],
  );
  // The number on the heading — people, not rows (a stay's extra guest_names are
  // extra people sleeping there, and nobody is double-counted).
  const staying = useMemo(
    () => stayingCount({ stays: upcomingStays, implied }),
    [upcomingStays, implied],
  );

  return (
    <div className="space-y-5">
      {/* ── Month grid ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-card p-3 ring-1 ring-border">
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="press flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground/50 hover:bg-foreground/5"
          >
            ‹
          </button>
          <h2 className="text-sm font-bold">{MONTH_LABEL(view.y, view.m0)}</h2>
          <button
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="press flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground/50 hover:bg-foreground/5"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="pb-1 text-center text-[10px] font-semibold uppercase text-faint">
              {d}
            </div>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} />;
            const dayNum = +iso.slice(8, 10);
            const dayStays = staysByDay[iso] ?? [];
            const dayEvents = eventsByDay[iso] ?? [];
            const isToday = iso === today;
            const has = dayStays.length > 0 || dayEvents.length > 0;
            return (
              <button
                key={i}
                onClick={() => setOpenDay(iso)}
                className={`press relative flex aspect-square flex-col items-center justify-start rounded-lg pt-1 text-xs ${
                  isToday ? "bg-primary/10 font-bold text-primary ring-1 ring-primary/30" : has ? "bg-background" : ""
                }`}
              >
                <span>{dayNum}</span>
                <span className="mt-0.5 flex gap-0.5">
                  {dayStays.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
                  {dayEvents.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-muted">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> House stay</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Resort event</span>
        </div>
      </section>

      {/* Add my stay */}
      <button
        onClick={() => (canWrite ? setComposer({ mode: "new" }) : addStay({ startDate: today ?? "", endDate: today ?? "" }))}
        className="press w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
      >
        + Add my stay
      </button>

      {/* ── Resort-wide events overlay (never miss a family-wide gathering) ──── */}
      {upcomingResort.length > 0 && today && (
        <section className="space-y-2">
          <h3 className="px-0.5 text-sm font-bold">🌲 Happening across the resort</h3>
          <p className="px-0.5 text-xs text-muted">
            Resort-wide events show on every house calendar — tap to RSVP so you don&rsquo;t miss them.
          </p>
          {upcomingResort.slice(0, 4).map((e) => (
            <EventCard
              key={e.id}
              event={e}
              summary={events.summaries[e.id] ?? EMPTY_SUMMARY}
              myStatus={myEventStatus(e)}
              today={today}
              variant="card"
              onOpen={() => setOpenEventId(e.id)}
              onSetStatus={events.canRsvp ? (s) => events.setStatus(e.id, s) : undefined}
            />
          ))}
        </section>
      )}

      {/* ── Who's staying ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="px-0.5 text-sm font-bold">
          🏡 Who&rsquo;s staying{staying > 0 && <span className="text-muted"> ({staying})</span>}
        </h3>
        {loading ? (
          <SkeletonList />
        ) : upcomingStays.length === 0 && implied.length === 0 ? (
          <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
            <p className="text-sm text-foreground/60">No stays on the calendar yet.</p>
            <p className="mt-1 text-xs text-faint">
              Add yours so the rest of {houseName} knows when you&rsquo;ll be up.
            </p>
          </div>
        ) : (
          <>
            {upcomingStays.map((s) => (
              <StayRow key={s.id} stay={s} today={today} onOpen={() => setOpenStayId(s.id)} />
            ))}
            {/* Derived from an RSVP, never typed by anyone — so it looks different,
                says why it's here, and taps through to the EVENT rather than
                pretending to be an editable stay. */}
            {implied.map((i) => (
              <ImpliedStayRow key={i.id} implied={i} today={today} onOpen={() => setOpenEventId(i.eventId)} />
            ))}
            {/* Built as ONE template string rather than JSX text nodes around
                {houseName}: interleaving an expression with prose renders as
                “MJT Housegoing” the moment a formatter wraps the line between
                them, which is exactly how this read on screen. A template
                literal has no whitespace semantics to get wrong. */}
            {implied.length > 0 && (
              <p className="px-0.5 pt-0.5 text-[11px] text-faint">
                {`Anyone from ${houseName} going to a resort event is counted as staying — even if they’re tenting or in a cabin — along with anyone assigned to ${houseName} who isn’t on the app yet, and any guest a ${houseName} member is bringing. Adding a real stay replaces the RSVP row with your actual dates.`}
              </p>
            )}
          </>
        )}

        {pastStays.length > 0 && (
          <>
            <button
              onClick={() => setShowPast((v) => !v)}
              aria-expanded={showPast}
              className="press px-0.5 pt-1 text-sm font-semibold text-foreground/70"
            >
              Earlier stays ({pastStays.length}) {showPast ? "▾" : "▸"}
            </button>
            {showPast &&
              pastStays.map((s) => (
                <StayRow key={s.id} stay={s} today={today} onOpen={() => setOpenStayId(s.id)} muted />
              ))}
          </>
        )}
      </section>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {composer && (
        <HouseStayComposer
          houseName={houseName}
          memberName={user?.name ?? "You"}
          stay={composer.mode === "edit" ? composer.stay : null}
          onSave={(input) =>
            composer.mode === "edit" ? editStay(composer.stay.id, input) : addStay(input)
          }
          onClose={() => setComposer(null)}
        />
      )}

      {openStay && today && (
        <HouseStaySheet
          stay={openStay}
          today={today}
          canEdit={canEditStay(openStay)}
          onEdit={() => {
            setComposer({ mode: "edit", stay: openStay });
            setOpenStayId(null);
          }}
          onDelete={() => removeStay(openStay.id)}
          onClose={() => setOpenStayId(null)}
        />
      )}

      {openEvent && today && (
        <EventSheet
          event={openEvent}
          summary={events.summaries[openEvent.id] ?? EMPTY_SUMMARY}
          mine={events.mine[openEvent.id] ?? null}
          today={today}
          onSetStatus={(s, days) => events.setStatus(openEvent.id, s, days)}
          onClose={() => setOpenEventId(null)}
          onChanged={events.reload}
        />
      )}

      {openDay && today && (
        <DaySheet
          day={openDay}
          stays={staysByDay[openDay] ?? []}
          implied={implied}
          events={eventsByDay[openDay] ?? []}
          today={today}
          onOpenStay={(id) => {
            setOpenDay(null);
            setOpenStayId(id);
          }}
          onOpenEvent={(id) => {
            setOpenDay(null);
            setOpenEventId(id);
          }}
          onAdd={
            canWrite
              ? () => {
                  setOpenDay(null);
                  setComposer({ mode: "new" });
                }
              : undefined
          }
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

/** One stay in the agenda: label, dates, who's coming, head count, an "on now" tag. */
/**
 * A stay DERIVED from an event RSVP (lib/housePresence) — "Cass is going to the
 * Fall Work Weekend, so Cass will be at the house."
 *
 * ⚠️ Deliberately looks like a cousin of `StayRow`, not a twin: a dashed ring and
 * an "RSVP" chip, because it is a reasonable inference and not something the
 * person actually typed. It taps through to the EVENT — there is no stay row to
 * open, and offering Edit/Delete on a derived row would be a lie. The moment they
 * add a real stay, `impliedStays` drops this and the real one takes over.
 */
function ImpliedStayRow({
  implied,
  today,
  onOpen,
}: {
  implied: ImpliedStay;
  today: string | null;
  onOpen: () => void;
}) {
  const active = today ? implied.startDate <= today && implied.endDate >= today : false;
  const when = today ? relativeDays(today, implied.startDate) : null;
  return (
    <button
      onClick={onOpen}
      className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left ring-1 ring-dashed ring-border transition-shadow hover:shadow-sm"
    >
      <Avatar name={implied.name} url={implied.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          <PrivateName name={implied.name} />
          {active ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              On now
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
              RSVP
            </span>
          )}
        </p>
        <p className="truncate text-xs text-foreground/60">
          {formatDateRange(implied.startDate, implied.endDate)}
          {when && !active && <span className="text-faint"> · {when}</span>}
        </p>
        {/* Why this row exists, named — otherwise it reads as a stay somebody
            forgot they added. The three `via` cases genuinely differ: a member
            said yes themselves, a roster person was added FOR them (they have no
            account to say it with), and a guest is here because a housemate
            vouched for them — "Going to X" would be wrong for the last two. */}
        <p className="truncate text-xs text-muted">
          {implied.via === "guest" && implied.sponsorName
            ? `Guest of ${implied.sponsorName} · ${implied.eventTitle}`
            : implied.via === "roster"
              ? `Added to ${implied.eventTitle}`
              : `Going to ${implied.eventTitle}`}
        </p>
      </div>
      <span className="shrink-0 text-lg leading-none text-foreground/30" aria-hidden>
        ›
      </span>
    </button>
  );
}

function StayRow({
  stay,
  today,
  onOpen,
  muted = false,
}: {
  stay: HouseStay;
  today: string | null;
  onOpen: () => void;
  muted?: boolean;
}) {
  const active = today ? isStayActive(stay, today) : false;
  const when = today ? relativeDays(today, stay.startDate) : null;
  const count = stayHeadCount(stay);
  return (
    <button
      onClick={onOpen}
      className={`press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left ring-1 ring-border transition-shadow hover:shadow-sm ${
        muted ? "opacity-70" : ""
      }`}
    >
      <Avatar name={stay.authorName} url={stay.authorAvatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          {stayLabel(stay)}
          {active && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              On now
            </span>
          )}
        </p>
        <p className="truncate text-xs text-foreground/60">
          {formatDateRange(stay.startDate, stay.endDate)}
          {when && !active && <span className="text-faint"> · {when}</span>}
        </p>
        <p className="truncate text-xs text-muted">
          <PrivateName name={stay.authorName} />
          {count > 1 && ` · ${count} people`}
        </p>
      </div>
      <span className="shrink-0 text-lg leading-none text-foreground/30" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** A single day's roster — who's up + what resort event falls that day. */
function DaySheet({
  day,
  stays,
  implied,
  events,
  today,
  onOpenStay,
  onOpenEvent,
  onAdd,
  onClose,
}: {
  day: string;
  /** Real stays overlapping this day (already filtered by the caller). */
  stays: HouseStay[];
  /** Derived stays overlapping this day — the half this sheet used to ignore. */
  implied: ImpliedStay[];
  events: ResortEvent[];
  today: string;
  onOpenStay: (id: string) => void;
  onOpenEvent: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
}) {
  // One shared derivation for "who's here on this day" — see occupantsOnDay.
  const occupants = occupantsOnDay({ day, stays, implied });
  // Lightweight sheet reusing the shared Sheet primitive via a dynamic import
  // would be overkill; DaySheet builds directly on Sheet like the others.
  const heading = new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <DaySheetShell heading={heading} onClose={onClose} onAdd={onAdd}>
      {events.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Resort events</p>
          {events.map((e) => (
            <button
              key={e.id}
              onClick={() => onOpenEvent(e.id)}
              className="press flex w-full items-center gap-2 rounded-xl bg-card p-2.5 text-left text-sm ring-1 ring-border"
            >
              <span aria-hidden>{e.emoji ?? "🌲"}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
              {isOngoing(e, today) && <span className="shrink-0 text-[10px] font-bold text-accent">now</span>}
            </button>
          ))}
        </div>
      )}
      {/* ⚠️⚠️ This block used to read `stays` only, so tapping Sep 25 said
          "Staying (0) · Nobody's marked a stay for this day yet" while "Who's
          staying" — three inches lower on the same screen — listed five people
          for Sep 25–27. Both were reading the same data; only the list below knew
          that an RSVP to a resort event counts as being at the house. Neither
          derives it now: both call occupantsOnDay(), so they cannot disagree
          again. */}
      <div className="space-y-1.5">
        <p className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
          Staying ({occupants.length})
        </p>
        {occupants.length === 0 ? (
          <p className="px-0.5 text-sm text-muted">Nobody&rsquo;s here on this day yet.</p>
        ) : (
          occupants.map((o) =>
            o.kind === "stay" ? (
              <button
                key={o.key}
                onClick={() => {
                  const match = stays.find((s) => `stay:${s.id}` === o.key);
                  if (match) onOpenStay(match.id);
                }}
                className="press flex w-full items-center gap-2 rounded-xl bg-card p-2.5 text-left ring-1 ring-border"
              >
                <Avatar name={o.name} url={o.avatarUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <PrivateName name={o.name} />
                  </span>
                  {o.guestNames.length > 0 && (
                    <span className="block truncate text-xs text-muted">
                      with {o.guestNames.join(", ")}
                    </span>
                  )}
                </span>
              </button>
            ) : (
              // Derived from an RSVP — dashed ring + an "RSVP" chip, matching
              // ImpliedStayRow below, and taps through to the EVENT (there's no
              // stay row to open).
              <button
                key={o.key}
                onClick={() => {
                  const match = implied.find((i) => i.id === o.key);
                  if (match) onOpenEvent(match.eventId);
                }}
                className="press flex w-full items-center gap-2 rounded-xl bg-card p-2.5 text-left ring-1 ring-dashed ring-border"
              >
                <Avatar name={o.name} url={o.avatarUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium">
                      <PrivateName name={o.name} />
                    </span>
                    <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                      RSVP
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {o.via === "guest" && o.sponsorName
                      ? `Guest of ${o.sponsorName} · ${o.eventTitle}`
                      : o.via === "roster"
                        ? `Added to ${o.eventTitle}`
                        : `Going to ${o.eventTitle}`}
                  </span>
                </span>
              </button>
            ),
          )
        )}
      </div>
    </DaySheetShell>
  );
}

// A tiny wrapper so DaySheet can use the shared Sheet dismiss animation without
// duplicating the useSheetDismiss wiring inline (keeps the hook at the top level).
function DaySheetShell({
  heading,
  onAdd,
  onClose,
  children,
}: {
  heading: string;
  onAdd?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="day-sheet-title"
      header={
        <h2 id="day-sheet-title" className="pr-8 text-lg font-bold">
          {heading}
        </h2>
      }
      footer={
        onAdd ? (
          <button
            onClick={() => {
              onAdd();
            }}
            className="press w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
          >
            + Add my stay
          </button>
        ) : undefined
      }
    >
      {children}
    </Sheet>
  );
}
