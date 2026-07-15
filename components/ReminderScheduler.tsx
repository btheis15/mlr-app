"use client";

// "Remind people before this happens" — an optional add-on for an event or a
// Home callout (migration 0101). Lists the pending reminders already queued
// for this item (scheduled_broadcasts rows tagged with sourceType/sourceId,
// see lib/scheduledBroadcasts.ts) and lets an admin add another: a relative
// offset ("1 day before") when the item has a real anchor time, or an exact
// date/time otherwise. Each reminder is just a normal scheduled notification
// under the hood — cancel/edit both work from here or from the admin-wide
// queue (AdminScheduledBroadcasts).
//
// Only usable once the event/callout has a real id — a brand-new, unsaved
// item has nothing to attach a queued row to yet, so the caller mounts this
// only when editing an existing one (see EventComposer/AdminCallouts).

import { useCallback, useEffect, useState } from "react";
import { SectionLabel, FIELD } from "@/components/Sheet";
import { useBusyAction, useSaveStatus } from "@/lib/hooks";
import {
  scheduleBroadcast,
  cancelScheduledBroadcast,
  fetchScheduledBroadcastsBySource,
  type ScheduledBroadcast,
} from "@/lib/scheduledBroadcasts";

export type ReminderAnchor = { ms: number; hasTime: boolean };

interface OffsetOption {
  label: string;
  ms: number; // 0 = "custom" sentinel
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const WITH_TIME_OFFSETS: OffsetOption[] = [
  { label: "1 hour before", ms: HOUR },
  { label: "2 hours before", ms: 2 * HOUR },
  { label: "1 day before", ms: DAY },
  { label: "2 days before", ms: 2 * DAY },
  { label: "3 days before", ms: 3 * DAY },
  { label: "1 week before", ms: 7 * DAY },
];
const DATE_ONLY_OFFSETS: OffsetOption[] = [
  { label: "1 day before (9am)", ms: DAY },
  { label: "2 days before (9am)", ms: 2 * DAY },
  { label: "3 days before (9am)", ms: 3 * DAY },
  { label: "1 week before (9am)", ms: 7 * DAY },
];
const CUSTOM_OFFSET = "custom";

/** "Jul 27, 2:00 PM" — date + time, for a reminder that could be days out. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ReminderScheduler({
  sourceType,
  sourceId,
  sourceLabel,
  anchor,
  defaultTitle,
  defaultBody,
  eventId,
}: {
  sourceType: "event" | "callout";
  sourceId: string;
  /** e.g. the event/callout's title — shown on each queued reminder + used to
   *  build the default notification title/body. */
  sourceLabel: string;
  /** The moment the offsets count down to — null when there's nothing to
   *  anchor an offset to yet (e.g. a callout with no deadline set), in which
   *  case only an exact custom time is offered. */
  anchor: ReminderAnchor | null;
  defaultTitle?: string;
  defaultBody?: string;
  /** Narrows the reminder to an event's attendees (present when this source
   *  itself is — or is linked to — an event), mirroring the other broadcast
   *  composers' EventTargetPicker. */
  eventId?: string | null;
}) {
  const [items, setItems] = useState<ScheduledBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const options = anchor?.hasTime ? WITH_TIME_OFFSETS : DATE_ONLY_OFFSETS;
  const [offset, setOffset] = useState<string>(anchor ? String(options[0].ms) : CUSTOM_OFFSET);
  const [customAt, setCustomAt] = useState(toLocalInput(new Date(Date.now() + DAY).toISOString()));
  const [title, setTitle] = useState(defaultTitle ?? `Reminder: ${sourceLabel}`);
  const [body, setBody] = useState(defaultBody ?? "");
  const save = useSaveStatus();
  const { busy, run } = useBusyAction();

  const reload = useCallback(async () => {
    setItems(await fetchScheduledBroadcastsBySource(sourceType, sourceId));
    setLoading(false);
  }, [sourceType, sourceId]);
  useEffect(() => { reload(); }, [reload]);

  const computedAt: Date | null = (() => {
    if (offset === CUSTOM_OFFSET) {
      if (!customAt) return null;
      return new Date(customAt);
    }
    if (!anchor) return null;
    return new Date(anchor.ms - Number(offset));
  })();
  const inPast = computedAt ? computedAt.getTime() <= Date.now() : false;
  const canAdd = Boolean(title.trim()) && computedAt && !inPast && !save.pending;

  const addReminder = () =>
    save.run(async () => {
      if (!computedAt) return "Pick a time.";
      const { error } = await scheduleBroadcast(
        "notification",
        {
          title: title.trim(),
          body: body.trim() || null,
          audience: "everyone",
          eventId: eventId ?? null,
          excludeNotAttending: Boolean(eventId),
          sourceType,
          sourceId,
          sourceLabel,
        },
        computedAt.toISOString(),
      );
      if (error) return error;
      setAdding(false);
      setBody("");
      await reload();
      return "Reminder scheduled ✓";
    });

  const cancel = (id: string) =>
    run(id, async () => {
      const { error } = await cancelScheduledBroadcast(id);
      if (error) window.alert(error);
      await reload();
    });

  return (
    <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <SectionLabel>Reminders</SectionLabel>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="press text-xs font-semibold text-primary">
            + Add a reminder
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-faint">Loading…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-faint">No reminders scheduled yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-2 ring-1 ring-border">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{it.payload.title}</p>
                <p className="text-[11px] text-faint">
                  {it.sentAt ? `Sent ${formatWhen(it.sentAt)}` : it.error ? `Failed: ${it.error}` : `Sends ${formatWhen(it.scheduledAt)}`}
                </p>
              </div>
              {!it.sentAt && !it.error && (
                <button
                  onClick={() => cancel(it.id)}
                  disabled={busy === it.id}
                  className="press shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent disabled:opacity-50"
                >
                  {busy === it.id ? "…" : "Cancel"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-2 rounded-lg bg-card p-2.5 ring-1 ring-border">
          <select
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            className={`${FIELD} w-full`}
          >
            {anchor && options.map((o) => (
              <option key={o.ms} value={o.ms}>{o.label}</option>
            ))}
            <option value={CUSTOM_OFFSET}>Custom date &amp; time…</option>
          </select>
          {offset === CUSTOM_OFFSET && (
            <input
              type="datetime-local"
              value={customAt}
              min={toLocalInput(new Date(Date.now() + 2 * 60_000).toISOString())}
              onChange={(e) => setCustomAt(e.target.value)}
              className={`${FIELD} w-full`}
            />
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notification title" className={`${FIELD} w-full`} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" rows={2} className={`${FIELD} w-full resize-none`} />
          {sourceType === "callout" && (
            <p className="px-0.5 text-[11px] text-faint">
              Skips anyone who already marked this callout &ldquo;done&rdquo;.
            </p>
          )}
          {computedAt && (
            <p className="px-0.5 text-[11px] text-faint">
              {inPast ? "That time has already passed." : `Sends ${formatWhen(computedAt.toISOString())}`}
            </p>
          )}
          {save.status && <p className="px-0.5 text-[11px] font-medium text-primary">{save.status}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addReminder}
              disabled={!canAdd}
              className="press rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {save.pending ? "Scheduling…" : "Add"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="press text-xs font-medium text-foreground/55">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
