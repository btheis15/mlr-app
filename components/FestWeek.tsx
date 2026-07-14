"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatDateLong, formatTime } from "@/lib/format";
import { eventsForDay, dinnerForDay } from "@/lib/schedule";
import { eventDays } from "@/lib/events";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { DinnerDetailsEditSheet } from "@/components/DinnerDetailsEditSheet";
import { DinnerSheet, ScheduleSheet } from "@/components/FestPlanner";
import { useIdentity } from "@/components/IdentityProvider";
import { getCurrentUserId } from "@/lib/roles";
import {
  canEditFest,
  fetchMemberOptions,
  fetchDinnerDrafts,
  fetchScheduleDrafts,
  type FestMemberOption,
  type DinnerDraft,
  type ScheduleDraft,
} from "@/lib/festContent";
import type { ScheduleEvent, Dinner, FestActivity } from "@/lib/types";

/**
 * The week at a glance: anytime "things to do", then every day as a card that
 * shows its events + that night's dinner. Each event and the dinner expands
 * IN PLACE to its full detail (location, about, what-to-bring, lead / chef,
 * menu, crew) — no drilling into a separate page. During the live week, today
 * is omitted here (FestStatus shows it in full up top).
 */
export function FestWeek({
  events,
  dinners,
  things,
  startDate,
  endDate,
  onContentSaved,
}: {
  events: ScheduleEvent[];
  dinners: Dinner[];
  things: FestActivity[];
  startDate: string;
  endDate: string;
  /** Called after any edit saves from an EventRow/DinnerRow, so the caller's
   *  own useFestContent() instance re-fetches (see migration 0099 — FestWeek
   *  is handed `dinners`/`events` as props, so it can't refresh itself). */
  onContentSaved?: () => void;
}) {
  const season = useFestSeason(startDate, endDate);
  const { today } = useDemoDate();
  const { user } = useIdentity();
  const [uid, setUid] = useState<string | null>(null);
  const [canEditAll, setCanEditAll] = useState(false);
  // Full-access editors (admins/committee) can edit ANYTHING on this view —
  // not just the chef/crew-scoped dinner details — by reusing the Planner's
  // own DinnerSheet/ScheduleSheet in place. Those need the member directory +
  // the full drafts (with `position`, which the display Dinner/ScheduleEvent
  // types don't carry), so they're only fetched once canEditAll is known true
  // — a plain chef/crew self-editor or a regular member never pays for this.
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [dinnerDrafts, setDinnerDrafts] = useState<DinnerDraft[]>([]);
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>([]);
  // The full fest date range, for the day picker inside DinnerSheet/
  // ScheduleSheet — distinct from `days` below (only the days that actually
  // have content, used to render the accordion sections).
  const festDayOptions = eventDays(startDate, endDate);

  const reloadAdminData = useCallback(() => {
    fetchMemberOptions().then(setMembers);
    fetchDinnerDrafts().then(setDinnerDrafts);
    fetchScheduleDrafts().then(setScheduleDrafts);
  }, []);

  useEffect(() => {
    if (!user) {
      setUid(null);
      setCanEditAll(false);
      return;
    }
    let active = true;
    getCurrentUserId().then((id) => active && setUid(id));
    canEditFest().then((ok) => {
      if (!active) return;
      setCanEditAll(ok);
      if (ok) reloadAdminData();
    });
    return () => {
      active = false;
    };
  }, [user, reloadAdminData]);

  const onSaved = () => {
    onContentSaved?.();
    if (canEditAll) reloadAdminData();
  };

  const allDays = Array.from(
    new Set([...events.map((e) => e.day), ...dinners.map((d) => d.day)]),
  ).sort();
  // While live, today is shown in full by FestStatus above — drop it here.
  const days = season?.isLive ? allDays.filter((d) => d !== today) : allDays;

  return (
    <section className="space-y-3">
      {things.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">🗺️ Anytime all week</h2>
          {things.map((a, i) => (
            <div
              key={a.id}
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
              className="rise rounded-2xl bg-card p-4 ring-1 ring-border"
            >
              <p className="text-sm font-semibold">
                {a.emoji} {a.title}
              </p>
              <p className="mt-0.5 text-xs text-foreground/70">{a.blurb}</p>
              {a.details && (
                <p className="mt-1 text-xs leading-relaxed text-foreground/60">{a.details}</p>
              )}
              {a.location && (
                <p className="mt-1 text-xs text-foreground/50">
                  📍 <Protected label="Sign in for location">{a.location}</Protected>
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {days.length > 0 && (
        <h2 className="text-sm font-semibold text-primary">
          {season?.isLive ? "The rest of the week" : "The whole week"}
        </h2>
      )}

      <div className="space-y-3">
        {days.map((day, i) => {
          const dayEvents = eventsForDay(events, day);
          const dinner = dinnerForDay(dinners, day);
          return (
            <div
              key={day}
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
              className="rise overflow-hidden rounded-2xl bg-card ring-1 ring-border"
            >
              <div className="border-b border-border/60 px-4 py-2.5">
                <p className="text-sm font-semibold">{formatDateLong(day)}</p>
              </div>
              <ul>
                {dayEvents.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    canEditAll={canEditAll}
                    draft={scheduleDrafts.find((d) => d.id === e.id) ?? null}
                    days={festDayOptions}
                    members={members}
                    onSaved={onSaved}
                  />
                ))}
                {dinner && (
                  <DinnerRow
                    dinner={dinner}
                    uid={uid}
                    canEditAll={canEditAll}
                    draft={dinnerDrafts.find((d) => d.id === dinner.id) ?? null}
                    days={festDayOptions}
                    members={members}
                    onSaved={onSaved}
                  />
                )}
                {dayEvents.length === 0 && !dinner && (
                  <li className="px-4 py-3 text-xs text-foreground/45">Nothing scheduled yet.</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// MARK: - Expander (smooth auto-height reveal, matches CollapsibleSection)

function Expander({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">
        <div
          inert={!open}
          className={`min-h-0 transition-opacity duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// MARK: - Expandable rows

function RowChevron({ open }: { open: boolean }) {
  return (
    <span
      className={`shrink-0 text-foreground/40 transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden
    >
      ›
    </span>
  );
}

function EventRow({
  event,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  event: ScheduleEvent;
  canEditAll: boolean;
  draft: ScheduleDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <li className="border-b border-border/50 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-lg">{event.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{event.title}</p>
          <p className="text-xs text-foreground/50">{formatTime(event.start)}</p>
        </div>
        <RowChevron open={open} />
      </button>
      <Expander open={open}>
        {/* pt-1: the edit pill's `ring-1` bleeds ~1px outside its own box
            (Tailwind's ring isn't inset by default) — with zero top padding
            here it got clipped by Expander's `overflow-hidden` (needed for
            the collapse animation), reading as the pill's top edge being cut
            off. Every other row here starts with plain text/no ring, so this
            never showed up until an edit button became the first child. */}
        <div className="space-y-3 px-4 pb-4 pt-1">
          {canEditAll && draft && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
            >
              ✏️ Edit this event
            </button>
          )}
          <p className="text-xs text-foreground/60">
            📍 <Protected label="Sign in for location">{event.location}</Protected>
          </p>
          {event.description && (
            <p className="text-sm leading-relaxed text-foreground/80">{event.description}</p>
          )}
          {event.bring && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                What to bring
              </p>
              <p className="mt-0.5 text-sm text-foreground/80">{event.bring}</p>
            </div>
          )}
          {event.lead && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-foreground/40">In charge</p>
              <p className="mt-0.5 text-sm font-semibold">
                <PrivateName name={event.lead.name} />
              </p>
              <div className="mt-2">
                <CallTextButtons phone={event.lead.phone} />
              </div>
            </div>
          )}
        </div>
      </Expander>
      {editing && draft && (
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
    </li>
  );
}

function DinnerRow({
  dinner,
  uid,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  dinner: Dinner;
  uid: string | null;
  canEditAll: boolean;
  draft: DinnerDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEditThis = canEditAll || Boolean(uid && (dinner.chefUserId === uid || dinner.crewUserIds.includes(uid)));
  // Full-access editors get the Planner's own full DinnerSheet in place (day/
  // title/chef/crew/houses/menu/served/prep); a chef/crew self-editor gets
  // the narrower DinnerDetailsEditSheet (menu/served/prep only) instead.
  const fullEdit = canEditAll && Boolean(draft);
  return (
    <li className="border-b border-border/50 bg-primary/5 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-lg">{dinner.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Dinner · {dinner.title}</p>
          <p className="text-xs text-foreground/50">{formatTime(dinner.time)}</p>
        </div>
        <RowChevron open={open} />
      </button>
      <Expander open={open}>
        {/* pt-1: see the matching note in EventRow — the ring-bordered edit
            pill's box-shadow was getting clipped at the top by Expander's
            overflow-hidden with zero top padding here. */}
        <div className="space-y-3 px-4 pb-4 pt-1">
          {canEditThis && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
            >
              ✏️ Edit this dinner
            </button>
          )}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
              On the menu
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground/80">{dinner.menu}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DinnerTile
              emoji="🍽️"
              label="Served"
              value={formatTime(dinner.time)}
              sub={<Protected label="Sign in for location">{dinner.location}</Protected>}
            />
            <DinnerTile
              emoji="⏱️"
              label="Crew preps"
              value={formatTime(dinner.prepTime)}
              sub={
                <Protected label="Sign in for location">
                  {dinner.prepLocation ?? dinner.location}
                </Protected>
              }
            />
          </div>

          {dinner.houses.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                Houses on crew
              </p>
              <div className="mt-1">
                <Protected label="Sign in to see which families are cooking">
                  <div className="flex flex-wrap gap-1.5">
                    {dinner.houses.map((house) => (
                      <span
                        key={house}
                        className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
                      >
                        {house}
                      </span>
                    ))}
                  </div>
                </Protected>
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wide text-foreground/40">
              Head chef of the day
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              <PrivateName name={dinner.chef.name} />
            </p>
            <div className="mt-2">
              <CallTextButtons phone={dinner.chef.phone} />
            </div>
          </div>
        </div>
      </Expander>
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
        <DinnerDetailsEditSheet
          dinner={dinner}
          onClose={() => setEditing(false)}
          onSaved={onSaved}
        />
      )}
    </li>
  );
}

function DinnerTile({
  emoji,
  label,
  value,
  sub,
}: {
  emoji: string;
  label: string;
  value: string;
  sub: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-background/60 p-3 ring-1 ring-border/60">
      <div className="text-lg">{emoji}</div>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-foreground/40">{label}</p>
      <p className="text-sm font-bold text-primary">{value}</p>
      <p className="text-xs text-foreground/60">{sub}</p>
    </div>
  );
}
