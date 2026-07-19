"use client";

import { useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { createMeeting, type MeetingScope } from "@/lib/meetings";
import { toISODate } from "@/lib/festSeason";

// Bottom-sheet composer for proposing a meeting (migration 0116): a title,
// optional note, and up to 10 candidate date+time slots (add/remove rows), plus
// an optional "respond by" date. Only shown to organizers (admin, or a
// committee/area Lead — the DB enforces it via create_meeting). Mirrors
// PollComposer's shape; the slot rows reuse EventComposer's date/time inputs.

const MAX_SLOTS = 10;
const DURATIONS = [30, 45, 60, 90, 120];

interface SlotRow {
  date: string;
  time: string;
  durationMin: number;
}

const emptyRow = (): SlotRow => ({ date: "", time: "", durationMin: 60 });

export function MeetingComposer({
  scope,
  roomLabel,
  onClose,
  onCreated,
}: {
  scope: MeetingScope;
  /** e.g. "Meals" or "MJT House" — shown in the header for context. */
  roomLabel: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slots, setSlots] = useState<SlotRow[]>([emptyRow()]);
  const [respondBy, setRespondBy] = useState("");
  const { pending, status, run } = useSaveStatus();

  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addSlot = () => setSlots((rows) => (rows.length < MAX_SLOTS ? [...rows, emptyRow()] : rows));
  const removeSlot = (i: number) =>
    setSlots((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const submit = () =>
    run(async () => {
      const t = title.trim();
      if (!t) return "Add a title first.";
      const filled = slots.filter((s) => s.date && s.time);
      if (filled.length === 0) return "Add at least one date & time.";
      const isoSlots = filled.map((s) => ({
        // date + time are local; toISOString normalizes to UTC for storage.
        startsAt: new Date(`${s.date}T${s.time}`).toISOString(),
        durationMin: s.durationMin,
      }));
      const res = await createMeeting({
        scope,
        title: t,
        description: description.trim() || null,
        slots: isoSlots,
        respondBy: respondBy || null,
      });
      if (res.error) return res.error;
      onCreated();
      close();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="meeting-composer-title"
      header={
        <div className="pr-10">
          <h2 id="meeting-composer-title" className="text-lg font-bold">
            📅 Schedule a meeting
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Propose times for {roomLabel} — everyone marks when they’re free
          </p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {status && <p className="text-sm font-medium text-red-600">{status}</p>}
          <button
            onClick={submit}
            disabled={pending}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending…" : "Propose meeting"}
          </button>
        </div>
      }
    >
      <div className="space-y-1.5">
        <SectionLabel>What’s the meeting?</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Plan the Saturday cookout"
          maxLength={200}
          className={`${FIELD} w-full`}
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Note (optional)</SectionLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Agenda, what to bring, anything to add…"
          rows={2}
          maxLength={500}
          className={`${FIELD} w-full resize-none`}
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Time options (up to {MAX_SLOTS})</SectionLabel>
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="rounded-xl bg-background p-2 ring-1 ring-border">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={s.date}
                  min={toISODate(new Date())}
                  onChange={(e) => setSlot(i, { date: e.target.value })}
                  className={`${FIELD} min-w-0 flex-1`}
                  aria-label={`Option ${i + 1} date`}
                />
                <input
                  type="time"
                  value={s.time}
                  onChange={(e) => setSlot(i, { time: e.target.value })}
                  className={`${FIELD} min-w-0 flex-1`}
                  aria-label={`Option ${i + 1} time`}
                />
                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(i)}
                    aria-label={`Remove option ${i + 1}`}
                    className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/45 hover:bg-foreground/5 hover:text-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2 px-0.5">
                <span className="text-xs text-muted">Length</span>
                <select
                  value={s.durationMin}
                  onChange={(e) => setSlot(i, { durationMin: Number(e.target.value) })}
                  className="rounded-lg bg-card px-2 py-1 text-xs ring-1 ring-border"
                  aria-label={`Option ${i + 1} length`}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d < 60 ? `${d} min` : d === 60 ? "1 hr" : `${d / 60} hr`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
        {slots.length < MAX_SLOTS && (
          <button
            type="button"
            onClick={addSlot}
            className="press px-0.5 py-1 text-sm font-semibold text-primary"
          >
            + Add another time
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Please respond by (optional)</SectionLabel>
        <input
          type="date"
          value={respondBy}
          min={toISODate(new Date())}
          onChange={(e) => setRespondBy(e.target.value)}
          className={`${FIELD} w-full`}
        />
      </div>
    </Sheet>
  );
}
