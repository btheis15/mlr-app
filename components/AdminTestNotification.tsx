"use client";

import { useEffect, useState } from "react";
import { fetchMemberOptions, type FestMemberOption } from "@/lib/festContent";
import { MemberPickerSheet } from "@/components/FestPlanner";
import { Avatar } from "@/components/Avatar";
import { sendTestNotification } from "@/lib/broadcast";
import { useSaveStatus } from "@/lib/hooks";

const DEFAULT_TITLE = "🔔 Test notification";
const DEFAULT_BODY = "An admin sent this to check your notification settings.";

/**
 * Admin tool: ping ONE specific member with a test notification (Activity
 * tab + phone push, migration 0156) — for when a member says "I'm not
 * getting notifications" and an admin wants to check for themselves without
 * spamming anyone else. Reuses the member picker/search UI FestPlanner
 * already built rather than a duplicate list. Bypasses notif_types and rides
 * an override push (see lib/broadcast.ts's sendTestNotification) — it's a
 * deliberate, single-target action, not a subscribed feed.
 */
export function AdminTestNotification() {
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [picking, setPicking] = useState(false);
  const [member, setMember] = useState<FestMemberOption | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, status, run } = useSaveStatus();

  useEffect(() => {
    let alive = true;
    fetchMemberOptions().then((list) => alive && setMembers(list));
    return () => {
      alive = false;
    };
  }, []);

  const submit = () =>
    run(async () => {
      if (!member) return "Pick a member first.";
      const res = await sendTestNotification(member.id, title, body);
      if (res.error) return res.error;
      setSentTo(member.name);
      return null;
    });

  return (
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

      {status && (
        <p className="text-sm font-medium text-red-600">{status}</p>
      )}
      {sentTo && !status && (
        <p className="text-sm font-medium text-primary">
          Sent to {sentTo} — ask them if it came through.
        </p>
      )}

      <button
        onClick={submit}
        disabled={pending || !member}
        className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send test notification"}
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
  );
}
