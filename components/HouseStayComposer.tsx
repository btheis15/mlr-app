"use client";

import { useState } from "react";
import type { HouseStay } from "@/lib/types";
import type { StayInput } from "@/lib/houseCalendar";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";
import { useDemoDate } from "@/lib/DemoDateProvider";

/**
 * Add or edit a stay on the house calendar. The signed-in member is always the
 * one staying; they add anyone else coming along as free names (spouse, kids,
 * the dog, a friend) — no account needed for a guest. A title + a free note are
 * both optional, so a stay can be as light as "these dates, just me" or as rich
 * as a labeled weekend with a full party list.
 */
export function HouseStayComposer({
  houseName,
  memberName,
  stay,
  onSave,
  onClose,
}: {
  houseName: string;
  /** The signed-in member's display name (shown as the fixed first person). */
  memberName: string;
  /** Editing an existing stay, or null to add a new one. */
  stay?: HouseStay | null;
  /** Persist — returns an error message string on failure, or nothing on success. */
  onSave: (input: StayInput) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const { today } = useDemoDate();
  const { pending, status, run } = useSaveStatus();

  const editing = !!stay;
  const [title, setTitle] = useState(stay?.title ?? "");
  const [start, setStart] = useState(stay?.startDate ?? today ?? "");
  const [end, setEnd] = useState(stay?.endDate ?? stay?.startDate ?? today ?? "");
  const [note, setNote] = useState(stay?.note ?? "");
  const [guests, setGuests] = useState<string[]>(stay?.guestNames ?? []);
  const [guestDraft, setGuestDraft] = useState("");

  const firstName = (memberName.split(" ")[0] || memberName).trim();

  const addGuest = () => {
    const name = guestDraft.trim();
    if (!name) return;
    setGuests((g) => (g.some((x) => x.toLowerCase() === name.toLowerCase()) ? g : [...g, name]));
    setGuestDraft("");
  };
  const removeGuest = (i: number) => setGuests((g) => g.filter((_, idx) => idx !== i));

  const onGuestKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addGuest();
    }
  };

  const submit = () =>
    run(async () => {
      if (!start || !end) return "Pick your dates.";
      if (end < start) return "The end date can't be before the start.";
      // Fold a half-typed guest name into the list so it isn't silently lost.
      const finalGuests = guestDraft.trim()
        ? [...guests, guestDraft.trim()].filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
        : guests;
      const res = await onSave({
        startDate: start,
        endDate: end,
        title: title.trim() || null,
        guestNames: finalGuests,
        note: note.trim() || null,
      });
      if (res.error) return res.error;
      close();
      return null;
    });

  const headCount = 1 + guests.length + (guestDraft.trim() ? 1 : 0);

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="stay-composer-title"
      header={
        <div className="pr-8">
          <h2 id="stay-composer-title" className="text-lg font-bold">
            {editing ? "Edit your stay" : "Add your stay"}
          </h2>
          <p className="mt-0.5 text-xs text-foreground/55">{houseName} calendar</p>
        </div>
      }
      footer={
        <button
          onClick={submit}
          disabled={pending}
          className="press w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Add to calendar"}
        </button>
      }
    >
      {/* Optional label */}
      <div className="space-y-1.5">
        <SectionLabel>What&rsquo;s the occasion? (optional)</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Fishing weekend, opening up the cabin…"
          className={`${FIELD} w-full`}
          maxLength={80}
        />
      </div>

      {/* Dates */}
      <div className="space-y-1.5">
        <SectionLabel>When</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="px-0.5 text-xs text-foreground/55">Arriving</span>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
              className={`${FIELD} w-full`}
            />
          </label>
          <label className="space-y-1">
            <span className="px-0.5 text-xs text-foreground/55">Leaving</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={`${FIELD} w-full`}
            />
          </label>
        </div>
        <p className="px-0.5 text-[11px] text-foreground/45">Same day arriving &amp; leaving = a day trip.</p>
      </div>

      {/* Who's coming — the member (fixed) + a free list of added people */}
      <div className="space-y-1.5">
        <SectionLabel>Who&rsquo;s coming ({headCount})</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
            {firstName} (you)
          </span>
          {guests.map((g, i) => (
            <span
              key={`${g}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-medium ring-1 ring-border"
            >
              {g}
              <button
                type="button"
                onClick={() => removeGuest(i)}
                aria-label={`Remove ${g}`}
                className="press -mr-1 text-foreground/40 hover:text-foreground"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={guestDraft}
            onChange={(e) => setGuestDraft(e.target.value)}
            onKeyDown={onGuestKey}
            placeholder="Add someone — wife, kids, the dog…"
            className={`${FIELD} min-w-0 flex-1`}
            maxLength={80}
          />
          <button
            type="button"
            onClick={addGuest}
            disabled={!guestDraft.trim()}
            className="press shrink-0 rounded-xl bg-primary/10 px-4 text-sm font-semibold text-primary ring-1 ring-primary/20 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="px-0.5 text-[11px] text-foreground/45">
          They don&rsquo;t need an account — just type their name.
        </p>
      </div>

      {/* Free note */}
      <div className="space-y-1.5">
        <SectionLabel>Anything else? (optional)</SectionLabel>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Bringing the boat, arriving late Friday, extra room if anyone wants to join…"
          className={`${FIELD} w-full resize-none`}
          maxLength={500}
        />
      </div>

      {status && <p className="text-center text-sm font-medium text-accent">{status}</p>}
    </Sheet>
  );
}
