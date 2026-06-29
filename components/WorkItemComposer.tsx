"use client";

import { useEffect, useState } from "react";
import type { ResortEvent, WorkItem } from "@/lib/types";
import { createWorkItem, updateWorkItem, deleteWorkItem, addWorkItemToEvent } from "@/lib/workItems";
import { fetchEvents, upcomingEvents } from "@/lib/events";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";

// Add/edit sheet for a work checklist item. Any signed-in member can add items;
// admins get the extra status toggle + delete button when editing.

export function WorkItemComposer({
  item,
  onClose,
  onSaved,
  preLinkedEventId,
}: {
  item?: WorkItem | null;
  onClose: () => void;
  onSaved: () => void;
  /** When set, the new item is auto-linked to this event and the picker is hidden. */
  preLinkedEventId?: string;
}) {
  const { isAdmin } = useIdentity();
  const editing = Boolean(item);
  const { closing, close } = useSheetDismiss(onClose);

  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [peopleNeeded, setPeopleNeeded] = useState<number>(item?.peopleNeeded ?? 0);
  const [status, setStatus] = useState<"open" | "done">(item?.status ?? "open");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(preLinkedEventId ?? null);
  const [events, setEvents] = useState<ResortEvent[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load upcoming events for the "link to event" picker (add mode only, not when pre-linked).
  useEffect(() => {
    if (editing || preLinkedEventId) return;
    const today = new Date().toISOString().slice(0, 10);
    fetchEvents().then((all) => setEvents(upcomingEvents(all, today)));
  }, [editing, preLinkedEventId]);

  const canSubmit = title.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const parsed = peopleNeeded > 0 ? peopleNeeded : null;

    if (editing && item) {
      const { error: err } = await updateWorkItem(item.id, {
        title: title.trim(),
        notes: notes.trim() || undefined,
        status,
        peopleNeeded: parsed,
      });
      setPending(false);
      if (err) { setError(err); return; }
    } else {
      const { error: err, id: newId } = await createWorkItem({
        title: title.trim(),
        notes: notes.trim() || undefined,
        peopleNeeded: parsed,
      });
      if (err) { setPending(false); setError(err); return; }
      if (newId && selectedEventId) {
        await addWorkItemToEvent(selectedEventId, newId);
      }
      setPending(false);
    }

    onSaved();
    close();
  };

  const remove = async () => {
    if (!item) return;
    if (!window.confirm(`Remove "${item.title}" from the checklist?`)) return;
    setPending(true);
    const { error: err } = await deleteWorkItem(item.id);
    setPending(false);
    if (err) { setError(err); return; }
    onSaved();
    close();
  };

  const sel = FIELD;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="work-item-composer-title"
      header={
        <h2 id="work-item-composer-title" className="text-lg font-bold">
          {editing ? "✏️ Edit item" : "🔧 Add work item"}
        </h2>
      }
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Add to checklist"}
          </button>
          {editing && isAdmin && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="press w-full rounded-xl bg-accent/10 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent/20 disabled:opacity-50"
            >
              Remove from checklist
            </button>
          )}
        </div>
      }
    >
      {/* Task */}
      <div className="space-y-2">
        <SectionLabel>Task</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Caulk windows on red & white cabin"'
          className={`${sel} w-full`}
          autoFocus
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="Extra details (optional)"
          className={`${sel} w-full resize-none`}
        />
      </div>

      {/* People needed — +/- stepper, 0 = not set */}
      <div className="space-y-2">
        <SectionLabel>How many people needed? (optional)</SectionLabel>
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
          <span className="text-sm font-medium text-foreground/70">People needed</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer people"
              onClick={() => setPeopleNeeded((n) => Math.max(0, n - 1))}
              disabled={peopleNeeded <= 0}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {peopleNeeded === 0 ? "Any" : peopleNeeded}
            </span>
            <button
              type="button"
              aria-label="More people"
              onClick={() => setPeopleNeeded((n) => Math.min(20, n + 1))}
              disabled={peopleNeeded >= 20}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>
      </div>

      {/* Link to an event (add mode only, when upcoming events exist, not when pre-linked) */}
      {!editing && !preLinkedEventId && events.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Link to an event (optional)</SectionLabel>
          <div className="space-y-1">
            {events.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => setSelectedEventId(selectedEventId === ev.id ? null : ev.id)}
                className={`press flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
                  selectedEventId === ev.id
                    ? "bg-primary/10 ring-primary/30"
                    : "bg-card ring-border"
                }`}
              >
                <span aria-hidden className="shrink-0">{ev.emoji ?? "📅"}</span>
                <span className={`flex-1 text-sm leading-snug ${selectedEventId === ev.id ? "font-medium text-primary" : "text-foreground/70"}`}>
                  {ev.title}
                </span>
                {selectedEventId === ev.id && (
                  <span className="shrink-0 text-xs font-semibold text-primary">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Admins can flip the status when editing */}
      {editing && isAdmin && (
        <div className="space-y-2">
          <SectionLabel>Status</SectionLabel>
          <div className="flex gap-2">
            {(["open", "done"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`press flex-1 rounded-xl py-2.5 text-sm font-semibold ring-1 transition-colors ${
                  status === s
                    ? "bg-primary text-white ring-primary"
                    : "bg-card text-foreground/70 ring-border"
                }`}
              >
                {s === "open" ? "⬜ Open" : "✅ Done"}
              </button>
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
