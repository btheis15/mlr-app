"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { getCurrentUserId, fetchProfiles, profileMap } from "@/lib/roles";
import { useBusyAction, useManagedCommittee } from "@/lib/hooks";
import {
  fetchLiveAreaNames,
  baseArea,
  isOnArea,
  isAreaLead,
  withArea,
  withoutArea,
} from "@/lib/committeeAdmin";

/**
 * "X members" panel — the people with app/chat access to this committee.
 * Shown to its **Lead** or an **app admin** (migration 0015). There is no
 * separate "committee admin" tier (deliberately removed, migration 0076) —
 * within a committee you're either a plain member or a Lead; the only admins
 * are overall app admins. Leads can add/remove regular members and, as of
 * migration 0051, can promote/demote leads too (was admin-only). Area
 * assignments live in committee_members.areas (migration 0051) and are
 * editable inline here. All writes go through the gated set_committee_member /
 * set_committee_lead / set_committee_areas RPCs.
 */
interface Row {
  id: string;
  name: string;
  avatar?: string | null;
  role: string | null;
  areas: string[];
}

export function CommitteeMembers({ slug, name }: { slug: string; name: string }) {
  const [members, setMembers] = useState<Row[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const { busy, run } = useBusyAction();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [allProfiles, setAllProfiles] = useState<Row[]>([]);
  const [editingAreas, setEditingAreas] = useState<string | null>(null);
  const [areaSelection, setAreaSelection] = useState<string[]>([]);

  // The canonical role/area list comes from the DB allow-list (admin-managed,
  // migration 0112). Non-empty only for role-based committees (Family Fest).
  const [areaOptions, setAreaOptions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetchLiveAreaNames(slug).then((a) => alive && setAreaOptions(a));
    return () => {
      alive = false;
    };
  }, [slug]);

  const load = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    const [{ data: mem }, profs] = await Promise.all([
      sb.from("committee_members").select("user_id, role, areas").eq("committee_id", cid),
      fetchProfiles(),
    ]);
    setMeId(await getCurrentUserId());
    const pm = profileMap(profs);
    const rows: Row[] = (
      (mem ?? []) as { user_id: string; role: string | null; areas: string[] | null }[]
    ).map((m) => ({
      id: m.user_id,
      name: pm.get(m.user_id)?.name || "Member",
      avatar: pm.get(m.user_id)?.avatarUrl ?? null,
      role: m.role,
      areas: m.areas ?? [],
    }));
    rows.sort((a, b) => (a.role === "Lead" ? -1 : b.role === "Lead" ? 1 : 0) || a.name.localeCompare(b.name));
    setMembers(rows);
    setAllProfiles(profs.map((p) => ({ id: p.id, name: p.name, avatar: p.avatarUrl, role: null, areas: [] })));
  };

  const { committeeId, canManage, setCanManage, isAdmin } = useManagedCommittee(slug, {
    watch: "committee_members",
    load,
  });

  // True if the logged-in user is a lead of this committee (as opposed to just
  // an app admin). Used to gate the Make/Unset lead button for non-app-admins.
  const selfIsLead = members.find((m) => m.id === meId)?.role === "Lead";

  const rpcThenReload = (
    id: string,
    rpc: () => PromiseLike<{ error: { message: string } | null }>,
    after?: () => void,
  ) =>
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
    rpcThenReload(m.id, () =>
      sb.rpc("set_committee_member", { cid: committeeId, target: m.id, is_member: false }),
    );
  };
  const setLead = (m: Row, makeLead: boolean) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    rpcThenReload(m.id, () =>
      sb.rpc("set_committee_lead", { cid: committeeId, target: m.id, is_lead: makeLead }),
    );
  };
  const add = (p: Row) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    rpcThenReload(
      p.id,
      () => sb.rpc("set_committee_member", { cid: committeeId, target: p.id, is_member: true }),
      () => setQuery(""),
    );
  };
  const leaveSelf = () => {
    const sb = supabase;
    if (!sb || !committeeId || !meId) return;
    const selfLead = members.find((m) => m.id === meId)?.role === "Lead";
    const msg = selfLead
      ? `Leave ${name}? You're a Lead — another lead or admin will need to assign a new one. You can ask to rejoin later.`
      : `Leave ${name}? You'll lose access to its chat (you can ask to rejoin later).`;
    if (!window.confirm(msg)) return;
    run(meId, async () => {
      const { error } = await sb.rpc("leave_committee", { cid: committeeId });
      if (error) {
        window.alert(error.message);
        return;
      }
      setCanManage(isAdmin);
      if (isAdmin) await load(committeeId);
    });
  };

  const startEditAreas = (m: Row) => {
    setAreaSelection([...m.areas]);
    setEditingAreas(m.id);
  };
  // Match on the base role name, not the raw string: an entry can carry a
  // trailing " · Lead" (the area-lead marker), and an exact-match toggle would
  // both fail to light the chip for a lead AND strip their lead standing on save.
  // Toggling ON preserves whatever standing they already had.
  const toggleArea = (area: string) =>
    setAreaSelection((prev) =>
      isOnArea(prev, area) ? withoutArea(prev, area) : withArea(prev, area, isAreaLead(prev, area)),
    );
  const saveAreas = (m: Row) => {
    const sb = supabase;
    if (!sb || !committeeId) return;
    rpcThenReload(
      m.id,
      () => sb.rpc("set_committee_areas", { cid: committeeId, target: m.id, areas: areaSelection }),
      () => setEditingAreas(null),
    );
  };

  if (!canManage || !isSupabaseConfigured) return null;

  const memberIds = new Set(members.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const addable = q
    ? allProfiles.filter((p) => !memberIds.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6)
    : [];

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
          {isAdmin ? "Admin" : "Lead"}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{name} members</h2>
          <p className="text-xs text-faint">App access · chat · management</p>
        </div>
        <span className="text-xs text-faint">{members.length}</span>
      </div>

      <ul className="space-y-1.5">
        {members.map((m) => {
          const isMe = m.id === meId;
          const lead = m.role === "Lead";
          return (
            <li key={m.id} className="overflow-hidden rounded-xl bg-background ring-1 ring-border">
              {/* Name row */}
              <div className="flex items-center gap-3 p-2.5">
                <Avatar name={m.name} url={m.avatar} size={32} />
                <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">{m.name}</span>
                  {isMe && <span className="shrink-0 text-xs text-faint">(you)</span>}
                  {lead && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      Lead
                    </span>
                  )}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Leads and app admins can promote/demote leads (migration 0051) */}
                  {(isAdmin || selfIsLead) && (
                    <button
                      onClick={() => setLead(m, !lead)}
                      disabled={busy === m.id}
                      className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/40 disabled:opacity-50"
                    >
                      {busy === m.id ? "…" : lead ? "Unset lead" : "Make lead"}
                    </button>
                  )}
                  {isMe ? (
                    <button
                      onClick={leaveSelf}
                      disabled={busy === m.id}
                      className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50"
                    >
                      {busy === m.id ? "…" : "Leave"}
                    </button>
                  ) : (isAdmin || !lead) ? (
                    <button
                      onClick={() => remove(m)}
                      disabled={busy === m.id}
                      className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Area row — only for role-based committees (e.g. Family Fest) */}
              {areaOptions.length > 0 && (
                <div className="border-t border-border/50 px-3 py-2">
                  {editingAreas === m.id ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {areaOptions.map((area) => {
                          const on = isOnArea(areaSelection, area);
                          return (
                            <button
                              key={area}
                              type="button"
                              onClick={() => toggleArea(area)}
                              className={`press rounded-full px-2 py-0.5 text-xs font-medium ring-1 transition-colors ${
                                on
                                  ? "bg-primary text-white ring-primary"
                                  : "bg-card ring-border text-foreground/60"
                              }`}
                            >
                              {area}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveAreas(m)}
                          disabled={busy === m.id}
                          className="press rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busy === m.id ? "…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingAreas(null)}
                          className="press rounded-full px-3 py-1 text-xs font-medium text-foreground/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      {m.areas.length > 0 ? (
                        m.areas.map((a) => (
                          <span
                            key={a}
                            className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                          >
                            {baseArea(a)}
                            {a !== baseArea(a) && <span className="font-bold"> · Lead</span>}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-faint">No area yet</span>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => startEditAreas(m)}
                          className="press ml-0.5 text-[10px] font-semibold text-primary"
                        >
                          {m.areas.length > 0 ? "· Edit" : "+ Add"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {members.length === 0 && (
          <p className="py-2 text-center text-xs text-faint">
            No members yet — approve a request or add someone below.
          </p>
        )}
      </ul>

      <div className="space-y-2">
        {!adding ? (
          <button onClick={() => setAdding(true)} className="press text-xs font-semibold text-primary">
            + Add a member
          </button>
        ) : (
          <div className="space-y-1.5 rounded-xl bg-background p-2 ring-1 ring-border">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search signed-in members…"
              autoFocus
              className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            {addable.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                disabled={busy === p.id}
                className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-card disabled:opacity-50"
              >
                <Avatar name={p.name} url={p.avatar} size={22} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-primary">+ Add</span>
              </button>
            ))}
            {q && addable.length === 0 && (
              <p className="px-2 py-1 text-xs text-faint">No one matches (or already a member).</p>
            )}
            <button
              onClick={() => {
                setAdding(false);
                setQuery("");
              }}
              className="press px-2 text-xs text-foreground/50"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
