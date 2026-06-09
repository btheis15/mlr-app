"use client";

import { useEffect, useState } from "react";
import type { Cabin } from "@/lib/types";
import {
  FF_CHECK_IN,
  FF_CHECK_OUT,
  addDays,
  fetchAvailability,
  formatStay,
  requestStay,
  todayISO,
} from "@/lib/cabins";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

// Bottom sheet for requesting a room in one cabin (scaffolding + dismiss motion
// from Sheet / useSheetDismiss). Pick "All Family Fest Days" or any dates, set
// guests + a note, and submit — it lands as a pending request the admins review.
const MAX_GUESTS = 16;

export function CabinRequestSheet({
  cabin,
  onClose,
  onSubmitted,
}: {
  cabin: Cabin;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [checkIn, setCheckIn] = useState(FF_CHECK_IN);
  const [checkOut, setCheckOut] = useState(FF_CHECK_OUT);
  const [guests, setGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [available, setAvailable] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validRange = checkOut > checkIn;
  const isFFWeek = checkIn === FF_CHECK_IN && checkOut === FF_CHECK_OUT;

  // Live availability for the chosen range (debounced on date changes).
  useEffect(() => {
    if (!validRange) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const rows = await fetchAvailability(checkIn, checkOut);
      if (cancelled) return;
      const mine = rows.find((r) => r.cabinId === cabin.id);
      setAvailable(mine ? mine.available : null);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [cabin.id, checkIn, checkOut, validRange]);

  const onCheckIn = (v: string) => {
    setCheckIn(v);
    if (checkOut <= v) setCheckOut(addDays(v, 1)); // keep a valid range
  };

  const pickFamilyFest = () => {
    setCheckIn(FF_CHECK_IN);
    setCheckOut(FF_CHECK_OUT);
  };

  const submit = async () => {
    if (!validRange || pending) return;
    setPending(true);
    setError(null);
    const { error: err } = await requestStay({ cabinId: cabin.id, checkIn, checkOut, guests, notes });
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    onSubmitted();
    close();
  };

  const sel = FIELD;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="cabin-sheet-title"
      header={
        <>
          <h2 id="cabin-sheet-title" className="text-lg font-bold">
            🏡 Request a room
          </h2>
          <p className="text-sm text-foreground/60">{cabin.name}</p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={!validRange || pending}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending…" : "Submit request"}
          </button>
          <p className="mt-2 text-center text-[11px] text-foreground/45">
            An admin will review it — you&rsquo;ll get a notification and email when they do.
          </p>
        </>
      }
    >
          {/* Dates */}
          <div className="space-y-2">
            <SectionLabel>When</SectionLabel>
            <button
              type="button"
              onClick={pickFamilyFest}
              className={`press w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold ring-1 ${
                isFFWeek
                  ? "bg-primary/10 text-primary ring-primary/30"
                  : "bg-card text-foreground ring-border"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                🎉 All Family Fest Days
                {isFFWeek && <span aria-hidden>✓</span>}
              </span>
              <span className={`mt-0.5 block text-xs font-normal ${isFFWeek ? "text-primary/70" : "text-foreground/50"}`}>
                {formatStay(FF_CHECK_IN, FF_CHECK_OUT)}
              </span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-foreground/55">Check-in</span>
                <input
                  type="date"
                  value={checkIn}
                  min={todayISO()}
                  onChange={(e) => onCheckIn(e.target.value)}
                  className={sel}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="px-0.5 text-xs text-foreground/55">Check-out</span>
                <input
                  type="date"
                  value={checkOut}
                  min={addDays(checkIn, 1)}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className={sel}
                />
              </label>
            </div>
            {validRange ? (
              <p className="px-0.5 text-xs text-foreground/55">
                {formatStay(checkIn, checkOut)}
                {available !== null && (
                  <>
                    {" · "}
                    <span className={available > 0 ? "font-medium text-primary" : "font-medium text-accent"}>
                      {available > 0
                        ? `${available} of ${cabin.roomCount} room${cabin.roomCount === 1 ? "" : "s"} left`
                        : "Currently full — you can still request"}
                    </span>
                  </>
                )}
              </p>
            ) : (
              <p className="px-0.5 text-xs text-accent">Check-out must be after check-in.</p>
            )}
          </div>

          {/* Guests */}
          <div className="space-y-2">
            <SectionLabel>Who</SectionLabel>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
              <span className="text-sm font-medium">Guests staying</span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Fewer guests"
                  onClick={() => setGuests((g) => Math.max(1, g - 1))}
                  disabled={guests <= 1}
                  className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{guests}</span>
                <button
                  type="button"
                  aria-label="More guests"
                  onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
                  disabled={guests >= MAX_GUESTS}
                  className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
                >
                  +
                </button>
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <SectionLabel>
              Notes <span className="font-normal normal-case text-foreground/40">(optional)</span>
            </SectionLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Anything the admins should know — who's coming, special needs, flexible dates…"
              className={`${sel} w-full resize-none`}
            />
          </div>

          {error && (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
              {error}
            </p>
          )}
    </Sheet>
  );
}
