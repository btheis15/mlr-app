"use client";

import { useEffect, useState } from "react";
import type { CabinBooking, CabinRoomAvailability } from "@/lib/types";
import { fetchRoomAvailability, setBookingRooms } from "@/lib/cabins";
import { Sheet } from "@/components/Sheet";
import { CabinRoomPicker } from "@/components/CabinRoomPicker";
import { useSheetDismiss } from "@/lib/hooks";

/**
 * Admin-only: (re)assign which room(s) an existing booking reserves — the
 * ongoing capability (not a one-time fix) for filling in/correcting room
 * assignments, including on reservations made before rooms existed. Opens
 * from Admin → Cabin requests on any pending or approved booking.
 */
export function BookingRoomsSheet({
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
  const [selected, setSelected] = useState<Set<string>>(new Set(booking.rooms.map((r) => r.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoomAvailability(booking.cabinId, booking.checkIn, booking.checkOut).then((rows) => {
      setRooms(rows);
      setLoading(false);
    });
  }, [booking.cabinId, booking.checkIn, booking.checkOut]);

  // A room this booking already holds should show as pickable even though
  // cabin_room_availability sees it as "taken" (by this very booking).
  const displayRooms = rooms.map((r) => (selected.has(r.roomId) ? { ...r, available: true } : r));

  const toggle = (roomId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await setBookingRooms(booking.id, [...selected]);
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
      labelledBy="booking-rooms-title"
      header={
        <>
          <h2 id="booking-rooms-title" className="text-lg font-bold">🛏️ Assign rooms</h2>
          <p className="text-sm text-foreground/60">{booking.cabinName} · {booking.checkIn} → {booking.checkOut}</p>
        </>
      }
      footer={
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save room assignment"}
        </button>
      }
    >
      <CabinRoomPicker rooms={displayRooms} selected={selected} onToggle={toggle} loading={loading} />
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
    </Sheet>
  );
}
