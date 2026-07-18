"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import {
  fetchCabinsAdmin,
  fetchCabinRooms,
  createCabin,
  saveCabin,
  saveCabinRoom,
  deleteCabinRoom,
} from "@/lib/cabins";
import { fetchProfiles, profileMap, type ProfileLite } from "@/lib/roles";
import { Avatar } from "@/components/Avatar";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import type { Cabin, CabinRoom } from "@/lib/types";

const KIND_META: Record<Cabin["kind"], { label: string; icon: string }> = {
  cabin: { label: "Resort cabin", icon: "🏕️" },
  house: { label: "Private house", icon: "🏠" },
};

/**
 * Admin editor for the places to stay themselves (Admin → Cabin requests,
 * above the approval queue): add a brand-new place (a shared resort cabin, or
 * someone's private house with spare space — migration 0114), then edit its
 * name, kind, bedrooms/beds, a free-form notes/condition line members see on
 * /request-stay, who approves its requests, and an active toggle to
 * temporarily pull it out of the bookable list (e.g. mid-renovation) without
 * deleting its booking history. Backed by direct RLS-gated writes to `cabins`
 * (migrations 0089/0114) — the same shape as AdminHouses editing `houses`.
 */
export function AdminCabinDetails() {
  const { isAdmin } = useIdentity();
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [people, setPeople] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cabin | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const rows = await fetchCabinsAdmin();
    setCabins(rows);
    const ids = Array.from(new Set(rows.map((c) => c.approverUserId).filter(Boolean) as string[]));
    setPeople(profileMap(await fetchProfiles(ids)));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin || !isSupabaseConfigured) return;
    load();
  }, [isAdmin, load]);

  if (!isAdmin || !isSupabaseConfigured) return null;

  return (
    <div className="space-y-2">
      <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Places to stay</h3>
      {loading ? (
        <p className="rounded-xl bg-card p-3 text-center text-xs text-muted ring-1 ring-border">Loading…</p>
      ) : (
        <div className="space-y-2">
          {cabins.map((c) => {
            const approver = c.approverUserId ? people.get(c.approverUserId) : undefined;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setEditing(c)}
                className="press flex w-full items-start justify-between gap-2 rounded-2xl bg-card p-3 text-left ring-1 ring-border"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span aria-hidden>{KIND_META[c.kind].icon}</span>
                    {c.name}
                    {!c.active && (
                      <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted">Closed</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {c.roomCount} room{c.roomCount === 1 ? "" : "s"}
                    {c.bedCount != null && ` · ${c.bedCount} bed${c.bedCount === 1 ? "" : "s"}`}
                  </p>
                  <p className="mt-0.5 text-xs text-faint">
                    Approver: {approver ? approver.name : "All admins"}
                  </p>
                  {c.notes && <p className="mt-1 text-xs text-faint line-clamp-2">{c.notes}</p>}
                </div>
                <span className="shrink-0 text-xs font-medium text-primary">Edit</span>
              </button>
            );
          })}
        </div>
      )}

      {adding ? (
        <NewPlaceCard
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="press w-full rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-sm font-semibold text-primary"
        >
          ＋ Add a place
        </button>
      )}

      {editing && (
        <CabinEditSheet
          cabin={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ── Add a new place (cabin or house) ────────────────────────────────────────
// Mirrors AdminCommittees' inline "New committee" card: a minimal create step
// (name, kind, starting room count, approver) — once it exists, the admin
// taps into it to add bedrooms/beds and everything else via CabinEditSheet.
function NewPlaceCard({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Cabin["kind"]>("cabin");
  const [roomCount, setRoomCount] = useState("1");
  const [approver, setApprover] = useState<ProfileLite | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rooms = parseInt(roomCount, 10);
  const canSave = name.trim().length > 0 && Number.isFinite(rooms) && rooms >= 1 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createCabin({
      name: name.trim(),
      kind,
      roomCount: rooms,
      bedCount: null,
      notes: null,
      approverUserId: approver?.id ?? null,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onCreated();
  };

  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-primary/30">
      <h3 className="text-sm font-semibold">New place</h3>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name — e.g. Grandma's Cottage"
        className={`${FIELD} w-full`}
      />
      <div className="flex gap-2">
        {(Object.keys(KIND_META) as Cabin["kind"][]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`press flex-1 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ${
              kind === k ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"
            }`}
          >
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="px-0.5 text-xs text-muted">Starting room count</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={roomCount}
          onChange={(e) => setRoomCount(e.target.value)}
          className={FIELD}
        />
      </label>
      <ApproverPicker
        approver={approver}
        onPick={() => setPickerOpen(true)}
        onClear={() => setApprover(null)}
      />
      {error && <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="press flex-1 rounded-xl bg-background py-2.5 text-sm font-semibold ring-1 ring-border">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={!canSave} className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
      {pickerOpen && (
        <ApproverPickerSheet
          selectedId={approver?.id ?? null}
          onClose={() => setPickerOpen(false)}
          onPick={(m) => {
            setApprover(m);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Row that opens the approver picker — "All Admins" (the default, no
 *  specific person) vs. a named member. Shared between the create card and
 *  the edit sheet. */
function ApproverPicker({
  approver,
  onPick,
  onClear,
}: {
  approver: ProfileLite | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1">
      <span className="px-0.5 text-xs text-muted">Who approves requests</span>
      <button
        type="button"
        onClick={onPick}
        className="press flex w-full items-center gap-2 rounded-xl bg-background px-3 py-2.5 ring-1 ring-border"
      >
        {approver ? (
          <Avatar name={approver.name} url={approver.avatarUrl} size={24} />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm">🛡️</span>
        )}
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
          {approver ? approver.name : "All Admins"}
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">{approver ? "Change" : "Pick someone"}</span>
      </button>
      {approver && (
        <button type="button" onClick={onClear} className="press px-0.5 text-xs font-medium text-accent">
          Reset to All Admins
        </button>
      )}
      <p className="px-0.5 text-xs text-faint">
        {approver
          ? `${approver.name} reviews this place's requests — they don't need to be an app admin.`
          : "Any app admin can approve or deny requests for this place."}
      </p>
    </div>
  );
}

function ApproverPickerSheet({
  selectedId,
  onClose,
  onPick,
}: {
  selectedId: string | null;
  onClose: () => void;
  onPick: (m: ProfileLite) => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [members, setMembers] = useState<ProfileLite[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetchProfiles().then((ppl) => setMembers([...ppl].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  const filtered = q.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
    : members;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="approver-picker-title"
      header={<h2 id="approver-picker-title" className="text-lg font-bold">Who approves this place?</h2>}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search family…" className={`${FIELD} w-full`} />
      <ul className="space-y-1">
        {filtered.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick(m)}
              className="press flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left ring-1 ring-border"
            >
              <Avatar name={m.name} url={m.avatarUrl} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
              {selectedId === m.id && <span className="text-primary">✓</span>}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="py-6 text-center text-xs text-foreground/50">No members found.</li>}
      </ul>
    </Sheet>
  );
}

function CabinEditSheet({
  cabin,
  onClose,
  onSaved,
}: {
  cabin: Cabin;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [name, setName] = useState(cabin.name);
  const [kind, setKind] = useState<Cabin["kind"]>(cabin.kind);
  const [roomCount, setRoomCount] = useState(String(cabin.roomCount));
  const [bedCount, setBedCount] = useState(cabin.bedCount != null ? String(cabin.bedCount) : "");
  const [notes, setNotes] = useState(cabin.notes ?? "");
  const [active, setActive] = useState(cabin.active);
  const [approver, setApprover] = useState<ProfileLite | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namedRooms, setNamedRooms] = useState<CabinRoom[]>([]);

  const loadRooms = useCallback(async () => {
    setNamedRooms(await fetchCabinRooms(cabin.id));
  }, [cabin.id]);
  useEffect(() => { loadRooms(); }, [loadRooms]);

  useEffect(() => {
    if (!cabin.approverUserId) return;
    let cancelled = false;
    fetchProfiles([cabin.approverUserId]).then((ppl) => {
      if (!cancelled && ppl[0]) setApprover(ppl[0]);
    });
    return () => { cancelled = true; };
  }, [cabin.approverUserId]);

  // Once the cabin has named rooms, the plain room-count field is derived
  // (active room count) rather than a separate number an admin sets — the
  // room list below is the real capacity now.
  const hasNamedRooms = namedRooms.length > 0;

  const activeNamedRoomCount = namedRooms.filter((r) => r.active).length;
  const rooms = hasNamedRooms ? activeNamedRoomCount : parseInt(roomCount, 10);
  const beds = bedCount.trim() ? parseInt(bedCount, 10) : null;
  const validRooms = hasNamedRooms || (Number.isFinite(rooms) && rooms >= 1);
  const validBeds = beds === null || (Number.isFinite(beds) && beds >= 0);
  const canSave = name.trim().length > 0 && validRooms && validBeds && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const { error: err } = await saveCabin({
      id: cabin.id,
      name: name.trim(),
      kind,
      // Kept in sync with the named-room count when the cabin has any, so
      // the legacy field never drifts from the real capacity.
      roomCount: rooms,
      bedCount: beds,
      notes: notes.trim() || null,
      active,
      approverUserId: approver?.id ?? null,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    await onSaved();
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="cabin-edit-title"
      header={<h2 id="cabin-edit-title" className="text-lg font-bold">🏡 Edit {cabin.name}</h2>}
      footer={
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      }
    >
      <div className="space-y-2">
        <SectionLabel>Name</SectionLabel>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} w-full`} />
      </div>

      <div className="space-y-1">
        <SectionLabel>Kind</SectionLabel>
        <div className="flex gap-2">
          {(Object.keys(KIND_META) as Cabin["kind"][]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`press flex-1 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ${
                kind === k ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"
              }`}
            >
              {KIND_META[k].icon} {KIND_META[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="px-0.5 text-xs text-muted">Rooms</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={hasNamedRooms ? activeNamedRoomCount : roomCount}
            onChange={(e) => setRoomCount(e.target.value)}
            disabled={hasNamedRooms}
            className={`${FIELD} disabled:opacity-60`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="px-0.5 text-xs text-muted">{hasNamedRooms ? "Extra beds" : "Beds"}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Optional"
            value={bedCount}
            onChange={(e) => setBedCount(e.target.value)}
            className={FIELD}
          />
        </label>
      </div>
      <p className="px-0.5 text-xs text-faint">
        {hasNamedRooms
          ? "Rooms is now based on the bedrooms below (open ones count). \"Extra beds\" is for beds outside those bedrooms — a fold-out couch, sleeping bags, etc. — just informational."
          : "Rooms is used for booking capacity; beds is just so people know if they’d be sharing a bed or room."}
      </p>

      <CabinRoomsEditor cabinId={cabin.id} rooms={namedRooms} onChanged={loadRooms} />

      <ApproverPicker
        approver={approver}
        onPick={() => setPickerOpen(true)}
        onClear={() => setApprover(null)}
      />
      {pickerOpen && (
        <ApproverPickerSheet
          selectedId={approver?.id ?? null}
          onClose={() => setPickerOpen(false)}
          onPick={(m) => {
            setApprover(m);
            setPickerOpen(false);
          }}
        />
      )}

      <div className="space-y-2">
        <SectionLabel>
          Notes <span className="font-normal normal-case text-faint">(shown to members)</span>
        </SectionLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Anything people should know — water not hooked up yet, windows being sealed, etc."
          className={`${FIELD} w-full resize-none`}
        />
      </div>

      <label className="flex items-center justify-between rounded-xl bg-card p-3 ring-1 ring-border">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Open for booking</span>
          <span className="block text-xs text-muted">Turn off to pull it from the bookable list (e.g. mid-renovation) without losing its history.</span>
        </span>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="ml-3 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
        />
      </label>

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
    </Sheet>
  );
}

/**
 * Named rooms/areas within a cabin (migration 0092) — e.g. "Upstairs South
 * Room". Each row edits/saves/deletes independently (like CommitteeMembers'
 * inline area editor) rather than bundling into the cabin-level Save, since
 * these are a separate table. A room marked inactive shows as "temporarily
 * closed" everywhere it's used (booking pickers, availability).
 */
function CabinRoomsEditor({
  cabinId,
  rooms,
  onChanged,
}: {
  cabinId: string;
  rooms: CabinRoom[];
  onChanged: () => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBeds, setNewBeds] = useState("1");

  const editRoom = (room: CabinRoom, patch: Partial<Pick<CabinRoom, "name" | "beds" | "description" | "active">>) =>
    run(room.id, () =>
      saveCabinRoom({
        id: room.id,
        cabinId,
        name: room.name,
        beds: room.beds,
        description: room.description,
        active: room.active,
        ...patch,
      }),
    );

  const run = async (id: string, rpc: () => Promise<{ error?: string }>) => {
    setBusyId(id);
    const { error } = await rpc();
    setBusyId(null);
    if (error) { window.alert(error); return; }
    await onChanged();
  };

  const remove = (room: CabinRoom) => {
    if (!window.confirm(`Delete "${room.name}"? Any past bookings keep their history but lose this room link.`)) return;
    run(room.id, () => deleteCabinRoom(room.id));
  };

  const addRoom = async () => {
    if (!newName.trim()) return;
    const beds = parseInt(newBeds, 10);
    setBusyId("new");
    const { error } = await saveCabinRoom({
      cabinId,
      name: newName.trim(),
      beds: Number.isFinite(beds) && beds >= 0 ? beds : 1,
      active: true,
      sortOrder: rooms.length,
    });
    setBusyId(null);
    if (error) { window.alert(error); return; }
    setNewName("");
    setNewBeds("1");
    setAdding(false);
    await onChanged();
  };

  return (
    <div className="space-y-2">
      <SectionLabel>Bedrooms / areas</SectionLabel>
      {rooms.length > 0 && (
        <ul className="space-y-1.5">
          {rooms.map((r) => (
            <li key={r.id} className="space-y-1.5 rounded-xl bg-card p-2 ring-1 ring-border">
              <div className="flex items-center gap-2">
                <input
                  value={r.name}
                  onChange={(e) => editRoom(r, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={r.beds}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v >= 0) editRoom(r, { beds: v });
                  }}
                  aria-label={`${r.name} beds`}
                  className="w-14 shrink-0 rounded-lg bg-background px-2 py-1.5 text-center text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => editRoom(r, { active: !r.active })}
                  disabled={busyId === r.id}
                  className={`press shrink-0 rounded-full px-2 py-1.5 text-[10px] font-semibold ring-1 disabled:opacity-50 ${
                    r.active ? "bg-primary/10 text-primary ring-primary/30" : "bg-foreground/10 text-muted ring-border"
                  }`}
                >
                  {r.active ? "Open" : "Closed"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  disabled={busyId === r.id}
                  aria-label={`Delete ${r.name}`}
                  className="press shrink-0 text-foreground/30 hover:text-accent disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
              <input
                value={r.description ?? ""}
                onChange={(e) => editRoom(r, { description: e.target.value || null })}
                placeholder="Description (optional) — e.g. small room, no closet"
                aria-label={`${r.name} description`}
                className="w-full rounded-lg bg-background px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
              />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex items-center gap-2 rounded-xl bg-background p-2 ring-1 ring-border">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Room/area name"
            autoFocus
            className="min-w-0 flex-1 rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={newBeds}
            onChange={(e) => setNewBeds(e.target.value)}
            aria-label="Beds"
            className="w-14 shrink-0 rounded-lg bg-card px-2 py-1.5 text-center text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={addRoom}
            disabled={busyId === "new" || !newName.trim()}
            className="press shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="press shrink-0 text-xs text-foreground/50">
            ✕
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="press text-xs font-semibold text-primary">
          + Add a room/area
        </button>
      )}
      {rooms.length === 0 && (
        <p className="px-0.5 text-xs text-faint">
          No named rooms yet — the plain "Rooms" number above still applies until you add some.
        </p>
      )}
    </div>
  );
}
