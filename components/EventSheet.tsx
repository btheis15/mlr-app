"use client";

import { useState } from "react";
import type { AttendanceStatus, AttendanceSummary, EventAttendance, ResortEvent } from "@/lib/types";
import { formatDate, formatDateLong, formatDateRange, relativeDays } from "@/lib/format";
import { deleteEvent, effectiveStatus, eventDays, isOngoing } from "@/lib/events";
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
  const showDayPicker = event.dayRsvp && days.length > 1;
  const myEffective = mine ? effectiveStatus(mine.status, mine.days) : null;
  const [pickDays, setPickDays] = useState(Boolean(mine?.days && Object.keys(mine.days).length));

  // The displayed status for one day: an explicit choice, else inherited from a
  // top-level "Going" (so marking the whole event Going lights every day).
  const dayValue = (day: string): AttendanceStatus | null =>
    mine?.days?.[day] ?? (myEffective === "going" ? "going" : null);

  const onDayChange = (day: string, status: AttendanceStatus) => {
    const base: Record<string, AttendanceStatus> =
      mine?.days && Object.keys(mine.days).length
        ? { ...mine.days }
        : myEffective === "going"
          ? Object.fromEntries(days.map((d) => [d, "going" as AttendanceStatus]))
          : {};
    base[day] = status;
    // Roll the per-day picks up to the overall status (going if any day is going).
    onSetStatus(effectiveStatus("not_going", base), base);
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
            <AttendanceControl value={myEffective} onChange={(s) => onSetStatus(s, null)} />

            {showDayPicker && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setPickDays((v) => !v)}
                  aria-expanded={pickDays}
                  className="press text-xs font-medium text-primary"
                >
                  {pickDays ? "Hide specific days" : "Pick specific days ›"}
                </button>
                {pickDays && (
                  <div className="mt-2 space-y-2 rounded-xl bg-card p-3 ring-1 ring-border">
                    <p className="text-xs text-foreground/55">
                      Going at least one day counts as <span className="font-medium text-primary">Going</span> overall.
                    </p>
                    {days.map((day) => (
                      <div key={day} className="space-y-1">
                        <p className="px-0.5 text-xs font-medium text-foreground/70">
                          {formatDate(new Date(`${day}T00:00:00`))}
                        </p>
                        <AttendanceControl size="sm" value={dayValue(day)} onChange={(s) => onDayChange(day, s)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Who's coming */}
          <div className="space-y-2">
            <SectionLabel>Who&rsquo;s coming</SectionLabel>
            {summary.counts.going === 0 && summary.counts.maybe === 0 && summary.counts.notGoing === 0 ? (
              <p className="text-sm text-foreground/45">No RSVPs yet.</p>
            ) : (
              <div className="space-y-3">
                <RosterGroup label="Going" dotClass="bg-primary" people={summary.going} />
                <RosterGroup label="Maybe" dotClass="bg-sun" people={summary.maybe} />
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
