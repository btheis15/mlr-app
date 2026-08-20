"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchArchivedEventChats,
  setEventChatReopened,
  type ArchivedEventChat,
} from "@/lib/eventChats";

/**
 * Admin → Event chats. Every archived event room, with a way to reopen one for
 * a day or a week.
 *
 * ⚠️ **Why this lives in /admin instead of the Feed:** an event chat has no
 * app-admin override (migration 0216) — an admin who wasn't going never sees it
 * in their own Feed, so there'd be nothing to tap. This is the only surface
 * where an archived room is reachable at all for them.
 *
 * ⚠️ **Reopening does NOT grant read access.** It lets the people who were in
 * the room post in it again; the admin still can't read a word. That's stated
 * on screen too, because "unarchive" naturally reads like "open it up to me".
 */
export function AdminEventChats() {
  const [rows, setRows] = useState<ArchivedEventChat[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await fetchArchivedEventChats());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (eventId: string, days: 1 | 7 | null) => {
    setBusy(eventId);
    setError(null);
    const res = await setEventChatReopened(eventId, days);
    // Carry the server's own message up rather than a generic failure — the
    // 0210 RSVP outage showed how "couldn't save" hides a real problem.
    if (!res.ok) setError(res.error);
    await load();
    setBusy(null);
  };

  if (rows === null) {
    return <div className="h-24 animate-pulse rounded-2xl bg-card" />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-primary/10 p-4 text-xs text-muted">
        <p className="font-semibold text-foreground">What reopening does</p>
        <p className="mt-1">
          An event chat becomes read-only 7 days after the event ends. Reopening lets the
          people who were in it post again for a day or a week, then it closes itself.
        </p>
        <p className="mt-1.5">
          It does <span className="font-semibold">not</span> let you read it. Event chats are
          only visible to the people who were going — that includes admins.
        </p>
      </div>

      {error && <p className="text-xs text-accent">{error}</p>}

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-muted">
          No archived event chats yet. A chat lands here 7 days after its event ends.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {rows.map((r, i) => {
            const openUntil = r.reopenedUntil && new Date(r.reopenedUntil).getTime() > Date.now()
              ? new Date(r.reopenedUntil)
              : null;
            return (
              <div key={r.eventId} className={`p-4 ${i ? "border-t border-border" : ""}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg" aria-hidden>{r.emoji || "📅"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.title || "(event deleted)"}</p>
                    <p className="text-xs text-muted">
                      {r.endDate || r.startDate || "no dates"} ·{" "}
                      {r.messageCount === 1 ? "1 message" : `${r.messageCount} messages`}
                    </p>
                    {openUntil && (
                      <p className="mt-1 text-xs font-semibold text-accent">
                        Reopened until {openUntil.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === r.eventId}
                    onClick={() => void act(r.eventId, 1)}
                    className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-border disabled:opacity-40"
                  >
                    Reopen 1 day
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.eventId}
                    onClick={() => void act(r.eventId, 7)}
                    className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-border disabled:opacity-40"
                  >
                    Reopen 7 days
                  </button>
                  {openUntil && (
                    <button
                      type="button"
                      disabled={busy === r.eventId}
                      onClick={() => void act(r.eventId, null)}
                      className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-border disabled:opacity-40"
                    >
                      Close it now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
