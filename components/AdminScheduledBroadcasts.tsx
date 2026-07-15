"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { useBusyAction, useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import {
  fetchScheduledBroadcasts,
  cancelScheduledBroadcast,
  updateScheduledBroadcast,
  type ScheduledBroadcast,
} from "@/lib/scheduledBroadcasts";

/**
 * The queue of not-yet-fired scheduled announcements/notifications (migration
 * 0097) — Admin → Alerts & Notifications → Scheduled. Both composers write
 * into this same table via scheduleBroadcast(); a pg_cron tick inside
 * Postgres (run_scheduled_broadcasts, every minute) fires each one at its
 * time and stamps sent_at/error, which this view reflects live via Realtime —
 * no polling needed here.
 */
export function AdminScheduledBroadcasts() {
  const { isAdmin } = useIdentity();
  const [items, setItems] = useState<ScheduledBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledBroadcast | null>(null);
  const { busy, run } = useBusyAction();

  const load = useCallback(async () => {
    setItems(await fetchScheduledBroadcasts());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin || !isSupabaseConfigured) return;
    const sb = supabase;
    if (!sb) return;
    let cancelled = false;
    load();
    const channel = sb
      .channel("admin-scheduled-broadcasts")
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_broadcasts" }, () => {
        if (!cancelled) load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [isAdmin, load]);

  const cancel = (item: ScheduledBroadcast) => {
    if (!window.confirm(`Cancel this scheduled ${item.kind}?`)) return;
    run(item.id, async () => {
      const { error } = await cancelScheduledBroadcast(item.id);
      if (error) {
        window.alert(error);
        return;
      }
      await load();
    });
  };

  if (!isAdmin || !isSupabaseConfigured) return null;
  if (loading) return null;
  if (items.length === 0) {
    return <p className="rounded-xl bg-card p-3 text-center text-xs text-muted ring-1 ring-border">Nothing scheduled.</p>;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      {items.map((item) => {
        const sent = Boolean(item.sentAt);
        const failed = sent && Boolean(item.error);
        return (
          <li key={item.id} className="flex items-start gap-3 p-3">
            <span className="mt-0.5 text-base" aria-hidden>
              {item.kind === "announcement" ? "📣" : "🔔"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.payload.title}</p>
              {item.payload.body && <p className="truncate text-xs text-muted">{item.payload.body}</p>}
              {item.payload.sourceLabel && (
                <p className="truncate text-xs text-primary/70">Reminder for: {item.payload.sourceLabel}</p>
              )}
              <p className="mt-0.5 text-xs text-faint">
                {failed ? (
                  <span className="font-medium text-accent">Failed: {item.error}</span>
                ) : sent ? (
                  <span className="font-medium text-primary">Sent {new Date(item.sentAt!).toLocaleString()}</span>
                ) : (
                  <>Scheduled for {new Date(item.scheduledAt).toLocaleString()}</>
                )}
              </p>
            </div>
            {!sent && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setEditing(item)}
                  className="press rounded-full px-2.5 py-1.5 text-xs font-medium text-primary"
                >
                  Edit
                </button>
                <button
                  disabled={busy === item.id}
                  onClick={() => cancel(item)}
                  className="press rounded-full px-2.5 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </li>
        );
      })}
      {editing && (
        <EditScheduledBroadcastSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </ul>
  );
}

function EditScheduledBroadcastSheet({
  item,
  onClose,
  onSaved,
}: {
  item: ScheduledBroadcast;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [title, setTitle] = useState(item.payload.title);
  const [body, setBody] = useState(item.payload.body ?? "");
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(item.scheduledAt));
  const minLocal = toLocalInput(new Date(Date.now() + 2 * 60_000).toISOString());

  const canSave = title.trim().length > 0 && Boolean(scheduleAt) && !save.pending;

  const submit = () =>
    save.run(async () => {
      if (!scheduleAt) return "Pick a send time.";
      const { error } = await updateScheduledBroadcast(
        item.id,
        { ...item.payload, title: title.trim(), body: body.trim() || null },
        new Date(scheduleAt).toISOString(),
      );
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="edit-scheduled-title"
      header={<h2 id="edit-scheduled-title" className="text-lg font-bold">✏️ Edit scheduled {item.kind}</h2>}
      footer={
        <div className="space-y-2">
          {save.status && <p className="text-center text-xs font-medium text-accent">{save.status}</p>}
          <button
            onClick={submit}
            disabled={!canSave}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      {item.payload.sourceLabel && (
        <p className="rounded-xl bg-primary/5 px-3 py-2 text-xs text-primary/80 ring-1 ring-primary/20">
          Reminder for: {item.payload.sourceLabel}
        </p>
      )}
      <div className="space-y-2">
        <SectionLabel>Title</SectionLabel>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} w-full`} />
      </div>
      <div className="space-y-2">
        <SectionLabel>Body (optional)</SectionLabel>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${FIELD} w-full resize-none`} />
      </div>
      <div className="space-y-2">
        <SectionLabel>Send time</SectionLabel>
        <input
          type="datetime-local"
          value={scheduleAt}
          min={minLocal}
          onChange={(e) => setScheduleAt(e.target.value)}
          className={`${FIELD} w-full`}
        />
      </div>
    </Sheet>
  );
}
