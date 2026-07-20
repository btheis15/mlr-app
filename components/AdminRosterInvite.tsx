"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { fetchFamilyRoster, type FamilyRosterEntry } from "@/lib/familyRoster";
import { inviteByEmailLink } from "@/lib/admin";
import { Avatar } from "@/components/Avatar";
import { plural } from "@/lib/format";
import { useBusyAction, useSaveStatus } from "@/lib/hooks";

/**
 * Admin → Members: a quick "invite the people who aren't on the app yet" list.
 * Reads the family roster (migration 0123) for people with an email but no
 * account yet, and fires the same branded welcome email as the Invite page —
 * one at a time or all at once. Managing the roster (add / house-assign) lives
 * in Admin → Houses; this is just the invite shortcut the members page wanted.
 * Self-hides when there's no one to invite.
 */
export function AdminRosterInvite() {
  const [people, setPeople] = useState<FamilyRosterEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { busy: busyId, run } = useBusyAction();
  const status = useSaveStatus();
  const [allBusy, setAllBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoaded(true); return; }
    fetchFamilyRoster()
      .then((all) => setPeople(all.filter((p) => !p.linkedUserId && p.email)))
      .finally(() => setLoaded(true));
  }, []);

  const getToken = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

  const inviteOne = (p: FamilyRosterEntry) =>
    run(p.id, async () => {
      const token = await getToken();
      if (!token) { status.show("Sign in again to send invites.", 4000); return; }
      try {
        const r = await inviteByEmailLink([{ email: p.email!, name: p.name }], token);
        status.show(r[0]?.ok ? `Invited ${p.name} ✓` : `Couldn't invite ${p.name}: ${r[0]?.error ?? "failed"}`, r[0]?.ok ? 3000 : 6000);
      } catch (err) {
        status.show(err instanceof Error ? err.message : "Couldn't send invite.", 6000);
      }
    });

  const inviteAll = async () => {
    setAllBusy(true);
    try {
      const token = await getToken();
      if (!token) { status.show("Sign in again to send invites.", 4000); return; }
      const entries = people.map((p) => ({ email: p.email!, name: p.name }));
      const r = await inviteByEmailLink(entries, token);
      const ok = r.filter((x) => x.ok).length;
      status.show(`Sent ${ok}/${r.length} invite${r.length === 1 ? "" : "s"}.`, 5000);
    } catch (err) {
      status.show(err instanceof Error ? err.message : "Couldn't send invites.", 6000);
    } finally {
      setAllBusy(false);
    }
  };

  // Nothing to invite (or not connected) → render nothing.
  if (!loaded || !isSupabaseConfigured || people.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Not on the app yet</p>
      <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">
            {people.length} {plural(people.length, "person", "people")} on the family roster
          </p>
          <button
            type="button"
            onClick={inviteAll}
            disabled={allBusy}
            className="press ml-auto shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {allBusy ? "Sending…" : "💌 Invite all"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Each gets a branded welcome email whose button signs them straight in — no code to type. Add or house-assign
          people in <span className="font-medium">Admin → Houses</span>.
        </p>
        {status.status && <p className="text-xs font-medium text-primary">{status.status}</p>}
        <ul className="space-y-1.5">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-background p-2.5 ring-1 ring-border">
              <Avatar name={p.name} url={null} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="truncate text-xs text-faint">{p.email}</p>
              </div>
              <button
                type="button"
                onClick={() => inviteOne(p)}
                disabled={busyId === p.id || allBusy}
                className="press shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busyId === p.id ? "…" : "💌 Invite"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
