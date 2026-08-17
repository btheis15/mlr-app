"use client";

import { useEffect, useState } from "react";
import type { AttendanceStatus, AttendanceSummary, EventAttendance, House, ResortEvent, WorkItem } from "@/lib/types";
import { formatDateLong, formatDateRange, relativeDays } from "@/lib/format";
import { deleteEvent, effectiveStatus, eventDays, goingByDay, isOngoing, myGoingDays } from "@/lib/events";
import {
  fetchEventWorkItems,
  fetchEventWorkItemHouseCounts,
  removeWorkItemFromEvent,
  groupWorkItemsByScope,
  type EventWorkItemHouseCount,
} from "@/lib/workItems";
import { fetchHouses } from "@/lib/houses";
import { Avatar } from "@/components/Avatar";
import { PrivateName, Protected, useGuest } from "@/components/Guard";
import { AttendanceControl } from "@/components/AttendanceControl";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { WorkItemComposer } from "@/components/WorkItemComposer";
import { EventWorkItemPicker } from "@/components/EventWorkItemPicker";
import { EventMessageSheet } from "@/components/EventMessageSheet";
import { useSheetDismiss } from "@/lib/hooks";

// The event detail sheet: dates, location, description, the RSVP control, and
// who's coming. An admin OR the event's own creator (`canManage`, migration
// 0187) can edit/delete a real (DB) event and assign work items to it — its
// "+ Add" button opens EventWorkItemPicker to pick from EXISTING open
// checklist items (with a "create a new item instead" escape hatch), not just
// create-a-new-one — and each linked item gets a ✕ to unlink it from the event
// (migration 0188's remove_work_item_from_event; never deletes the item
// itself). Scaffolding + dismiss motion come from Sheet / useSheetDismiss.

