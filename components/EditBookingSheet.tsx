"use client";

import { useEffect, useState } from "react";
import type { CabinBooking, CabinRoomAvailability } from "@/lib/types";
import { addDays, fetchRoomAvailability, setBookingRooms, updateBookingDetails } from "@/lib/cabins";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { CabinRoomPicker } from "@/components/CabinRoomPicker";
import { useSheetDismiss } from "@/lib/hooks";

const MAX_GUESTS = 16;

/**
 * Admin-only: edit an existing request's details — dates, guest count, notes,
 * and (for a cabin broken into named rooms) which room(s) it reserves — all
 * in one sheet. Covers "they asked for 2 beds but only need 1" (deselect a
 * room), "move their room" (swap the pick), or a plain date/headcount fix.
 * Opens from Admin → Cabin requests on any pending or approved booking; save
 * writes both admin_update_cabin_booking (0095) and set_booking_rooms (0092).
 * Capacity is still enforced at review_cabin_stay() time, not here.
 */
export function EditBookingSheet({
  booking,
  onClose,
  onSaved,
}: {
  booking: CabinBooking;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [checkIn, setCheckIn] = useState(booking.checkIn);
  const [checkOut, setCheckOut] = useState(booking.checkOut);
  const [guests, setGuests] = useState(booking.guests);
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [rooms, setRooms] = useState<CabinRoomAvailability[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(booking.rooms.map((r) => r.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validRange = checkOut > checkIn;

  // Re-check room availability whenever the dates change (debounced) — a room
  // this booking already holds should still show as pickable even though the
  // RPC sees it as "taken" (by this very booking).
  useEffect(() => {
    if (!validRange) {
      setRooms([]);
      return;
    }
    let cancelled = false;
    setRoomsLoading(true);
    const t = window.setTimeout(async () => {
      const rows = await fetchRoomAvailability(booking.cabinId, checkIn, checkOut);
      if (cancelled) return;
      setRooms(rows);
      setRoomsLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [booking.cabinId, checkIn, checkOut, validRange]);

  const displayRooms = rooms.map((r) => (selected.has(r.roomId) ? { ...r, available: true } : r));
  const hasRooms = rooms.length > 0 || booking.rooms.length > 0;

  const toggle = (roomId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const onCheckIn = (v: string) => {
    setCheckIn(v);
    if (checkOut <= v) setCheckOut(addDays(v, 1));
  };

  const canSave = validRange && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const { error: detailsErr } = await updateBookingDetails(booking.id, { checkIn, checkOut, guests, notes });
    if (detailsErr) {
      setSaving(false);
      setError(detailsErr);
      return;
    }
    if (hasRooms) {
      const { error: roomsErr } = await setBookingRooms(booking.id, [...selected]);
      if (roomsErr) {
        setSaving(false);
        setError(roomsErr);
        return;
      }
    }
    setSaving(false);
    await onSaved();
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="edit-booking-title"
      header={
        <>
          <h2 id="edit-booking-title" className="text-lg font-bold">✏️ Edit request</h2>
          <p className="text-sm text-foreground/60">{booking.cabinName}</p>
        </>
      }
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
        <SectionLabel>When</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-xs text-muted">Check-in</span>
            <input type="date" value={checkIn} onChange={(e) => onCheckIn(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-xs text-muted">Check-out</span>
            <input
              type="date"
              value={checkOut}
              min={addDays(checkIn, 1)}
              onChange={(e) => setCheckOut(e.target.value)}
              className={FIELD}
            />
          </label>
        </div>
        {!validRange && <p className="px-0.5 text-xs text-accent">Check-out must be after check-in.</p>}
      </div>

      <div className="space-y-2">
        <SectionLabel>Guests</SectionLabel>
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
          <span className="text-sm font-medium">Guests staying</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer guests"
              onClick={() => setGuests((g) => Math.max(1, g - 1))}
              disabled={guests <= 1}
              className="press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums">{guests}</span>
            <button
              type="button"
              aria-label="More guests"
              onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
              disabled={guests >= MAX_GUESTS}
              className="press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>
      </div>

      {/* Room picker — only for a cabin broken into named rooms. Deselecting a
          room is how "2 beds → 1 bed" gets fixed; picking a different one is
          how a stay gets moved to another room. */}
      {validRange && hasRooms && (
        <div className="space-y-2">
          <SectionLabel>Which room{selected.size !== 1 ? "(s)" : ""}?</SectionLabel>
          <CabinRoomPicker rooms={displayRooms} selected={selected} onToggle={toggle} loading={roomsLoading} />
        </div>
      )}

      <div className="space-y-2">
        <SectionLabel>
          Notes <span className="font-normal normal-case text-faint">(optional)</span>
        </SectionLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          className={`${FIELD} w-full resize-none`}
        />
      </div>

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
    </Sheet>
  );
}
