"use client";

import { useState } from "react";
import type { AttendanceStatus, AttendanceSummary, EventAttendance, ResortEvent } from "@/lib/types";
import { formatDateLong, formatDateRange, relativeDays } from "@/lib/format";
import { deleteEvent, effectiveStatus, eventDays, goingByDay, isOngoing, myGoingDays } from "@/lib/events";
import { Avatar } from "@/components/Avatar";
import { PrivateName, Protected } from "@/components/Guard";
import { AttendanceControl } from "@/components/AttendanceControl";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

// The event detail sheet: dates, location, description, the RSVP control, an
// optional per-day drill-down (Family Fest), and who's coming. Admins can edit or
// delete a real (DB) event. Scaffolding + dismiss motion come from Sheet /
// useSheetDismiss.

export function EventSheet({
  event,
  summary,
  mine,
  today,
  onSetStatus,
  onClose,
  isAdmin = false,
  onEdit,
  onChanged,
}: {
  event: ResortEvent;
  summary: AttendanceSummary;
  /** The viewer's own RSVP row for this event, or null. */
  mine: EventAttendance | null;
  today: string;
  /** Write the viewer's RSVP (parent handles guest sign-in / optimistic update). */
  onSetStatus: (status: AttendanceStatus, days?: Record<string, AttendanceStatus> | null) => void;
  onClose: () => void;
  isAdmin?: boolean;
  /** Open the admin composer to edit this event (real DB events only). */
  onEdit?: () => void;
  /** Reload the parent after a delete. */
  onChanged?: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [deleting, setDeleting] = useState(false);
  const days = eventDays(event.startDate, event.endDate);
  const showDays = event.dayRsvp && days.length > 1;
  const myEffective = mine ? effectiveStatus(mine.status, mine.days) : null;

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

  const when = isOngoing(event, today) ? "Happening now" : relativeDays(today, event.startDate);

  return (
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
        isAdmin && event.persisted ? (
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
            <p className="text-xs text-foreground/55">{formatDateLong(event.startDate)} → {formatDateLong(event.endDate)}</p>
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
              <p className="px-0.5 pt-0.5 text-xs text-foreground/55">
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
                      aria-label={`${formatDateLong(day)} — ${count} going. ${on ? "You’re here" : "Tap if you’ll be here"}.`}
                      className={`press flex flex-col items-center gap-0.5 rounded-xl py-2 ring-1 ${
                        on ? "bg-primary text-white ring-primary" : "bg-card text-foreground/70 ring-border"
                      }`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
                        {d.toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                      <span className="text-base font-bold leading-none">{d.getDate()}</span>
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
                    </button>
                  );
                })}
              </div>
              <p className="px-0.5 text-[11px] text-foreground/45">
                Numbers show how many are here each day · tap a day to add or drop it.
              </p>
            </div>
          )}

          {/* Who's coming */}
          <div className="space-y-2">
            <SectionLabel>Who&rsquo;s coming</SectionLabel>
            {summary.counts.going === 0 && summary.counts.maybe === 0 && summary.counts.notGoing === 0 ? (
              <p className="text-sm text-foreground/45">No RSVPs yet.</p>
            ) : (
              <div className="space-y-3">
                <RosterGroup label="Going" dotClass="bg-primary" people={summary.going} />
                {!event.dayRsvp && <RosterGroup label="Maybe" dotClass="bg-sun" people={summary.maybe} />}
                <RosterGroup label="Can’t make" dotClass="bg-foreground/30" people={summary.notGoing} />
              </div>
            )}
          </div>
    </Sheet>
  );
}

function RosterGroup({
  label,
  dotClass,
  people,
}: {
  label: string;
  dotClass: string;
  people: EventAttendance[];
}) {
  if (people.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
        {label} · {people.length}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {people.map((p) => (
          <span
            key={p.userId}
            className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pl-1 pr-2.5 ring-1 ring-border"
          >
            <Avatar name={p.name} url={p.avatarUrl} size={20} />
            <PrivateName name={p.name} className="text-xs font-medium" />
          </span>
        ))}
      </div>
    </div>
  );
}
