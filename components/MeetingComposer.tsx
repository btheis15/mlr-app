"use client";

import { useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import {
  createMeeting,
  createScheduledMeeting,
  googleCalendarCreateUrl,
  looksLikeMeetLink,
  type MeetingScope,
} from "@/lib/meetings";
import { toISODate } from "@/lib/festSeason";

// Bottom-sheet composer for creating a meeting (migration 0116/0119). Two modes,
// picked with a toggle at the top:
//   • "Find a time" — propose up to 10 candidate slots that members vote on
//     (Yes/If-need-be/No), optionally emailing the voting link.
//   • "Set a time now" — one known time, straight to scheduled (no voting), with
//     the Google Meet link right here; it posts to the room, notifies everyone,
//     and sends the confirmation email — same as finalizing a vote.
// Only shown to organizers (admin, or a committee/area Lead — the DB enforces it).

const MAX_SLOTS = 10;
const DURATIONS = [30, 45, 60, 90, 120];
const durationLabel = (d: number) => (d < 60 ? `${d} min` : d === 60 ? "1 hr" : `${d / 60} hr`);

interface SlotRow {
  date: string;
  time: string;
  durationMin: number;
  /** Only used when slotKind === "range". */
  endDate: string;
}

const emptyRow = (): SlotRow => ({ date: "", time: "", durationMin: 60, endDate: "" });

type Mode = "vote" | "now";
/** "time" = a point-in-time call slot (existing behavior); "range" = a date
 *  range (e.g. a weekend) — for polling "which weekend", not "which hour". */
type SlotKind = "time" | "range";

export function MeetingComposer({
  scope,
  roomLabel,
  areaOptions,
  onClose,
  onCreated,
}: {
  scope: MeetingScope;
  /** e.g. "Meals" or "MJT House" — shown in the header for context. */
  roomLabel: string;
  /** For a committee: let the organizer aim the meeting at the whole committee
   *  (value null) or a single role/subcommittee. Omit → use scope.area as-is
   *  (e.g. when opened from a specific chat channel). */
  areaOptions?: { value: string | null; label: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [mode, setMode] = useState<Mode>("vote");
  // The chosen audience when a picker is offered (committee page). Defaults to the
  // first option (Everyone). Ignored for houses / a fixed chat-channel scope.
  const [area, setArea] = useState<string | null>(
    areaOptions && areaOptions.length > 0
      ? areaOptions[0].value
      : scope.type === "committee"
        ? scope.area
        : null,
  );
  const effectiveScope: MeetingScope =
    scope.type === "committee" && areaOptions && areaOptions.length > 0 ? { ...scope, area } : scope;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // "Find a time" (vote) state — a family-wide poll is almost always "which
  // weekend", so default it straight to date ranges.
  const [slotKind, setSlotKind] = useState<SlotKind>(scope.type === "family" ? "range" : "time");
  const [slots, setSlots] = useState<SlotRow[]>([emptyRow()]);
  const [respondBy, setRespondBy] = useState("");
  const [emailEveryone, setEmailEveryone] = useState(false);

  // "Set a time now" state
  const [nowDate, setNowDate] = useState("");
  const [nowTime, setNowTime] = useState("");
  const [nowDuration, setNowDuration] = useState(60);
  const [meetUrl, setMeetUrl] = useState("");

  const { pending, status, run } = useSaveStatus();

  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addSlot = () => setSlots((rows) => (rows.length < MAX_SLOTS ? [...rows, emptyRow()] : rows));
  const removeSlot = (i: number) =>
    setSlots((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const nowValidLink = !meetUrl.trim() || looksLikeMeetLink(meetUrl);
  const nowStartsAt = nowDate && nowTime ? new Date(`${nowDate}T${nowTime}`) : null;
  const gcalUrl = nowStartsAt
    ? googleCalendarCreateUrl({
        title: title.trim() || "Meeting",
        startsAt: nowStartsAt.toISOString(),
        durationMin: nowDuration,
        details:
          (description.trim() ? description.trim() + "\n\n" : "") +
          "Scheduled from the MLR app — add Google Meet, then paste the link back in the app.",
      })
    : null;

  const submit = () =>
    run(async () => {
      const t = title.trim();
      if (!t) return "Add a title first.";

      if (mode === "vote") {
        const filled =
          slotKind === "range"
            ? slots.filter((s) => s.date && s.endDate)
            : slots.filter((s) => s.date && s.time);
        if (filled.length === 0) {
          return slotKind === "range" ? "Add at least one date range." : "Add at least one date & time.";
        }
        if (slotKind === "range" && filled.some((s) => s.endDate < s.date)) {
          return "An end date can't be before its start date.";
        }
        const isoSlots =
          slotKind === "range"
            ? filled.map((s) => ({
                // Local midnight; toISOString normalizes to UTC for storage.
                startsAt: new Date(`${s.date}T00:00`).toISOString(),
                endsAt: new Date(`${s.endDate}T00:00`).toISOString(),
              }))
            : filled.map((s) => ({
                // date + time are local; toISOString normalizes to UTC for storage.
                startsAt: new Date(`${s.date}T${s.time}`).toISOString(),
                durationMin: s.durationMin,
              }));
        const res = await createMeeting({
          scope: effectiveScope,
          title: t,
          description: description.trim() || null,
          slots: isoSlots,
          respondBy: respondBy || null,
          emailEveryone,
        });
        if (res.error) return res.error;
      } else {
        if (!nowStartsAt) return "Pick a date & time.";
        if (!nowValidLink) return "That doesn’t look like a Google Meet link.";
        const res = await createScheduledMeeting(effectiveScope, {
          title: t,
          description: description.trim() || null,
          startsAt: nowStartsAt.toISOString(),
          durationMin: nowDuration,
          meetUrl: meetUrl.trim() || null,
        });
        if (res.error) return res.error;
      }
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
            {mode === "vote"
              ? `Propose times for ${roomLabel} — everyone marks when they’re free`
              : `Set a meeting for ${roomLabel} — everyone gets notified`}
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
            {pending ? "Saving…" : mode === "vote" ? "Propose meeting" : "Set the meeting"}
          </button>
        </div>
      }
    >
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1 ring-1 ring-border">
        {(
          [
            { m: "vote" as Mode, label: "Find a time", sub: "Vote on options" },
            { m: "now" as Mode, label: "Set a time now", sub: "No voting" },
          ]
        ).map(({ m, label, sub }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`press rounded-lg px-2 py-2 text-center ${mode === m ? "bg-primary text-white" : "text-foreground/60"}`}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className={`block text-[11px] ${mode === m ? "text-white/80" : "text-muted"}`}>{sub}</span>
          </button>
        ))}
      </div>

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

      {areaOptions && areaOptions.length > 1 && (
        <div className="space-y-1.5">
          <SectionLabel>Who’s this for?</SectionLabel>
          <select
            value={area ?? ""}
            onChange={(e) => setArea(e.target.value || null)}
            className={`${FIELD} w-full`}
          >
            {areaOptions.map((o) => (
              <option key={o.value ?? "__all__"} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="px-0.5 text-xs text-muted">
            Pick a role to invite just that group, or the whole committee.
          </p>
        </div>
      )}

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

      {mode === "vote" ? (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1 ring-1 ring-border">
            {(
              [
                { k: "time" as SlotKind, label: "Times", sub: "Which hour works" },
                { k: "range" as SlotKind, label: "Dates", sub: "Which weekend works" },
              ]
            ).map(({ k, label, sub }) => (
              <button
                key={k}
                type="button"
                onClick={() => setSlotKind(k)}
                aria-pressed={slotKind === k}
                className={`press rounded-lg px-2 py-1.5 text-center ${slotKind === k ? "bg-primary text-white" : "text-foreground/60"}`}
              >
                <span className="block text-xs font-semibold">{label}</span>
                <span className={`block text-[10px] ${slotKind === k ? "text-white/80" : "text-muted"}`}>{sub}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <SectionLabel>
              {slotKind === "range" ? `Date options (up to ${MAX_SLOTS})` : `Time options (up to ${MAX_SLOTS})`}
            </SectionLabel>
            <div className="space-y-2">
              {slots.map((s, i) => (
                <div key={i} className="rounded-xl bg-background p-2 ring-1 ring-border">
                  {slotKind === "range" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={s.date}
                        min={toISODate(new Date())}
                        onChange={(e) => setSlot(i, { date: e.target.value })}
                        className={`${FIELD} min-w-0 flex-1`}
                        aria-label={`Option ${i + 1} start date`}
                      />
                      <span className="text-xs text-muted">to</span>
                      <input
                        type="date"
                        value={s.endDate}
                        min={s.date || toISODate(new Date())}
                        onChange={(e) => setSlot(i, { endDate: e.target.value })}
                        className={`${FIELD} min-w-0 flex-1`}
                        aria-label={`Option ${i + 1} end date`}
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
                  ) : (
                    <>
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
                              {durationLabel(d)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            {slots.length < MAX_SLOTS && (
              <button
                type="button"
                onClick={addSlot}
                className="press px-0.5 py-1 text-sm font-semibold text-primary"
              >
                {slotKind === "range" ? "+ Add another date range" : "+ Add another time"}
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

          <label className="flex items-start gap-2.5 rounded-xl bg-background p-3 ring-1 ring-border">
            <input
              type="checkbox"
              checked={emailEveryone}
              onChange={(e) => setEmailEveryone(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">📧 Also email everyone a link to vote</span>
              <span className="block text-xs text-muted">
                Sends a heads-up email with a button that opens this right here. Only reaches members who
                have email alerts on.
              </span>
            </span>
          </label>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <SectionLabel>When</SectionLabel>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={nowDate}
                min={toISODate(new Date())}
                onChange={(e) => setNowDate(e.target.value)}
                className={`${FIELD} min-w-0 flex-1`}
                aria-label="Meeting date"
              />
              <input
                type="time"
                value={nowTime}
                onChange={(e) => setNowTime(e.target.value)}
                className={`${FIELD} min-w-0 flex-1`}
                aria-label="Meeting time"
              />
            </div>
            <div className="flex items-center gap-2 px-0.5 pt-0.5">
              <span className="text-xs text-muted">Length</span>
              <select
                value={nowDuration}
                onChange={(e) => setNowDuration(Number(e.target.value))}
                className="rounded-lg bg-card px-2 py-1 text-xs ring-1 ring-border"
                aria-label="Meeting length"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {durationLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
            <p className="text-sm font-semibold">Google Meet link (optional)</p>
            <p className="text-xs text-muted">
              Tap Create Google Meet, add it in the event and Save, then paste the link here. You can also
              set the time now and add the link later.
            </p>
            {gcalUrl && (
              <a
                href={gcalUrl}
                target="_blank"
                rel="noreferrer"
                className="press flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white"
              >
                📅 Create Google Meet ↗
              </a>
            )}
            <input
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/…"
              inputMode="url"
              className={`${FIELD} w-full`}
            />
            {!nowValidLink && (
              <p className="px-0.5 text-xs font-medium text-accent">
                That doesn’t look like a Google Meet link — double-check it, or leave it blank.
              </p>
            )}
          </div>

          <p className="px-0.5 text-xs text-muted">
            Everyone in {roomLabel} gets notified, and — if there’s a link — an email with the meeting
            details (members with email alerts on).
          </p>
        </>
      )}
    </Sheet>
  );
}