export function EventSheet({
  event,
  summary,
  mine,
  today,
  onSetStatus,
  onClose,
  canManage = false,
  onEdit,
  onChanged,
  initialDay = null,
}: {
  event: ResortEvent;
  summary: AttendanceSummary;
  /** The viewer's own RSVP row for this event, or null. */
  mine: EventAttendance | null;
  today: string;
  /** Write the viewer's RSVP (parent handles guest sign-in / optimistic update).
   *  Return (or resolve to) `false` on failure so `AttendanceControl` can show
   *  an inline retry message. */
  onSetStatus: (status: AttendanceStatus, days?: Record<string, AttendanceStatus> | null) => void | Promise<boolean>;
  onClose: () => void;
  canManage?: boolean;
  /** Open the admin composer to edit this event (real DB events only). */
  onEdit?: () => void;
  /** Reload the parent after a delete. */
  onChanged?: () => void;
  /** Pre-select a day in the "Who's coming" breakdown (deep-link from a day chip). */
  initialDay?: string | null;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  // Guests can't read event_attendance (RLS lockdown, 0081) — their summary is
  // an empty roster, so the "Who's coming" section and the per-day tallies
  // would read as a false "no RSVPs yet". Show a sign-in affordance instead
  // (RSVP taps already route through promptSignIn via useEvents.setStatus).
  const { guest, promptSignIn } = useGuest();
  const [deleting, setDeleting] = useState(false);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  // Counts (not details) for a house's work items even when the viewer can't
  // see the items themselves — a house-scoped item is RLS-gated to that
  // house's members + admins, so a non-member's `workItems` fetch already
  // silently drops those rows. This is the only way to still show "MJT House
  // has 2 items planned" instead of the section just vanishing (0189).
  const [houseCounts, setHouseCounts] = useState<EventWorkItemHouseCount[]>([]);
  const [addingWorkItem, setAddingWorkItem] = useState(false);
  const [pickingWorkItems, setPickingWorkItems] = useState(false);
  const [emailingEveryone, setEmailingEveryone] = useState(false);

  const reloadWorkItems = () => {
    fetchEventWorkItems(event.id).then(setWorkItems);
    fetchEventWorkItemHouseCounts(event.id).then(setHouseCounts);
  };

  useEffect(() => {
    reloadWorkItems();
    fetchHouses().then(setHouses);
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sections in position order (shared with WorkChecklist's own grouping) —
  // "🌲 Around the Resort" first, then each house that has VISIBLE items.
  const workItemSections = groupWorkItemsByScope(workItems, houses);
  // A house the viewer has a count for but no visible items in isn't one
  // they're a member of — show its count, not its (invisible) details. Order
  // is inherited from houseCounts, which the 0189 RPC already returns by
  // house position.
  const visibleHouseIds = new Set(workItems.filter((i) => i.houseId !== null).map((i) => i.houseId as string));
  const hiddenHouseCounts = houseCounts.filter((hc) => !visibleHouseIds.has(hc.houseId));
  const days = eventDays(event.startDate, event.endDate);
  const showDays = event.dayRsvp && days.length > 1;
  const myEffective = mine ? effectiveStatus(mine.status, mine.days) : null;
  // "Who's coming" can be filtered to one day's participants (null = everyone).
  const [dayFilter, setDayFilter] = useState<string | null>(initialDay);

  // Per-day going roster (visible to everyone) + the viewer's own going days.
  const byDay = showDays ? goingByDay(summary.going, days) : {};
  const mineDays = showDays ? myGoingDays(mine, days) : new Set<string>();
  const allDays = mineDays.size === days.length;

  // Toggle one day on/off for the viewer. Tapping from no-RSVP marks just that day;
  // all days selected collapses back to a plain "going" (no per-day map = whole
  // week); none selected means they're not coming. We roll per-day picks up to the
  // overall status so the overview/counts stay in sync.
  const toggleDay = (day: string) => {
    const next = new Set(mineDays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    if (next.size === 0) return onSetStatus("not_going", null);
    if (next.size === days.length) return onSetStatus("going", null);
    onSetStatus(
      "going",
      Object.fromEntries(
        days.map((d) => [d, (next.has(d) ? "going" : "not_going") as AttendanceStatus]),
      ),
    );
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${event.title}"? This removes everyone's RSVPs for it.`)) return;
    setDeleting(true);
    await deleteEvent(event.id);
    setDeleting(false);
    onChanged?.();
    close();
  };

  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const removeWorkItem = async (item: WorkItem) => {
    if (!window.confirm(`Remove "${item.title}" from this event? The item itself stays on the checklist.`)) return;
    setRemovingItemId(item.id);
    const prev = workItems;
    setWorkItems((cur) => cur.filter((i) => i.id !== item.id));
    const { error } = await removeWorkItemFromEvent(event.id, item.id);
    setRemovingItemId(null);
    if (error) {
      setWorkItems(prev);
      return;
    }
    // Keep houseCounts in lockstep — otherwise removing a house-scoped item's
    // last visible row flips that section straight into a stale "🔒 N items
    // planned" line for the very person who could see it a moment ago.
    fetchEventWorkItemHouseCounts(event.id).then(setHouseCounts);
  };

  const when = isOngoing(event, today) ? "Happening now" : relativeDays(today, event.startDate);

  const renderWorkItemRow = (item: WorkItem) => (
    <div key={item.id} className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
          item.status === "done" ? "bg-primary/15 text-primary" : "border-2 border-border"
        }`}
        aria-hidden
      >
        {item.status === "done" ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium leading-snug ${item.status === "done" ? "text-faint line-through" : ""}`}>
          {item.title}
        </span>
        {item.peopleNeeded != null && (
          <span className="mt-0.5 block text-xs text-faint">👥 {item.peopleNeeded} needed</span>
        )}
      </span>
      {canManage && (
        <button
          type="button"
          onClick={() => removeWorkItem(item)}
          disabled={removingItemId === item.id}
          aria-label={`Remove ${item.title} from this event`}
          className="press shrink-0 text-foreground/30 hover:text-accent disabled:opacity-40"
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <>
    {pickingWorkItems && (
      <EventWorkItemPicker
        eventId={event.id}
        alreadyLinkedIds={new Set(workItems.map((i) => i.id))}
        onClose={() => setPickingWorkItems(false)}
        onLinked={reloadWorkItems}
        onCreateNew={() => { setPickingWorkItems(false); setAddingWorkItem(true); }}
      />
    )}
    {addingWorkItem && (
      <WorkItemComposer
        preLinkedEventId={event.id}
        onClose={() => setAddingWorkItem(false)}
        onSaved={() => { setAddingWorkItem(false); reloadWorkItems(); }}
      />
    )}
    {emailingEveryone && (
      <EventMessageSheet
        event={event}
        workItems={workItems}
        hiddenHouseItemCount={hiddenHouseCounts.reduce((n, hc) => n + hc.count, 0)}
        onClose={() => setEmailingEveryone(false)}
      />
    )}
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="event-sheet-title"
      header={
        <>
          <h2 id="event-sheet-title" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden>{event.emoji ?? "📅"}</span>
            {event.title}
          </h2>
          <p className="text-sm text-foreground/60">
            {formatDateRange(event.startDate, event.endDate)}
            {when && <span className="font-medium text-accent"> · {when}</span>}
          </p>
        </>
      }
      footer={
        canManage && event.persisted ? (
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="press flex-1 rounded-xl bg-card py-2.5 text-sm font-semibold text-foreground ring-1 ring-border"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="press flex-1 rounded-xl bg-accent/10 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent/20 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        ) : undefined
      }
    >
      {(event.endDate && event.endDate !== event.startDate) && (
            <p className="text-xs text-muted">{formatDateLong(event.startDate)} → {formatDateLong(event.endDate)}</p>
          )}

          {event.location && (
            <p className="text-sm text-foreground/70">
              📍 <Protected label="Sign in for location">{event.location}</Protected>
            </p>
          )}

          {event.description && <p className="text-sm text-foreground/70">{event.description}</p>}

          {/* RSVP */}
          <div className="space-y-2">
            <SectionLabel>Are you coming?</SectionLabel>
            <AttendanceControl
              value={myEffective}
              onChange={(s) => onSetStatus(s, null)}
              hideMaybe={event.dayRsvp}
            />

            {showDays && (
              <p className="px-0.5 pt-0.5 text-xs text-muted">
                <span className="font-medium text-primary">Going</span> signs you up for all {days.length} days.
                Only around part of the week? Just tap the days you&rsquo;ll be there.
              </p>
            )}
          </div>

          {/* Per-day breakdown — interactive day toggles + counts everyone can see */}
          {showDays && (
            <div className="space-y-2">
              <SectionLabel>
                {mineDays.size === 0
                  ? "Pick your days"
                  : allDays
                    ? "You’re here all week"
                    : `You’re here ${mineDays.size} of ${days.length} days`}
              </SectionLabel>
              <div className="grid grid-flow-col auto-cols-[minmax(54px,1fr)] gap-1.5 overflow-x-auto pb-1">
                {days.map((day) => {
                  const d = new Date(`${day}T00:00:00`);
                  const count = byDay[day]?.length ?? 0;
                  const on = mineDays.has(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={on}
                      aria-label={`${formatDateLong(day)}${guest ? "" : ` — ${count} going`}. ${on ? "You’re here" : "Tap if you’ll be here"}.`}
                      className={`press flex flex-col items-center gap-0.5 rounded-xl py-2 ring-1 ${
                        on ? "bg-primary text-white ring-primary" : "bg-card text-foreground/70 ring-border"
                      }`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
                        {d.toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                      <span className="text-base font-bold leading-none">{d.getDate()}</span>
                      {/* Guests can't see attendance, so a per-day "0" would be
                          a lie — hide the tally until they sign in. */}
                      {!guest && (
                        <span
                          className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold ${
                            on ? "text-white/85" : count > 0 ? "text-primary" : "text-foreground/35"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white/80" : count > 0 ? "bg-primary" : "bg-foreground/25"}`}
                            aria-hidden
                          />
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="px-0.5 text-xs text-faint">
                {guest
                  ? "Tap the days you’ll be here — we’ll ask you to sign in first."
                  : "Numbers show how many are here each day · tap a day to add or drop it."}
              </p>
            </div>
          )}

          {/* Work items planned for this event — grouped by scope. A house's
              items are only visible to that house's members + admins (RLS,
              0066); for everyone else a house with items shows only a count
              (hiddenHouseCounts), never the titles. */}
          {(workItems.length > 0 || hiddenHouseCounts.length > 0 || canManage) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionLabel>Work items planned</SectionLabel>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setPickingWorkItems(true)}
                    className="press text-xs font-semibold text-primary"
                  >
                    + Add
                  </button>
                )}
              </div>

              {workItemSections.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <p className="px-0.5 text-xs font-semibold text-foreground/60">
                    {s.emoji} {s.title}
                  </p>
                  <div className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border">
                    {s.items.map(renderWorkItemRow)}
                  </div>
                </div>
              ))}

              {hiddenHouseCounts.map((hc) => (
                <p
                  key={hc.houseId}
                  className="rounded-xl bg-card px-3 py-2.5 text-xs text-muted ring-1 ring-border"
                >
                  🔒 {hc.emoji} {hc.name} · {hc.count} item{hc.count === 1 ? "" : "s"} planned — details only
                  visible to that house
                </p>
              ))}

              {workItemSections.length === 0 && hiddenHouseCounts.length === 0 && (
                <p className="text-xs text-faint">No work items yet.</p>
              )}
            </div>
          )}

          {/* Email everyone about this event — the event's details plus the work
              items planned for it, laid out by the mini's mailer (0190). Same
              admin-or-creator gate as everything else in this sheet. */}
          {canManage && event.persisted && (
            <button
              type="button"
              onClick={() => setEmailingEveryone(true)}
              className="press flex w-full items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-primary">📣 Email everyone about this</span>
                <span className="block text-xs text-muted">
                  A laid-out email with the details and everything planned.
                </span>
              </span>
              <span aria-hidden className="shrink-0 text-foreground/40">›</span>
            </button>
          )}

          {/* Who's coming */}
          <div className="space-y-2">
            <SectionLabel>Who&rsquo;s coming</SectionLabel>
            {guest ? (
              // Guests can't read the roster (members-only under RLS) — an
              // honest sign-in nudge instead of a false "No RSVPs yet".
              <button
                type="button"
                onClick={promptSignIn}
                className="press w-full rounded-xl bg-card px-3 py-3 text-left text-sm text-foreground/60 ring-1 ring-border"
              >
                🔒 Sign in to see who&rsquo;s coming — and RSVP yourself.
              </button>
            ) : summary.counts.going === 0 && summary.counts.maybe === 0 && summary.counts.notGoing === 0 ? (
              <p className="text-sm text-faint">No RSVPs yet.</p>
            ) : showDays ? (
              <div className="space-y-3">
                {/* Filter the roster to a single day's participants. */}
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  <DayFilterPill
                    label="Everyone"
                    count={summary.counts.going}
                    active={dayFilter === null}
                    onClick={() => setDayFilter(null)}
                  />
                  {days.map((day) => {
                    const d = new Date(`${day}T00:00:00`);
                    return (
                      <DayFilterPill
                        key={day}
                        label={`${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`}
                        count={byDay[day]?.length ?? 0}
                        active={dayFilter === day}
                        onClick={() => setDayFilter(day)}
                      />
                    );
                  })}
                </div>
                {dayFilter === null ? (
                  <div className="space-y-3">
                    <RosterGroup label="Going" dotClass="bg-primary" people={summary.going} />
                    <RosterGroup label="Can’t make" dotClass="bg-foreground/30" people={summary.notGoing} />
                  </div>
                ) : (
                  <RosterGroup
                    label={`Here ${formatDateLong(dayFilter)}`}
                    dotClass="bg-primary"
                    people={byDay[dayFilter] ?? []}
                    emptyText="No one’s marked this day yet."
                  />
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <RosterGroup label="Going" dotClass="bg-primary" people={summary.going} />
                <RosterGroup label="Maybe" dotClass="bg-sun" people={summary.maybe} />
                <RosterGroup label="Can’t make" dotClass="bg-foreground/30" people={summary.notGoing} />
              </div>
            )}
          </div>
    </Sheet>
    </>
  );
}

/** A scrollable day chip that filters the roster below. Shows its going count;
 *  the active one fills with the primary color. */
function DayFilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
        active ? "bg-primary text-white ring-primary" : "bg-card text-foreground/65 ring-border"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[10px] ${
          active ? "bg-white/25 text-white" : "bg-background text-foreground/55"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function RosterGroup({
  label,
  dotClass,
  people,
  emptyText,
}: {
  label: string;
  dotClass: string;
  people: EventAttendance[];
  /** When set, render the header + this message instead of nothing on an empty group. */
  emptyText?: string;
}) {
  if (people.length === 0 && !emptyText) return null;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
        {label}{people.length > 0 && ` · ${people.length}`}
      </p>
      {people.length === 0 ? (
        <p className="text-sm text-faint">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <span
              key={p.userId}
              className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pl-1 pr-2.5 ring-1 ring-border"
              title={p.confirmed ? undefined : "Said available in a poll — hasn't confirmed for this event yet"}
            >
              <Avatar name={p.name} url={p.avatarUrl} size={20} />
              <PrivateName name={p.name} className="text-xs font-medium" />
              {!p.confirmed && <span className="text-[10px] text-muted">(hasn&rsquo;t confirmed)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
