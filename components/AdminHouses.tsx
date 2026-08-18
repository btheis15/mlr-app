"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { House } from "@/lib/types";
import { fetchHouses, saveHouse, deleteHouse, setMemberHouse } from "@/lib/houses";
import { setHouseAdmin } from "@/lib/houseRequests";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonList } from "@/components/Skeleton";
import { plural } from "@/lib/format";
import { useBusyAction } from "@/lib/hooks";

// Profile → Admin → Houses. Create/rename/delete houses, and assign each member
// to a house (or none). A member belongs to at most one house; assignment is the
// only way to give someone their house's chat + work items. Mirrors the structure
// of AdminCommittees + the member list from AdminMembers.

interface MemberRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email?: string | null;
  house_id?: string | null;
  house_name?: string | null;
}

// Stale-while-revalidate cache for the Houses admin, mirroring `eventsCache` in
// lib/hooks.ts. AdminHouses remounts on every Profile → Admin → Houses visit;
// without this the houses list + member-assignment directory reset to empty +
// `loading` and blank/pop back in each open. Holding the last result in memory
// lets a returning view paint instantly while the background load keeps it
// current. Memory-only (per session) and written ONLY inside `load` (client-
// only, after the fetch) — never during SSR/render — so a cold first render
// starts empty (the original default output), matching the prerendered HTML and
// avoiding any hydration mismatch. Admin-only surface, so a singleton is fine.
let adminHousesCache: {
  houses: House[];
  members: MemberRow[];
  rpcReady: boolean;
  houseAdminIds: string[];
  houseAdminReady: boolean;
} | null = null;

