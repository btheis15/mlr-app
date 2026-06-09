"use client";

import { useEffect, useRef, useState } from "react";
import type { EventKind, ResortEvent } from "@/lib/types";
import { createEvent, updateEvent, type EventInput } from "@/lib/events";
import { useDemoDate } from "@/lib/DemoDateProvider";

// Admin create/edit form for a resort event, in a bottom sheet (same motion +
// markup as CabinRequestSheet; same field styling as AdminAlertComposer). Family
// Fest isn't edited here — it's synthesized from FAMILY_FEST. New events default
// to today; multi-day events can offer the per-day RSVP drill-down.
const SHEET_MS = 440;

const KINDS: { value: EventKind; label: string }[] = [
  { value: "work_weekend", label: "Work Weekend" },
  { value: "holiday", label: "Holiday weekend" },
  { value: "custom", label: "Other event" },
];

export function EventComposer({
  event,
  onClose,
  onSaved,
}: {
  /** The event to edit, or null/undefined to create a new one. */
  event?: ResortEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { today } = useDemoDate();
  const editing = Boolean(event);
  const [closing, setClosing] = useState(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [emoji, setEmoji] = useState(event?.emoji ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind === "family_fest" ? "custom" : (event?.kind ?? "work_weekend"));
  const [startDate, setStartDate] = useState(event?.startDate ?? today ?? "");
  const [endDate, setEndDate] = useState(event?.endDate ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [dayRsvp, setDayRsvp] = useState(event?.dayRsvp ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  const multiDay = Boolean(endDate && endDate > startDate);
  const validRange = !endDate || endDate >= startDate;
  const canSubmit = title.trim().length > 0 && startDate.length > 0 && validRange && !pending;

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

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const input: EventInput = {
      title: title.trim(),
      startDate,
      endDate: endDate || null,
      kind,
      emoji: emoji.trim() || null,
      location: location.trim() || null,
      description: description.trim() || null,
      dayRsvp: multiDay && dayRsvp,
    };
    const { error: err } = event?.persisted
      ? await updateEvent(event.id, input)
      : await createEvent(input);
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    onSaved();
    close();
  };

  const sel = "rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-composer-title"
      onClick={close}
    >
      <div className={`absolute inset-0 bg-black/50 ${closing ? "scrim-out" : "scrim-in"}`} aria-hidden />

      <div
        className={`relative flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl bg-background ring-1 ring-border sm:max-w-sm sm:rounded-3xl ${
          closing ? "sheet-close sm:pop-close" : "sheet-panel sm:pop-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-foreground/20 sm:hidden" aria-hidden />
          <button
            onClick={close}
            aria-label="Close"
            className="press absolute right-4 top-4 text-foreground/40 hover:text-foreground"
          >
            ✕
          </button>
          <h2 id="event-composer-title" className="text-lg font-bold">
            {editing ? "✏️ Edit event" : "📅 New event"}
          </h2>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-2 pt-4">
          {/* Title + emoji */}
          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">Event</p>
            <div className="flex gap-2">
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={8}
                placeholder="🎉"
                aria-label="Emoji"
                className={`${sel} w-14 text-center`}
              />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. "Spring Work Weekend"'
                className={`${sel} min-w-0 flex-1`}
              />
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className={`${sel} w-full`}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">When</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-foreground/55">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={sel}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-foreground/55">
                  End <span className="font-normal text-foreground/40">(optional)</span>
                </span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={sel}
                />
              </label>
            </div>
            {!validRange && <p className="px-0.5 text-xs text-accent">End date must be on or after the start.</p>}
            {multiDay && (
              <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
                <span className="min-w-0">
                  <span className="text-sm font-medium">Let people pick specific days</span>
                  <span className="block text-xs text-foreground/50">A per-day Going/Maybe drill-down (like Family Fest).</span>
                </span>
                <input
                  type="checkbox"
                  checked={dayRsvp}
                  onChange={(e) => setDayRsvp(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                />
              </label>
            )}
          </div>

          {/* Location + details */}
          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">
              Details <span className="font-normal normal-case text-foreground/40">(optional)</span>
            </p>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Where — e.g. Main Lodge"
              className={`${sel} w-full`}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="What it is, what to bring, when to arrive…"
              className="w-full resize-none rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
              {error}
            </p>
          )}
        </div>

        <div
          className="shrink-0 border-t border-border px-5 pt-3"
          style={{ paddingBottom: "max(0.85rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
          </button>
        </div>
      </div>
    </div>
  );
}
