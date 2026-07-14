"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCabinsAdmin, saveCabin } from "@/lib/cabins";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import type { Cabin } from "@/lib/types";

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

  const rooms = parseInt(roomCount, 10);
  const beds = bedCount.trim() ? parseInt(bedCount, 10) : null;
  const validRooms = Number.isFinite(rooms) && rooms >= 1;
  const validBeds = beds === null || (Number.isFinite(beds) && beds >= 0);
  const canSave = name.trim().length > 0 && validRooms && validBeds && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const { error: err } = await saveCabin({
      id: cabin.id,
      name: name.trim(),
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
            value={roomCount}
            onChange={(e) => setRoomCount(e.target.value)}
            className={FIELD}
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
        Rooms is used for booking capacity; beds is just so people know if they&rsquo;d be sharing a bed or room.
      </p>

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
