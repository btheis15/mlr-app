"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { useBusyAction } from "@/lib/hooks";
import { fetchScheduledBroadcasts, cancelScheduledBroadcast, type ScheduledBroadcast } from "@/lib/scheduledBroadcasts";

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
              <button
                disabled={busy === item.id}
                onClick={() => cancel(item)}
                className="press shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
