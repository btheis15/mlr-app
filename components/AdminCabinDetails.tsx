"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCabinsAdmin, fetchCabinRooms, saveCabin, saveCabinRoom, deleteCabinRoom } from "@/lib/cabins";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import type { Cabin, CabinRoom } from "@/lib/types";

/**
 * Admin editor for the cabins themselves (Admin → Cabin requests, above the
 * approval queue): name, room count, bed count, a free-form notes/condition
 * line members see on /request-stay, and an active toggle to temporarily pull
 * a cabin out of the bookable list (e.g. mid-renovation) without deleting its
 * booking history. Backed by direct RLS-gated writes to `cabins` (migration
 * 0089) — the same shape as AdminHouses editing `houses`.
 */
export function AdminCabinDetails() {
  const { isAdmin } = useIdentity();
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cabin | null>(null);

  const load = useCallback(async () => {
    setCabins(await fetchCabinsAdmin());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin || !isSupabaseConfigured) return;
    load();
  }, [isAdmin, load]);

  if (!isAdmin || !isSupabaseConfigured) return null;

  return (
    <div className="space-y-2">
      <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Cabins</h3>
      {loading ? (
        <p className="rounded-xl bg-card p-3 text-center text-xs text-muted ring-1 ring-border">Loading…</p>
      ) : (
        <div className="space-y-2">
          {cabins.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="press flex w-full items-start justify-between gap-2 rounded-2xl bg-card p-3 text-left ring-1 ring-border"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  {c.name}
                  {!c.active && (
                    <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted">Closed</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {c.roomCount} room{c.roomCount === 1 ? "" : "s"}
                  {c.bedCount != null && ` · ${c.bedCount} bed${c.bedCount === 1 ? "" : "s"}`}
                </p>
                {c.notes && <p className="mt-1 text-xs text-faint line-clamp-2">{c.notes}</p>}
              </div>
              <span className="shrink-0 text-xs font-medium text-primary">Edit</span>
            </button>
          ))}
        </div>
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
  const [roomCount, setRoomCount] = useState(String(cabin.roomCount));
  const [bedCount, setBedCount] = useState(cabin.bedCount != null ? String(cabin.bedCount) : "");
  const [notes, setNotes] = useState(cabin.notes ?? "");
  const [active, setActive] = useState(cabin.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namedRooms, setNamedRooms] = useState<CabinRoom[]>([]);

  const loadRooms = useCallback(async () => {
    setNamedRooms(await fetchCabinRooms(cabin.id));
  }, [cabin.id]);
  useEffect(() => { loadRooms(); }, [loadRooms]);

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
      // Kept in sync with the named-room count when the cabin has any, so
      // the legacy field never drifts from the real capacity.
      roomCount: rooms,
      bedCount: beds,
      notes: notes.trim() || null,
      active,
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
          <span className="px-0.5 text-xs text-muted">Beds</span>
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
          ? "Rooms is now based on the named rooms below (open ones count). Beds is a separate overall total, just informational."
          : "Rooms is used for booking capacity; beds is just so people know if they’d be sharing a bed or room."}
      </p>

      <CabinRoomsEditor cabinId={cabin.id} rooms={namedRooms} onChanged={loadRooms} />

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

  const editRoom = (room: CabinRoom, patch: Partial<Pick<CabinRoom, "name" | "beds" | "active">>) =>
    run(room.id, () => saveCabinRoom({ id: room.id, cabinId, name: room.name, beds: room.beds, active: room.active, ...patch }));

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
      <SectionLabel>Rooms / areas</SectionLabel>
      {rooms.length > 0 && (
        <ul className="space-y-1.5">
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-border">
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
