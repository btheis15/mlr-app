"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { getCurrentUserId, fetchProfiles } from "@/lib/roles";
import { useBusyAction, useManagedCommittee } from "@/lib/hooks";
import { fetchLiveAreaNames, baseArea, isOnArea, isAreaLead, withArea, withoutArea, isCommitteeLead } from "@/lib/committeeAdmin";
import { fetchCommitteeRoster, saveRosterEntry, deleteRosterEntry, type RosterEntry } from "@/lib/committeeRoster";

/**
 * "X members" panel — the people with app/chat access to this committee.
 * Shown to its **Lead** or an **app admin**.
 *
 * Reads and writes **committee_roster**, the single source of truth for
 * membership + chat access since migration 0057 (and where the public committee
 * page, the Feed pills, and lead/area access all read). It used to read the
 * legacy `committee_members` table, which drifted badly out of sync — anyone
 * added the modern way (straight into the roster) was invisible here, so this
 * card under-counted (3 vs the roster's 20). Now every add/remove/lead/area edit
 * goes through the roster (`saveRosterEntry`/`deleteRosterEntry`, RLS-open to a
 * committee's admins + leads), so this card and the committee page always agree,
 * and a future add via ANY surface lands in the one place.
 *
 * A "Lead" is a committee-level lead (`is_lead`, 0177) OR an area lead (a
 * "· Lead" role, 0172). Area assignments are the roster's `roles[]`.
 */
