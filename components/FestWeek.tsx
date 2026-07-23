"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useFestSeason } from "@/lib/useFestSeason";
import { formatDateLong, formatTime, formatEventTime } from "@/lib/format";
import { eventsForDay, dinnerForDay } from "@/lib/schedule";
import { eventDays } from "@/lib/events";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { DinnerDetailsEditSheet } from "@/components/DinnerDetailsEditSheet";
import { ScheduleDetailsEditSheet } from "@/components/ScheduleDetailsEditSheet";
import { DinnerSheet, ScheduleSheet } from "@/components/FestPlanner";
import { ScheduleSignupSlots } from "@/components/ScheduleSignupSlots";
import { TournamentSection } from "@/components/TournamentView";
import { useIdentity } from "@/components/IdentityProvider";
import { useCachedResource } from "@/lib/swrCache";
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
 * The week at a glance: anytime "things to do", then every day as a card that
 * shows its events + that night's dinner. Each event and the dinner expands
 * IN PLACE to its full detail (location, about, what-to-bring, lead / chef,
 * menu, crew) — no drilling into a separate page. Today stays listed here too
 * even during the live week (FestStatus additionally shows it in full up top,
 * with its own edit affordance) — so the day-by-day list is always complete
 * and always has its edit controls, not just "the rest of the week".
 */
export function FestWeek({
  events,
  dinners,
  startDate,
  endDate,
  onContentSaved,
}: {
  events: ScheduleEvent[];
  dinners: Dinner[];
  startDate: string;
  endDate: string;
  /** Called after any edit saves from an EventRow/DinnerRow, so the caller's
   *  own useFestContent() instance re-fetches (see migration 0099 — FestWeek
   *  is handed `dinners`/`events` as props, so it can't refresh itself). */
  onContentSaved?: () => void;
}) {
  const season = useFestSeason(startDate, endDate);
  const { user, userId } = useIdentity();
  // Real session uid drives the chef/crew self-edit checks (no async round-trip).
  const uid = userId;
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

  // Cached edit-permission — seeds the last-known value instantly (memory across
  // tab switches, persisted across cold opens) so the Edit affordances don't pop
  // in a frame or two late while the can_edit_fest RPC re-resolves each visit.
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

  // Once we know the viewer can edit, pull the Planner drafts + member list.
  useEffect(() => {
    if (canEditAll) reloadAdminData();
  }, [canEditAll, reloadAdminData]);

  const onSaved = () => {
    onContentSaved?.();
    if (canEditAll) reloadAdminData();
  };

  // Anytime events (migrations 0139/0141 — the old "activities" are now anytime
  // events too) aren't locked to a day; they render in the "Anytime all week"
  // group, not in any day card.
  const anytimeEvents = events.filter((e) => e.anytime);
  const dayEventsAll = events.filter((e) => !e.anytime);
  const days = Array.from(
    new Set([...dayEventsAll.map((e) => e.day), ...dinners.map((d) => d.day)]),
  ).sort();

  return (
    <section className="space-y-3">
      {anytimeEvents.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">🗺️ Anytime all week</h2>
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <ul>
              {anytimeEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  uid={uid}
                  canEditAll={canEditAll}
                  draft={scheduleDrafts.find((d) => d.id === e.id) ?? null}
                  days={festDayOptions}
                  members={members}
                  onSaved={onSaved}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {days.length > 0 && (
        <h2 className="text-sm font-semibold text-primary">
          The whole week
        </h2>
      )}

      <div className="space-y-3">
        {days.map((day, i) => {
          const dayEvents = eventsForDay(dayEventsAll, day);
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
                    uid={uid}
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
  uid,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  event: ScheduleEvent;
  uid: string | null;
  canEditAll: boolean;
  draft: ScheduleDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEditThis =
    canEditAll || Boolean(uid && (event.leadUserId === uid || (event.crewUserIds ?? []).includes(uid)));
  // Full-access editors get the Planner's own full ScheduleSheet in place
  // (day/title/time/lead/crew/details); a lead/crew self-editor gets the
  // narrower ScheduleDetailsEditSheet (location/details/bring only) instead.
  const fullEdit = canEditAll && Boolean(draft);
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
          <p className="text-xs text-foreground/50">{formatEventTime(event)}</p>
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
          <p className="text-sm font-medium leading-snug">{event.title}</p>
          {canEditThis && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
            >
              ✏️ Edit this event
            </button>
          )}
          {event.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.imageUrl} alt="" className="max-h-56 w-full rounded-xl object-cover" />
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
          {(event.links ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {event.links!.map((l, i) => (
                <a
                  key={i}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-block rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  🔗 {l.label?.trim() || "Open link"}
                </a>
              ))}
            </div>
          )}
          {event.signupEnabled && (
            <ScheduleSignupSlots target={event} kind="schedule" canManage={canEditThis} members={members} />
          )}
          {/* Only mount when the row is open — Expander keeps its children in the
              DOM while collapsed, and we don't want a realtime channel per row. */}
          {open && event.tournamentEnabled && (
            <TournamentSection host={{ kind: "schedule", id: event.id }} canManage={canEditThis} itemTitle={event.title} enabled />
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
          event={event}
          onClose={() => setEditing(false)}
          onSaved={onSaved}
        />
      )}
    </li>
  );
}

export function DinnerRow({
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
    <li className="border-b border-border/50 last:border-0">
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
          <p className="text-sm font-medium leading-snug">Dinner · {dinner.title}</p>
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
