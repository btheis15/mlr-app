"use client";

import { useEffect, useState } from "react";
import type { CabinBooking, CabinRoomAvailability } from "@/lib/types";
import { fetchRoomAvailability, setBookingRooms } from "@/lib/cabins";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { CabinRoomPicker } from "@/components/CabinRoomPicker";
import { useSheetDismiss } from "@/lib/hooks";

/**
 * Self-service room picker for a member's OWN booking that doesn't have a
 * room assigned yet — the flip side of CabinRequestSheet's "not sure yet"
 * skip: someone booked (possibly an admin booking on their behalf) without
 * knowing the room, and now that they do, they pick it here instead of
 * waiting on an admin. Writes through the same setBookingRooms RPC as the
 * admin's EditBookingSheet — migration 0106 widened it to also allow the
 * booking's own requester, not just admins. Picking a room here blocks it off
 * from other bookings the same way the admin flow does (the RPC's overlap
 * check doesn't care who's calling).
 */
export function PickMyRoomSheet({
  booking,
  onClose,
  onSaved,
}: {
  booking: CabinBooking;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [rooms, setRooms] = useState<CabinRoomAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRoomAvailability(booking.cabinId, booking.checkIn, booking.checkOut).then((rows) => {
      if (!cancelled) {
        setRooms(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [booking.cabinId, booking.checkIn, booking.checkOut]);

  const toggle = (roomId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const save = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    setError(null);
    const { error: err } = await setBookingRooms(booking.id, [...selected]);
    if (err) {
      setSaving(false);
      setError(err);
      return;
    }
    setSaving(false);
    await onSaved();
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="pick-room-title"
      header={
        <>
          <h2 id="pick-room-title" className="text-lg font-bold">🛏️ Choose your room</h2>
          <p className="text-sm text-foreground/60">{booking.cabinName}</p>
        </>
      }
      footer={
        <button
          type="button"
          onClick={save}
          disabled={selected.size === 0 || saving}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save room"}
        </button>
      }
    >
      <div className="space-y-2">
        <SectionLabel>Which room{selected.size !== 1 ? "(s)" : ""}?</SectionLabel>
        <p className="px-0.5 text-xs text-muted">Need 2 beds? Pick 2 rooms.</p>
        <CabinRoomPicker rooms={rooms} selected={selected} onToggle={toggle} loading={loading} />
      </div>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
    </Sheet>
  );
}