export function CommitteeMembers({ slug, name }: { slug: string; name: string }) {
  const [members, setMembers] = useState<RosterEntry[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const { busy, run } = useBusyAction();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
  // "Add someone not in the app yet" — a name-only (account-less) roster entry,
  // "Pending verification" until they sign in with a matching email.
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [editingAreas, setEditingAreas] = useState<string | null>(null);
  const [areaSelection, setAreaSelection] = useState<string[]>([]);

  // The canonical role/area list comes from the DB allow-list (admin-managed,
  // migration 0112). Non-empty only for role-based committees (Family Fest).
  const [areaOptions, setAreaOptions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetchLiveAreaNames(slug).then((a) => alive && setAreaOptions(a));
    // Profiles power the "+ Add a member" search (anyone with an account).
    fetchProfiles().then((profs) => alive && setAllProfiles(profs.map((p) => ({ id: p.id, name: p.name, avatar: p.avatarUrl }))));
    return () => {
      alive = false;
    };
  }, [slug]);

  const load = async () => {
    const roster = await fetchCommitteeRoster(slug);
    // Leads first, then by name — the same order the card always used.
    roster.sort((a, b) => Number(isCommitteeLead(b)) - Number(isCommitteeLead(a)) || (a.linkedName || a.name).localeCompare(b.linkedName || b.name));
    setMembers(roster);
    setMeId(await getCurrentUserId());
  };

  const { committeeId, canManage, setCanManage, isAdmin } = useManagedCommittee(slug, {
    watch: "committee_roster",
    load,
  });

  // Am I a lead of this committee (vs. just an app admin)? Gates the
  // Make/Unset-lead button for non-admins.
  const selfIsLead = members.some((m) => m.linkedUserId === meId && isCommitteeLead(m));

  // Run a roster write, then reload. Roster helpers return { error?: string }.
  const rosterThenReload = (id: string, fn: () => Promise<{ error?: string }>, after?: () => void) =>
    run(id, async () => {
      const { error } = await fn();
      if (error) window.alert(error);
      else {
        await load();
        after?.();
      }
    });

  const remove = (m: RosterEntry) => {
    if (!m.id) return;
    const who = m.linkedName || m.name;
    if (!window.confirm(`Remove ${who} from ${name}?`)) return;
    rosterThenReload(m.id, () => deleteRosterEntry(m.id!));
  };
  const setLead = (m: RosterEntry, makeLead: boolean) => {
    if (!m.id) return;
    rosterThenReload(m.id, () =>
      saveRosterEntry({
        id: m.id,
        committeeSlug: slug,
        name: m.name,
        email: m.email ?? null,
        phone: m.phone ?? null,
        roles: m.roles ?? [],
        linkedUserId: m.linkedUserId,
        isLead: makeLead,
      }),
    );
  };
  const add = (p: { id: string; name: string }) => {
    rosterThenReload(
      p.id,
      () =>
        saveRosterEntry({
          committeeSlug: slug,
          name: p.name,
          email: null,
          phone: null,
          roles: [],
          linkedUserId: p.id,
          isLead: false,
        }),
      () => setQuery(""),
    );
  };
  // Add a name-only person (no app account) to the committee. Their email is the
  // auto-link key — with it, their spot links to a real account the moment they
  // sign in / are invited (migration 0056/0060 triggers); without it they stay
  // "Pending" indefinitely, so we nudge for it but don't require it.
  const addPending = () => {
    const nm = pendingName.trim();
    if (!nm) return;
    rosterThenReload(
      "pending-new",
      () =>
        saveRosterEntry({
          committeeSlug: slug,
          name: nm,
          email: pendingEmail.trim() || null,
          phone: null,
          roles: [],
          linkedUserId: null,
          isLead: false,
        }),
      () => {
        setPendingName("");
        setPendingEmail("");
        setPendingOpen(false);
        setAdding(false);
      },
    );
  };
  const leaveSelf = () => {
    const sb = supabase;
    if (!sb || !committeeId || !meId) return;
    const selfLead = selfIsLead;
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
      if (isAdmin) await load();
    });
  };

  const startEditAreas = (m: RosterEntry) => {
    setAreaSelection([...(m.roles ?? [])]);
    setEditingAreas(m.id ?? null);
  };
  // Match on the base role name, not the raw string: an entry can carry a
  // trailing " · Lead" (the area-lead marker), and an exact-match toggle would
  // both fail to light the chip for a lead AND strip their lead standing on save.
  const toggleArea = (area: string) =>
    setAreaSelection((prev) =>
      isOnArea(prev, area) ? withoutArea(prev, area) : withArea(prev, area, isAreaLead(prev, area)),
    );
  const saveAreas = (m: RosterEntry) => {
    if (!m.id) return;
    rosterThenReload(
      m.id,
      () =>
        saveRosterEntry({
          id: m.id,
          committeeSlug: slug,
          name: m.name,
          email: m.email ?? null,
          phone: m.phone ?? null,
          roles: areaSelection,
          linkedUserId: m.linkedUserId,
        }),
      () => setEditingAreas(null),
    );
  };

  if (!canManage || !isSupabaseConfigured) return null;

  const linkedIds = new Set(members.map((m) => m.linkedUserId).filter(Boolean));
  const q = query.trim().toLowerCase();
  const addable = q
    ? allProfiles.filter((p) => !linkedIds.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6)
    : [];

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{name} members</h2>
        <span className="shrink-0 text-xs text-faint">{members.length}</span>
      </div>

      <ul className="space-y-1.5">
        {members.map((m) => {
          const rowId = m.id ?? m.name;
          const isMe = !!m.linkedUserId && m.linkedUserId === meId;
          const lead = isCommitteeLead(m);
          const display = m.linkedName || m.name;
          const pending = !m.linkedUserId;
          const roles = m.roles ?? [];
          return (
            <li key={rowId} className="overflow-hidden rounded-xl bg-background ring-1 ring-border">
              {/* Name row */}
              <div className="flex items-center gap-3 p-2.5">
                <Avatar name={display} url={m.linkedAvatarUrl} size={32} />
                <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">{display}</span>
                  {isMe && <span className="shrink-0 text-xs text-faint">(you)</span>}
                  {lead && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      Lead
                    </span>
                  )}
                  {pending && (
                    <span
                      className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                      title="Hasn't signed in to claim their account yet — links up automatically when they join"
                    >
                      Pending
                    </span>
                  )}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Leads and app admins can promote/demote leads. */}
                  {(isAdmin || selfIsLead) && m.id && (
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
                      disabled={busy === meId}
                      className="press rounded-full bg-background px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50"
                    >
                      {busy === meId ? "…" : "Leave"}
                    </button>
                  ) : (isAdmin || !lead) && m.id ? (
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
                                on ? "bg-primary text-white ring-primary" : "bg-card ring-border text-foreground/60"
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
                      {roles.length > 0 ? (
                        roles.map((a) => (
                          <span key={a} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {baseArea(a)}
                            {a !== baseArea(a) && <span className="font-bold"> · Lead</span>}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-faint">No area yet</span>
                      )}
                      {m.id && (
                        <button
                          type="button"
                          onClick={() => startEditAreas(m)}
                          className="press ml-0.5 text-[10px] font-semibold text-primary"
                        >
                          {roles.length > 0 ? "· Edit" : "+ Add"}
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

            {/* Add someone who isn't in the app yet — a "Pending" roster entry. */}
            {!pendingOpen ? (
              <button
                onClick={() => {
                  setPendingOpen(true);
                  setPendingName(query.trim());
                }}
                className="press border-t border-border/60 px-2 pt-2 text-left text-xs font-semibold text-primary"
              >
                + Add someone not in the app yet
              </button>
            ) : (
              <div className="space-y-1.5 border-t border-border/60 pt-2">
                <input
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  autoFocus
                  placeholder="Full name"
                  className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  value={pendingEmail}
                  onChange={(e) => setPendingEmail(e.target.value)}
                  type="email"
                  placeholder="Email (so their spot links up when they join)"
                  className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="px-0.5 text-[10px] text-faint">
                  They&rsquo;ll show as <span className="font-semibold">Pending</span> and can be put on subcommittees now. Their spot links to a real account automatically when they sign in with that email.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={addPending}
                    disabled={busy === "pending-new" || !pendingName.trim()}
                    className="press rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "pending-new" ? "…" : "Add"}
                  </button>
                  <button onClick={() => setPendingOpen(false)} className="press px-2 text-xs text-foreground/50">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setAdding(false);
                setQuery("");
                setPendingOpen(false);
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
