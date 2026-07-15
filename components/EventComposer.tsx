"use client";

import { useEffect, useState } from "react";
import type { EventKind, ResortEvent, WorkItem } from "@/lib/types";
import { createEvent, updateEvent, type EventInput } from "@/lib/events";
import { fetchWorkItems, fetchEventWorkItems, syncEventWorkItems } from "@/lib/workItems";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { ReminderScheduler } from "@/components/ReminderScheduler";

// Admin create/edit form for a resort event, in a bottom sheet (scaffolding +
// dismiss motion from Sheet / useSheetDismiss). Family Fest isn't edited here —
// it's synthesized from FAMILY_FEST. New events default to today; multi-day
// events can offer the per-day RSVP drill-down.

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
  const { closing, close } = useSheetDismiss(onClose);
  const [title, setTitle] = useState(event?.title ?? "");
  const [emoji, setEmoji] = useState(event?.emoji ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind === "family_fest" ? "custom" : (event?.kind ?? "work_weekend"));
  const [startDate, setStartDate] = useState(event?.startDate ?? today ?? "");
  const [startTime, setStartTime] = useState(event?.startTime ?? "");
  const [endDate, setEndDate] = useState(event?.endDate ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [dayRsvp, setDayRsvp] = useState(event?.dayRsvp ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Work items: all open items for the picker + which ones are selected for this event.
  const [allWorkItems, setAllWorkItems] = useState<WorkItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchWorkItems().then((items) => setAllWorkItems(items.filter((i) => i.status === "open")));
    if (event?.persisted) {
      fetchEventWorkItems(event.id).then((linked) =>
        setSelectedItemIds(new Set(linked.map((i) => i.id))),
      );
    }
  }, [event?.id, event?.persisted]);

  const toggleItem = (id: string) =>
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const multiDay = Boolean(endDate && endDate > startDate);
  const validRange = !endDate || endDate >= startDate;
  const canSubmit = title.trim().length > 0 && startDate.length > 0 && validRange && !pending;

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
      startTime: startTime || null,
    };
    let eventId: string | undefined;
    if (event?.persisted) {
      const { error: err } = await updateEvent(event.id, input);
      if (err) { setPending(false); setError(err); return; }
      eventId = event.id;
    } else {
      const { id, error: err } = await createEvent(input);
      if (err) { setPending(false); setError(err); return; }
      eventId = id;
    }
    // Sync work item links after the event is saved.
    if (eventId) await syncEventWorkItems(eventId, [...selectedItemIds]);
    setPending(false);
    onSaved();
    close();
  };

  const sel = FIELD;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="event-composer-title"
      header={
        <h2 id="event-composer-title" className="text-lg font-bold">
          {editing ? "✏️ Edit event" : "📅 New event"}
        </h2>
      }
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
        </button>
      }
    >
          {/* Title + emoji */}
          <div className="space-y-2">
            <SectionLabel>Event</SectionLabel>
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
            <SectionLabel>When</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-muted">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={sel}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-muted">
                  End <span className="font-normal text-faint">(optional)</span>
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
            <label className="flex flex-col gap-1">
              <span className="px-0.5 text-xs text-muted">
                Start time <span className="font-normal text-faint">(optional — lets reminders offer "N hours before")</span>
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${sel} w-full`}
              />
            </label>
            {!validRange && <p className="px-0.5 text-xs text-accent">End date must be on or after the start.</p>}
            {multiDay && (
              <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
                <span className="min-w-0">
                  <span className="text-sm font-medium">Let people pick specific days</span>
                  <span className="block text-xs text-muted">A per-day Going/Maybe drill-down (like Family Fest).</span>
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
            <SectionLabel>
              Details <span className="font-normal normal-case text-faint">(optional)</span>
            </SectionLabel>
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
              className={`${sel} w-full resize-none`}
            />
          </div>

          {event?.persisted && (
            <div className="space-y-2">
              <SectionLabel>
                Reminders <span className="font-normal normal-case text-faint">(optional)</span>
              </SectionLabel>
              <ReminderScheduler
                sourceType="event"
                sourceId={event.id}
                sourceLabel={title.trim() || event.title}
                anchor={{
                  ms: new Date(`${startDate}T${startTime || "09:00"}:00`).getTime(),
                  hasTime: Boolean(startTime),
                }}
                defaultTitle={`Reminder: ${title.trim() || event.title}`}
                eventId={event.id}
              />
            </div>
          )}

          {/* Work items — link checklist items so attendees know what's planned */}
          {allWorkItems.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>
                Work items{" "}
                <span className="font-normal normal-case text-faint">(optional)</span>
              </SectionLabel>
              <p className="px-0.5 text-xs text-muted">
                Check off tasks from the resort work checklist so people know what&rsquo;s planned.
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border">
                {allWorkItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-background"
                  >
                    <input
                      type="checkbox"
                      checked={selectedItemIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{item.title}</span>
                      {item.category && (
                        <span className="text-[10px] text-faint">{item.category}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
              {error}
            </p>
          )}
    </Sheet>
  );
}
