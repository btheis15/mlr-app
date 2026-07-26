"use client";

import { useEffect, useState } from "react";
import { fetchMemberOptions, type FestMemberOption } from "@/lib/festContent";
import { MemberPickerSheet } from "@/components/FestPlanner";
import { Avatar } from "@/components/Avatar";
import {
  fetchNotificationTestRoster,
  sendTestNotification,
  setNotificationTestConfirmed,
  type NotificationTestMember,
} from "@/lib/notificationTest";
import { useBusyAction, useSaveStatus } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

const DEFAULT_TITLE = "🔔 Test notification";
const DEFAULT_BODY = "An admin sent this to check your notification settings.";

/**
 * "Notification Test" (Admin dashboard, migrations 0156-0157) — two related
 * tools in one place:
 *
 *   1. Ping ONE specific member with a test notification (Activity tab +
 *      override phone push) — for "I'm not getting notifications" reports.
 *   2. A per-member "Notifications confirmed" checklist: once an admin has
 *      actually watched it arrive on someone's phone, they check the box next
 *      to that person's name. Purely a manual, admin-visible record — it's
 *      not wired to anything else (not gated behind the send above; an admin
 *      can check it from a text/phone call just as well).
 */
export function NotificationTestView() {
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [picking, setPicking] = useState(false);
  const [member, setMember] = useState<FestMemberOption | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = useSaveStatus();

  const [roster, setRoster] = useState<NotificationTestMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [query, setQuery] = useState("");
  const { busy, run } = useBusyAction();
  const [rosterError, setRosterError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMemberOptions().then((list) => alive && setMembers(list));
    return () => {
      alive = false;
    };
  }, []);

  const loadRoster = () => {
    setRosterLoading(true);
    fetchNotificationTestRoster().then((list) => {
      setRoster(list);
      setRosterLoading(false);
    });
  };
  useEffect(loadRoster, []);

  const submitSend = () =>
    send.run(async () => {
      if (!member) return "Pick a member first.";
      const res = await sendTestNotification(member.id, title, body);
      if (res.error) return res.error;
      setSentTo(member.name);
      return null;
    });

  const toggleConfirmed = (m: NotificationTestMember) =>
    run(m.id, async () => {
      setRosterError(null);
      const next = !m.confirmed;
      const res = await setNotificationTestConfirmed(m.id, next);
      if (res.error) {
        setRosterError(res.error);
        return;
      }
      // Optimistic — a full reload would also pick up confirmedByName, but
      // that only matters once another admin looks; refresh in the background.
      setRoster((prev) =>
        prev.map((r) => (r.id === m.id ? { ...r, confirmed: next, confirmedAt: next ? new Date().toISOString() : null } : r)),
      );
      loadRoster();
    });

  const filteredRoster = query.trim()
    ? roster.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
    : roster;

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <div>
          <p className="text-sm font-semibold">Send a test to one member</p>
          <p className="mt-0.5 text-xs text-muted">
            Lands in their Activity tab and (if they have phone push on) buzzes
            their phone right away, regardless of their category settings — a
            quick way to check the pipeline actually reaches them.
          </p>
        </div>

        {member ? (
          <div className="flex items-center gap-3 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
            <Avatar name={member.name} url={member.avatarUrl} size={32} />
            <span className="flex-1 text-sm font-medium">{member.name}</span>
            <button
              onClick={() => {
                setMember(null);
                setSentTo(null);
              }}
              className="press text-xs font-medium text-muted"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPicking(true)}
            className="press w-full rounded-xl bg-background px-3 py-2.5 text-left text-sm font-medium text-foreground/70 ring-1 ring-border"
          >
            🔍 Pick a member…
          </button>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={DEFAULT_TITLE}
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={DEFAULT_BODY}
          rows={2}
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {send.status && <p className="text-sm font-medium text-red-600">{send.status}</p>}
        {sentTo && !send.status && (
          <p className="text-sm font-medium text-primary">
            Sent to {sentTo} — ask them if it came through.
          </p>
        )}

        <button
          onClick={submitSend}
          disabled={send.pending || !member}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {send.pending ? "Sending…" : "Send test notification"}
        </button>

        {picking && (
          <MemberPickerSheet
            members={members}
            onPick={(m) => {
              setMember(m);
              setSentTo(null);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold">Notifications confirmed</p>
          <p className="mt-0.5 text-xs text-muted">
            Once you've actually seen it work on someone's phone, check them
            off — a simple record of who you know is set up right.
          </p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members…"
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {rosterError && <p className="text-sm font-medium text-red-600">{rosterError}</p>}

        {rosterLoading ? (
          <p className="py-4 text-center text-xs text-foreground/50">Loading members…</p>
        ) : (
          <ul className="space-y-1.5">
            {filteredRoster.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border"
              >
                <Avatar name={m.name} url={m.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  {m.confirmed && (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      ✓ confirmed
                      {m.confirmedByName ? ` by ${m.confirmedByName}` : ""}
                      {m.confirmedAt ? ` · ${timeAgo(m.confirmedAt)}` : ""}
                    </p>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.confirmed}
                    disabled={busy === m.id}
                    onChange={() => toggleConfirmed(m)}
                    className="h-5 w-5 accent-[var(--color-primary)]"
                  />
                </label>
              </li>
            ))}
            {filteredRoster.length === 0 && (
              <li className="py-6 text-center text-xs text-foreground/50">No members found.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
