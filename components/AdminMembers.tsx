"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";

interface MemberRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  household: string | null;
  email?: string | null; // only present via the admin RPC (private)
  is_admin: boolean;
}

/**
 * Admin-only member directory: every registered member, with the ability to
 * grant/revoke admin. Emails are private — they come from `admin_members()`, a
 * SECURITY DEFINER function gated to admins (migration 0008). Until that
 * migration runs, this falls back to the public `profiles` table (names only)
 * and the promote/remove buttons explain what's needed to enable them.
 */
export function AdminMembers() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // True once the admin_members RPC answers — i.e. migration 0008 is applied,
  // so emails are visible and promote/remove works.
  const [rpcReady, setRpcReady] = useState(false);

  const load = async () => {
    const sb = supabase;
    if (!sb) return;
    setLoading(true);
    setError(null);
    sb.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));

    const viaRpc = await sb.rpc("admin_members");
    if (!viaRpc.error && viaRpc.data) {
      setMembers(viaRpc.data as MemberRow[]);
      setRpcReady(true);
      setLoading(false);
      return;
    }
    // Fallback: public profiles (no emails, no promote) until 0008 is applied.
    const { data, error: e } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url, household, is_admin")
      .order("display_name", { ascending: true });
    if (e) setError("Couldn't load members.");
    setMembers((data ?? []) as MemberRow[]);
    setRpcReady(false);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAdmin = async (m: MemberRow, value: boolean) => {
    const sb = supabase;
    if (!sb) return;
    const name = m.display_name || m.email || "this member";
    if (!window.confirm(value ? `Make ${name} an admin?` : `Remove admin from ${name}?`)) return;
    setBusyId(m.id);
    const { error: e } = await sb.rpc("set_admin", { target: m.id, value });
    setBusyId(null);
    if (e) {
      window.alert(e.message || "Couldn't update admin.");
      return;
    }
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_admin: value } : x)));
  };

  // Permanently delete a member: their account + everything they posted. Gated
  // server-side too (delete_member, migration 0009) — admins can't be deleted
  // without demoting first, and you can't delete yourself. Double-confirm here
  // because it's irreversible.
  const removeMember = async (m: MemberRow) => {
    const sb = supabase;
    if (!sb) return;
    const name = m.display_name?.trim() || m.email || "this member";
    if (
      !window.confirm(
        `Permanently remove ${name}?\n\nThis deletes their account and everything they posted — photos, comments, and reactions. It cannot be undone.`,
      )
    )
      return;
    if (!window.confirm(`Last check: remove ${name} for good?`)) return;
    setBusyId(m.id);
    const { error: e } = await sb.rpc("delete_member", { target: m.id });
    setBusyId(null);
    if (e) {
      window.alert(e.message || "Couldn't remove member.");
      return;
    }
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? members.filter((m) =>
        [m.display_name, m.email, m.household].some((f) => f?.toLowerCase().includes(q)),
      )
    : members;
  const adminCount = members.filter((m) => m.is_admin).length;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Members</h2>
        <span className="ml-auto text-xs text-foreground/45">
          {members.length} {members.length === 1 ? "member" : "members"} · {adminCount} admin{adminCount === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-xs text-foreground/60">
        Everyone who&rsquo;s signed in. Tap <strong>Make admin</strong> to give someone admin access (post
        alerts, manage members), or <strong>Remove</strong> to take it away.
      </p>

      {!rpcReady && !loading && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground/70">
          To show members&rsquo; emails and turn on promoting admins, run{" "}
          <code>supabase/migrations/0008_admin_members.sql</code> in Supabase.
        </p>
      )}

      {members.length > 5 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members…"
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
      )}

      {loading ? (
        <p className="py-3 text-center text-xs text-foreground/45">Loading members…</p>
      ) : error ? (
        <p className="py-3 text-center text-xs text-accent">{error}</p>
      ) : shown.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground/45">No members match that.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((m) => {
            const name = m.display_name?.trim() || m.email || "Member";
            const isMe = m.id === meId;
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-xl bg-background p-2.5 ring-1 ring-border">
                <Avatar name={name} url={m.avatar_url} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span className="truncate">{name}</span>
                    {isMe && <span className="shrink-0 text-xs text-foreground/40">(you)</span>}
                    {m.is_admin && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Admin</span>
                    )}
                  </p>
                  {(m.email || m.household) && (
                    <p className="truncate text-xs text-foreground/45">{m.email || m.household}</p>
                  )}
                </div>
                {rpcReady && !isMe && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => setAdmin(m, !m.is_admin)}
                      disabled={busyId === m.id}
                      className={`press shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 disabled:opacity-50 ${
                        m.is_admin
                          ? "bg-background text-foreground/60 ring-border"
                          : "bg-primary text-white ring-primary"
                      }`}
                    >
                      {busyId === m.id ? "…" : m.is_admin ? "Remove admin" : "Make admin"}
                    </button>
                    {!m.is_admin && (
                      <button
                        onClick={() => removeMember(m)}
                        disabled={busyId === m.id}
                        aria-label={`Remove ${name}`}
                        title="Permanently remove this member"
                        className="press shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
