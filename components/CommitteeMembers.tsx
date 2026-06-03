"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";

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
  const { isAdmin } = useIdentity();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<Row[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [allProfiles, setAllProfiles] = useState<Row[]>([]);

  const load = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    const [{ data: mem }, { data: profs }] = await Promise.all([
      sb.from("committee_members").select("user_id, role").eq("committee_id", cid),
      sb.from("profiles").select("id, display_name, avatar_url"),
    ]);
    const pm = new Map((profs ?? []).map((p) => [(p as { id: string }).id, p as { display_name: string | null; avatar_url: string | null }]));
    const rows: Row[] = ((mem ?? []) as { user_id: string; role: string | null }[]).map((m) => ({
      id: m.user_id,
      name: pm.get(m.user_id)?.display_name?.trim() || "Member",
      avatar: pm.get(m.user_id)?.avatar_url ?? null,
      role: m.role,
    }));
    rows.sort((a, b) => (a.role === "Lead" ? -1 : b.role === "Lead" ? 1 : 0) || a.name.localeCompare(b.name));
    setMembers(rows);
    setAllProfiles(((profs ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({ id: p.id, name: p.display_name?.trim() || "Member", avatar: p.avatar_url, role: null })));
  };

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const cid = await fetchCommitteeId(slug);
      if (!cid || cancelled) return;
      setCommitteeId(cid);
      setMeId((await sb.auth.getUser()).data.user?.id ?? null);
      const manage = isAdmin || (await fetchMyCommitteeRole(cid)) === "Lead";
      if (cancelled) return;
      setCanManage(manage);
      if (!manage) return;
      await load(cid);
      if (cancelled) return;
      channel = sb
        .channel(`cmembers-${slug}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_members", filter: `committee_id=eq.${cid}` }, () => load(cid))
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [slug, isAdmin]);

  const remove = async (m: Row) => {
    if (!supabase || !committeeId) return;
    if (!window.confirm(`Remove ${m.name} from ${name}?`)) return;
    setBusy(m.id);
    const { error } = await supabase.rpc("set_committee_member", { cid: committeeId, target: m.id, is_member: false });
    setBusy(null);
    if (error) window.alert(error.message);
    else if (committeeId) await load(committeeId);
  };
  const setLead = async (m: Row, makeLead: boolean) => {
    if (!supabase || !committeeId) return;
    setBusy(m.id);
    const { error } = await supabase.rpc("set_committee_lead", { cid: committeeId, target: m.id, is_lead: makeLead });
    setBusy(null);
    if (error) window.alert(error.message);
    else if (committeeId) await load(committeeId);
  };
  const add = async (p: Row) => {
    if (!supabase || !committeeId) return;
    setBusy(p.id);
    const { error } = await supabase.rpc("set_committee_member", { cid: committeeId, target: p.id, is_member: true });
    setBusy(null);
    if (error) window.alert(error.message);
    else if (committeeId) {
      await load(committeeId);
      setQuery("");
    }
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
                {/* A lead can't remove another lead — only an app admin can. */}
                {(isAdmin || !lead) && !isMe && (
                  <button onClick={() => remove(m)} disabled={busy === m.id} className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50">
                    Remove
                  </button>
                )}
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
