"use client";

import { useEffect, useRef, useState } from "react";
import type { AttendanceStatus, AttendanceSummary, EventAttendance, ResortEvent } from "@/lib/types";
import { formatDate, formatDateLong, formatDateRange, relativeDays } from "@/lib/format";
import { deleteEvent, effectiveStatus, eventDays, isOngoing } from "@/lib/events";
import { Avatar } from "@/components/Avatar";
import { PrivateName, Protected } from "@/components/Guard";
import { AttendanceControl } from "@/components/AttendanceControl";

// The event detail sheet: dates, location, description, the RSVP control, an
// optional per-day drill-down (Family Fest), and who's coming. Admins can edit or
// delete a real (DB) event. Slides up over a dimmed backdrop with a desktop pop
// variant, exiting via the closing-state pattern — copied from CabinRequestSheet.
const SHEET_MS = 440; // keep in sync with --dur-sheet in globals.css

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
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const days = eventDays(event.startDate, event.endDate);
  const showDayPicker = event.dayRsvp && days.length > 1;
  const myEffective = mine ? effectiveStatus(mine.status, mine.days) : null;
  const [pickDays, setPickDays] = useState(Boolean(mine?.days && Object.keys(mine.days).length));
  const closeTimer = useRef<number | null>(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, SHEET_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-sheet-title"
      onClick={close}
    >
      <div className={`absolute inset-0 bg-black/50 ${closing ? "scrim-out" : "scrim-in"}`} aria-hidden />

      <div
        className={`relative flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl bg-background ring-1 ring-border sm:max-w-sm sm:rounded-3xl ${
          closing ? "sheet-close sm:pop-close" : "sheet-panel sm:pop-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-foreground/20 sm:hidden" aria-hidden />
          <button
            onClick={close}
            aria-label="Close"
            className="press absolute right-4 top-4 text-foreground/40 hover:text-foreground"
          >
            ✕
          </button>
          <h2 id="event-sheet-title" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden>{event.emoji ?? "📅"}</span>
            {event.title}
          </h2>
          <p className="text-sm text-foreground/60">
            {formatDateRange(event.startDate, event.endDate)}
            {when && <span className="font-medium text-accent"> · {when}</span>}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-2 pt-4">
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
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">Are you coming?</p>
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
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">Who&rsquo;s coming</p>
            {summary.counts.going === 0 && summary.counts.maybe === 0 ? (
              <p className="text-sm text-foreground/45">No RSVPs yet.</p>
            ) : (
              <div className="space-y-3">
                <RosterGroup label="Going" dotClass="bg-primary" people={summary.going} />
                <RosterGroup label="Maybe" dotClass="bg-sun" people={summary.maybe} />
              </div>
            )}
          </div>
        </div>

        {/* Footer — admin actions on real (DB) events. */}
        {isAdmin && event.persisted && (
          <div
            className="flex shrink-0 items-center gap-2 border-t border-border px-5 pt-3"
            style={{ paddingBottom: "max(0.85rem, env(safe-area-inset-bottom))" }}
          >
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
        )}
      </div>
    </div>
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
