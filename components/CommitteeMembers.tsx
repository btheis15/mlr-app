"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { getCurrentUserId, fetchProfiles, profileMap } from "@/lib/roles";
import { useBusyAction, useManagedCommittee } from "@/lib/hooks";

/**
 * Manage a committee's roster — shown to its **Lead** or an **app admin**
 * (migration 0015). Leads can add/remove regular members; only app admins can
 * promote/demote a **Lead** (and only admins can remove a Lead). All writes go
 * through the gated set_committee_member / set_committee_lead RPCs; this is just
 * the controls. Renders nothing for anyone who can't manage.
 */
interface Row {
  id: string;
  name: string;
  avatar?: string | null;
  role: string | null;
}

export function CommitteeMembers({ slug, name }: { slug: string; name: string }) {
  const [members, setMembers] = useState<Row[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const { busy, run } = useBusyAction();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [allProfiles, setAllProfiles] = useState<Row[]>([]);

  const load = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    const [{ data: mem }, profs] = await Promise.all([
      sb.from("committee_members").select("user_id, role").eq("committee_id", cid),
      fetchProfiles(),
    ]);
    setMeId(await getCurrentUserId());
    const pm = profileMap(profs);
    const rows: Row[] = ((mem ?? []) as { user_id: string; role: string | null }[]).map((m) => ({
      id: m.user_id,
      name: pm.get(m.user_id)?.name || "Member",
      avatar: pm.get(m.user_id)?.avatarUrl ?? null,
      role: m.role,
    }));
    rows.sort((a, b) => (a.role === "Lead" ? -1 : b.role === "Lead" ? 1 : 0) || a.name.localeCompare(b.name));
    setMembers(rows);
    setAllProfiles(profs.map((p) => ({ id: p.id, name: p.name, avatar: p.avatarUrl, role: null })));
  };

  const { committeeId, canManage, setCanManage, isAdmin } = useManagedCommittee(slug, { watch: "committee_members", load });

  // Run a roster-changing RPC, then reload (or alert on failure). Shared by the
  // remove / set-lead / add controls below.
  const rpcThenReload = (id: string, rpc: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) =>
    run(id, async () => {
      if (!committeeId) return;
      const { error } = await rpc();
      if (error) window.alert(error.message);
      else {
        await load(committeeId);
        after?.();
      }
    });

  const remove = (m: Row) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    if (!window.confirm(`Remove ${m.name} from ${name}?`)) return;
    rpcThenReload(m.id, () => sb.rpc("set_committee_member", { cid: committeeId, target: m.id, is_member: false }));
  };
  const setLead = (m: Row, makeLead: boolean) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    rpcThenReload(m.id, () => sb.rpc("set_committee_lead", { cid: committeeId, target: m.id, is_lead: makeLead }));
  };
  const add = (p: Row) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    rpcThenReload(p.id, () => sb.rpc("set_committee_member", { cid: committeeId, target: p.id, is_member: true }), () => setQuery(""));
  };
  const leaveSelf = () => {
    const sb = supabase;
    if (!sb || !committeeId || !meId) return;
    const selfLead = members.find((m) => m.id === meId)?.role === "Lead";
    const msg = selfLead
      ? `Leave ${name}? You're a Lead — until an app admin assigns a new one this committee may have no lead. You can ask to rejoin later.`
      : `Leave ${name}? You'll lose access to its chat (you can ask to rejoin later).`;
    if (!window.confirm(msg)) return;
    run(meId, async () => {
      const { error } = await sb.rpc("leave_committee", { cid: committeeId });
      if (error) { window.alert(error.message); return; }
      // You're no longer a lead after leaving: non-admins lose manage access (the
      // panel then hides via the canManage gate); admins keep it via the override.
      setCanManage(isAdmin);
      if (isAdmin) await load(committeeId);
    });
  };

  if (!canManage || !isSupabaseConfigured) return null;

  const memberIds = new Set(members.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const addable = q ? allProfiles.filter((p) => !memberIds.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6) : [];

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{isAdmin ? "Admin" : "Lead"}</span>
        <h2 className="text-sm font-semibold">{name} members</h2>
        <span className="ml-auto text-xs text-foreground/45">{members.length}</span>
      </div>

      <ul className="space-y-1.5">
        {members.map((m) => {
          const isMe = m.id === meId;
          const lead = m.role === "Lead";
          return (
            <li key={m.id} className="flex items-center gap-3 rounded-xl bg-background p-2.5 ring-1 ring-border">
              <Avatar name={m.name} url={m.avatar} size={32} />
              <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                <span className="truncate">{m.name}</span>
                {isMe && <span className="shrink-0 text-xs text-foreground/40">(you)</span>}
                {lead && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Lead</span>}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {isAdmin && (
                  <button onClick={() => setLead(m, !lead)} disabled={busy === m.id} className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/40 disabled:opacity-50">
                    {busy === m.id ? "…" : lead ? "Unset lead" : "Make lead"}
                  </button>
                )}
                {/* Leave yourself; or remove others (a lead can't remove another lead — only an app admin can). */}
                {isMe ? (
                  <button onClick={leaveSelf} disabled={busy === m.id} className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50">
                    {busy === m.id ? "…" : "Leave"}
                  </button>
                ) : (isAdmin || !lead) ? (
                  <button onClick={() => remove(m)} disabled={busy === m.id} className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50">
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {members.length === 0 && <p className="py-2 text-center text-xs text-foreground/45">No members yet — approve a request or add someone below.</p>}
      </ul>

      <div className="space-y-2">
        {!adding ? (
          <button onClick={() => setAdding(true)} className="press text-xs font-semibold text-primary">+ Add a member</button>
        ) : (
          <div className="space-y-1.5 rounded-xl bg-background p-2 ring-1 ring-border">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search signed-in members…" autoFocus className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
            {addable.map((p) => (
              <button key={p.id} onClick={() => add(p)} disabled={busy === p.id} className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-card disabled:opacity-50">
                <Avatar name={p.name} url={p.avatar} size={22} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-primary">+ Add</span>
              </button>
            ))}
            {q && addable.length === 0 && <p className="px-2 py-1 text-xs text-foreground/40">No one matches (or already a member).</p>}
            <button onClick={() => { setAdding(false); setQuery(""); }} className="press px-2 text-xs text-foreground/50">Done</button>
          </div>
        )}
      </div>
    </section>
  );
}