export function AdminHouses() {
  const { userId, previewAsId } = useIdentity();
  const [houses, setHouses] = useState<House[]>(adminHousesCache?.houses ?? []);
  const [members, setMembers] = useState<MemberRow[]>(adminHousesCache?.members ?? []);
  // Who's a House Admin (migration 0194). Read straight off `profiles` rather
  // than widening admin_members()' return type — house_admin is a non-PII
  // boolean on a members-readable table, the same call migration 0181 makes for
  // `approved`. `houseAdminReady` false = 0194 hasn't been applied yet.
  const [houseAdminIds, setHouseAdminIds] = useState<Set<string>>(
    new Set(adminHousesCache?.houseAdminIds ?? []),
  );
  const [houseAdminReady, setHouseAdminReady] = useState(adminHousesCache?.houseAdminReady ?? false);
  // Warm cache ⇒ paint immediately (no "Loading…"); the effect still refetches
  // below so the cached view is reconciled with the server.
  const [loading, setLoading] = useState(!adminHousesCache);
  // Seed rpcReady from cache: it gates the member-assignment directory vs. the
  // "run migration 0064" hint, so a warm remount that left it false would flash
  // the migration notice and hide the assign panel until the refetch resolves.
  const [rpcReady, setRpcReady] = useState(adminHousesCache?.rpcReady ?? false);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏠");
  const [creating, setCreating] = useState(false);
  const [editingHouse, setEditingHouse] = useState<string | null>(null);
  const { busy: busyId, run } = useBusyAction();

  const load = async () => {
    const sb = supabase;
    if (!sb) return;
    // Only skeleton on a cold load; a warm-cache remount keeps the cached view
    // painted while this refetch reconciles in the background.
    if (!adminHousesCache) setLoading(true);
    const hs = await fetchHouses();
    setHouses(hs);

    // Pre-0194 this errors with 42703 (unknown column) — degrade to "no House
    // Admins + no toggle", never to a broken panel.
    let adminIds: string[] = [];
    let adminsReady = false;
    const ha = await sb.from("profiles").select("id, house_admin").eq("house_admin", true);
    if (!ha.error) {
      adminIds = ((ha.data ?? []) as { id: string }[]).map((r) => r.id);
      adminsReady = true;
    }
    setHouseAdminIds(new Set(adminIds));
    setHouseAdminReady(adminsReady);

    const viaRpc = await sb.rpc("admin_members");
    if (!viaRpc.error && viaRpc.data) {
      const rows = viaRpc.data as MemberRow[];
      setMembers(rows);
      setRpcReady(true);
      adminHousesCache = { houses: hs, members: rows, rpcReady: true, houseAdminIds: adminIds, houseAdminReady: adminsReady };
    } else {
      setRpcReady(false);
      // Cache the houses even when the members RPC isn't available yet (pre-
      // migration), so a revisit still paints the list instantly.
      adminHousesCache = {
        houses: hs,
        members: adminHousesCache?.members ?? [],
        rpcReady: false,
        houseAdminIds: adminIds,
        houseAdminReady: adminsReady,
      };
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `house-${houses.length + 1}`;

  const createHouse = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { error } = await saveHouse({ slug: slugify(name), name, emoji: newEmoji.trim() || "🏠", position: houses.length });
    setCreating(false);
    if (error) { window.alert(error); return; }
    setNewName("");
    setNewEmoji("🏠");
    load();
  };

  const renameHouse = async (h: House, name: string, emoji: string) => {
    const { error } = await saveHouse({ id: h.id, slug: h.slug, name: name.trim() || h.name, emoji: emoji.trim() || h.emoji, description: h.description, position: h.position });
    if (error) { window.alert(error); return; }
    setEditingHouse(null);
    load();
  };

  const removeHouse = async (h: House) => {
    if (!window.confirm(`Delete "${h.name}"?\n\nThis un-assigns its members and removes its chat + house-only work items. MLR items are untouched.`)) return;
    const { error } = await deleteHouse(h.id);
    if (error) { window.alert(error); return; }
    load();
  };

  const assign = async (m: MemberRow, hid: string | null) => {
    const { error } = await run(m.id, () => setMemberHouse(m.id, hid));
    if (error) { window.alert(error || "Couldn't assign."); return; }
    const house = hid ? houses.find((h) => h.id === hid) ?? null : null;
    // Moving houses drops the House Admin role with it (set_member_house clears
    // it server-side, 0194) — reflect that here so the star doesn't linger.
    if (hid !== m.house_id && houseAdminIds.has(m.id)) {
      setHouseAdminIds((prev) => {
        const s = new Set(prev);
        s.delete(m.id);
        if (adminHousesCache) adminHousesCache = { ...adminHousesCache, houseAdminIds: Array.from(s) };
        return s;
      });
    }
    setMembers((prev) => {
      const next = prev.map((x) => (x.id === m.id ? { ...x, house_id: hid, house_name: house?.name ?? null } : x));
      // Keep the module cache in step so a remount doesn't paint the pre-assign
      // house/counts until the next background load reconciles.
      if (adminHousesCache) adminHousesCache = { ...adminHousesCache, members: next };
      return next;
    });
  };

  // Assigning a member to a house gives up any House Admin role they held in the
  // old one (set_member_house clears it, 0194) — mirror that locally so the star
  // doesn't linger until the next background load.
  const toggleHouseAdmin = async (m: MemberRow) => {
    const next = !houseAdminIds.has(m.id);
    const { error } = await run(m.id, () => setHouseAdmin(m.id, next));
    if (error) {
      window.alert(error);
      return;
    }
    setHouseAdminIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(m.id);
      else s.delete(m.id);
      if (adminHousesCache) adminHousesCache = { ...adminHousesCache, houseAdminIds: Array.from(s) };
      return s;
    });
  };

  if (!isSupabaseConfigured) {
    return <p className="px-1 text-xs text-muted">House management turns on once the backend is connected.</p>;
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? members.filter((m) => [m.display_name, m.email, m.house_name].some((f) => f?.toLowerCase().includes(q)))
    : members;

  const counts = new Map<string, number>();
  for (const m of members) if (m.house_id) counts.set(m.house_id, (counts.get(m.house_id) ?? 0) + 1);

  // ⚠️ The House Admin rule (migration 0194): you may only set House Admins for
  // a house you are IN yourself. The RPC enforces it regardless; this is what
  // keeps the control from appearing where it would only ever fail. Resolved
  // from the real `userId` (this is a permission, and "View as" is read-only).
  const myHouseId = members.find((x) => x.id === userId)?.house_id ?? null;
  const canSetHouseAdmins = houseAdminReady && !!myHouseId && !previewAsId;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Houses</h2>
        <span className="ml-auto text-xs text-faint">{houses.length} {plural(houses.length, "house")}</span>
      </div>

      <p className="text-xs text-muted">
        A house gives its members a private chat + their own work items (on top of the resort-wide MLR list everyone
        sees). Create a house, then assign members to it below. Each person belongs to one house.
      </p>

      {/* Houses list */}
      <div className="space-y-2">
        {houses.map((h) => (
          <div key={h.id} className="rounded-xl bg-background p-2.5 ring-1 ring-border">
            {editingHouse === h.id ? (
              <HouseEditRow house={h} onSave={renameHouse} onCancel={() => setEditingHouse(null)} />
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="text-lg" aria-hidden>{h.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{h.name}</span>
                <span className="shrink-0 text-xs text-faint">{counts.get(h.id) ?? 0} {plural(counts.get(h.id) ?? 0, "member")}</span>
                <button onClick={() => setEditingHouse(h.id)} className="press rounded-full px-2 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30">Edit</button>
                <button onClick={() => removeHouse(h)} className="press rounded-full px-2 py-1 text-xs font-semibold text-accent ring-1 ring-accent/30">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create a house */}
      <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
        <p className="text-xs font-semibold text-foreground/70">Add a house</p>
        <div className="flex gap-2">
          <input
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            aria-label="Emoji"
            className="w-14 rounded-lg bg-card px-2 py-2 text-center text-lg ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="House name (e.g. MJT House)"
            className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={createHouse}
            disabled={creating || !newName.trim()}
            className="press shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? "…" : "Add"}
          </button>
        </div>
      </div>

      {!rpcReady && !loading && (
        <MigrationHint file="0064_houses.sql">
          To assign members to houses,
        </MigrationHint>
      )}

      {!houseAdminReady && !loading && (
        <MigrationHint file="0194_house_admins.sql">To name House Admins,</MigrationHint>
      )}

      {houseAdminReady && !loading && (
        <p className="text-xs text-muted">
          <span className="font-semibold">House Admins</span> approve their house&rsquo;s requests — purchases, ideas
          and reimbursements.{" "}
          {myHouseId
            ? "You can only set them for your own house."
            : "You aren't in a house yourself, so you can't set any — assign yourself to one first."}
        </p>
      )}

      {/* Member assignment */}
      {rpcReady && (
        <>
          <p className="pt-1 text-xs font-semibold text-foreground/70">Assign members</p>
          {members.length > 5 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          {loading ? (
            <SkeletonList count={2} />
          ) : shown.length === 0 ? (
            <p className="py-3 text-center text-xs text-faint">No members match that.</p>
          ) : (
            <ul className="space-y-1.5">
              {shown.map((m) => {
                const name = m.display_name?.trim() || m.email || "Member";
                return (
                  <li key={m.id} className="flex flex-col gap-2 rounded-xl bg-background p-2.5 ring-1 ring-border">
                    <div className="flex items-center gap-3">
                      <Avatar name={name} url={m.avatar_url} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{name}</p>
                        {m.email && <p className="truncate text-xs text-faint">{m.email}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <HouseChip label="None" active={!m.house_id} disabled={busyId === m.id} onClick={() => assign(m, null)} />
                      {houses.map((h) => (
                        <HouseChip
                          key={h.id}
                          label={`${h.emoji} ${h.name}`}
                          active={m.house_id === h.id}
                          disabled={busyId === m.id}
                          onClick={() => assign(m, h.id)}
                        />
                      ))}
                    </div>
                    {/* House Admin (migration 0194) — the control only appears
                        for members of YOUR OWN house, since that's the only
                        place you're allowed to set one. Everyone else just sees
                        the badge, so who holds the role stays visible. */}
                    {m.house_id && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                        {canSetHouseAdmins && m.house_id === myHouseId ? (
                          <button
                            type="button"
                            onClick={() => toggleHouseAdmin(m)}
                            disabled={busyId === m.id}
                            aria-pressed={houseAdminIds.has(m.id)}
                            className={`press rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors disabled:opacity-50 ${
                              houseAdminIds.has(m.id) ? "bg-accent text-white ring-accent" : "bg-card text-muted ring-border"
                            }`}
                          >
                            {houseAdminIds.has(m.id) ? "★ House Admin" : "☆ Make House Admin"}
                          </button>
                        ) : (
                          houseAdminIds.has(m.id) && (
                            <span className="rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent">
                              ★ House Admin
                            </span>
                          )
                        )}
                        {houseAdminIds.has(m.id) && (
                          <span className="text-[11px] text-faint">approves this house&rsquo;s requests</span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function HouseEditRow({ house, onSave, onCancel }: { house: House; onSave: (h: House, name: string, emoji: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(house.name);
  const [emoji, setEmoji] = useState(house.emoji);
  return (
    <div className="flex gap-2">
      <input value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" className="w-12 rounded-lg bg-card px-2 py-2 text-center text-lg ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      <button onClick={() => onSave(house, name, emoji)} className="press shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">Save</button>
      <button onClick={onCancel} className="press shrink-0 rounded-lg bg-background px-3 py-2 text-xs font-semibold text-muted ring-1 ring-border">Cancel</button>
    </div>
  );
}

function HouseChip({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors disabled:opacity-50 ${
        active ? "bg-primary text-white ring-primary" : "bg-card text-muted ring-border"
      }`}
    >
      {label}
    </button>
  );
}
