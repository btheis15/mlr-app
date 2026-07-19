"use client";

import { useMemo, useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import {
  cancelMeeting,
  deleteMeeting,
  finalizeMeeting,
  googleCalendarCreateUrl,
  looksLikeMeetLink,
  setMyAvailability,
  type AvailabilityStatus,
  type Meeting,
  type MeetingSlot,
} from "@/lib/meetings";

// The meeting sheet (migration 0116). For an OPEN meeting: every member marks
// Yes / If-need-be / No on each proposed time, sees live tallies + the best
// slot, and taps Save. The organizer (or an admin) also gets a "Pick this time"
// action per slot → a guided, in-sheet Google Meet step (prefilled calendar
// link + paste the Meet link back), then Set the meeting. For a SCHEDULED
// meeting: the chosen time + a big Join button.

interface RoomMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const AVAIL_OPTIONS: { value: AvailabilityStatus; label: string; on: string }[] = [
  { value: "yes", label: "Yes", on: "bg-primary text-white ring-primary" },
  { value: "if_need_be", label: "If need be", on: "bg-sun text-white ring-sun" },
  { value: "no", label: "No", on: "bg-foreground text-white ring-foreground" },
];

function formatSlot(startsAt: string, durationMin: number): string {
  const d = new Date(startsAt);
  const when = d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const len = durationMin < 60 ? `${durationMin} min` : durationMin === 60 ? "1 hr" : `${durationMin / 60} hr`;
  return `${when} · ${len}`;
}

export function MeetingSchedulerSheet({
  meeting,
  members,
  memberCount,
  canManage,
  onClose,
  onChanged,
}: {
  meeting: Meeting;
  members: RoomMember[];
  /** Room size, for the "everyone can make it" badge. */
  memberCount: number;
  /** isAdmin || createdByMe — gates Finalize / Cancel / Delete. */
  canManage: boolean;
  onClose: () => void;
  /** Reload the room's meetings after a write. */
  onChanged: () => void;
}) {
  const { userId, previewAsId, promptSignIn, user } = useIdentity();
  const { closing, close } = useSheetDismiss(onClose);
  const { pending, status, run } = useSaveStatus();

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of members) m.set(p.id, p.name);
    return m;
  }, [members]);
  const who = (id: string) => (userId && id === userId ? "You" : nameById.get(id) ?? "A member");

  const [draft, setDraft] = useState<Record<string, AvailabilityStatus>>(meeting.myAnswers);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState<MeetingSlot | null>(null);
  const [meetUrl, setMeetUrl] = useState(meeting.meetUrl ?? "");

  const isOpen = meeting.status === "open";
  const dirty = useMemo(
    () => meeting.slots.some((s) => (draft[s.id] ?? null) !== (meeting.myAnswers[s.id] ?? null)),
    [draft, meeting.slots, meeting.myAnswers],
  );
  const answeredAll = meeting.slots.every((s) => draft[s.id]);

  const chosen = meeting.slots.find((s) => s.id === meeting.chosenSlotId) ?? null;

  const saveAvailability = () => {
    if (!user) {
      promptSignIn();
      return;
    }
    if (previewAsId) return; // writes would land as the real admin
    void run(async () => {
      const { error } = await setMyAvailability(meeting.id, draft);
      if (error) return error;
      onChanged();
      return null;
    });
  };

  const doFinalize = (slot: MeetingSlot, url: string) => {
    if (previewAsId) return;
    void run(async () => {
      const { error } = await finalizeMeeting(meeting.id, slot.id, url.trim());
      if (error) return error;
      onChanged();
      close();
      return null;
    });
  };

  const onCancel = () => {
    if (!window.confirm(`Cancel "${meeting.title}"? Members will see it as cancelled.`)) return;
    void run(async () => {
      const { error } = await cancelMeeting(meeting.id);
      if (error) return error;
      onChanged();
      close();
      return null;
    });
  };

  const onDelete = () => {
    if (!window.confirm(`Delete "${meeting.title}"? This removes everyone's answers for good.`)) return;
    void run(async () => {
      const { error } = await deleteMeeting(meeting.id);
      if (error) return error;
      onChanged();
      close();
      return null;
    });
  };

  // ── Guided in-app Google Meet step ─────────────────────────────────────────
  if (finalizing) {
    const gcalUrl = googleCalendarCreateUrl({
      title: meeting.title,
      startsAt: finalizing.startsAt,
      durationMin: finalizing.durationMin,
      details:
        (meeting.description ? meeting.description + "\n\n" : "") +
        "Scheduled from the MLR app — add Google Meet, then paste the link back in the app.",
    });
    const validLink = !meetUrl.trim() || looksLikeMeetLink(meetUrl);
    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="meeting-finalize-title"
        header={
          <div className="pr-10">
            <h2 id="meeting-finalize-title" className="text-lg font-bold">
              Set the meeting
            </h2>
            <p className="mt-0.5 text-xs text-muted">{formatSlot(finalizing.startsAt, finalizing.durationMin)}</p>
          </div>
        }
        footer={
          <div className="space-y-2">
            {status && <p className="text-sm font-medium text-red-600">{status}</p>}
            <button
              onClick={() => doFinalize(finalizing, meetUrl)}
              disabled={pending || !validLink}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Set the meeting"}
            </button>
            <button
              onClick={() => setFinalizing(null)}
              className="press w-full rounded-xl bg-background py-2.5 text-sm font-semibold text-foreground/70 ring-1 ring-border"
            >
              ← Back
            </button>
          </div>
        }
      >
        <ol className="space-y-3">
          <li className="rounded-xl bg-background p-3 ring-1 ring-border">
            <p className="text-sm font-semibold">1. Create the Google Meet</p>
            <p className="mt-0.5 text-xs text-muted">
              Opens a Google Calendar event, already filled in with this time. Tap{" "}
              <span className="font-medium">“Add Google Meet”</span>, then <span className="font-medium">Save</span> —
              you’ll get a join link.
            </p>
            <a
              href={gcalUrl}
              target="_blank"
              rel="noreferrer"
              className="press mt-2 flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white"
            >
              📅 Create Google Meet ↗
            </a>
          </li>
          <li className="space-y-1.5">
            <SectionLabel>2. Paste the Meet link here</SectionLabel>
            <input
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/…"
              inputMode="url"
              className={`${FIELD} w-full`}
            />
            {!validLink && (
              <p className="px-0.5 text-xs font-medium text-accent">
                That doesn’t look like a Google Meet link — double-check it, or skip for now.
              </p>
            )}
            <p className="px-0.5 text-xs text-muted">
              No link yet? Tap <span className="font-medium">Set the meeting</span> to lock the time now — you can add
              the link later.
            </p>
          </li>
        </ol>
      </Sheet>
    );
  }

  // ── Main sheet ─────────────────────────────────────────────────────────────
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="meeting-sheet-title"
      header={
        <div className="pr-10">
          <h2 id="meeting-sheet-title" className="text-lg font-bold leading-snug">
            {meeting.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {meeting.status === "scheduled"
              ? "Scheduled ✓"
              : meeting.status === "cancelled"
                ? "Cancelled"
                : `Mark when you’re free · ${meeting.respondentCount} responded`}
          </p>
        </div>
      }
      footer={
        isOpen ? (
          <div className="space-y-2">
            {status && <p className="text-sm font-medium text-red-600">{status}</p>}
            <button
              onClick={saveAvailability}
              disabled={pending || !dirty}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : !user ? "Sign in to answer" : dirty ? "Save my availability" : answeredAll ? "Saved ✓" : "Save my availability"}
            </button>
          </div>
        ) : undefined
      }
    >
      {meeting.description && <p className="whitespace-pre-wrap text-sm text-foreground/75">{meeting.description}</p>}

      {/* Scheduled: the outcome up top. */}
      {meeting.status === "scheduled" && chosen && (
        <div className="space-y-2 rounded-2xl bg-primary/10 p-4 ring-1 ring-primary/20">
          <p className="text-sm font-semibold text-primary">📅 {formatSlot(chosen.startsAt, chosen.durationMin)}</p>
          {meeting.meetUrl ? (
            <a
              href={meeting.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="press flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
            >
              Join the meeting ↗
            </a>
          ) : (
            <p className="text-xs text-muted">No join link yet.</p>
          )}
          {canManage && (
            <button
              onClick={() => {
                setMeetUrl(meeting.meetUrl ?? "");
                setFinalizing(chosen);
              }}
              className="press w-full rounded-xl bg-background py-2 text-xs font-semibold text-foreground/70 ring-1 ring-border"
            >
              {meeting.meetUrl ? "Change time or link" : "Add the Meet link"}
            </button>
          )}
        </div>
      )}

      {meeting.status === "cancelled" && (
        <p className="rounded-xl bg-foreground/5 p-3 text-center text-sm text-muted">This meeting was cancelled.</p>
      )}

      {/* Slots — availability + tallies. Shown for open meetings and as a summary
          otherwise. */}
      {(isOpen || meeting.status === "cancelled") && (
        <div className="space-y-2">
          {isOpen && <SectionLabel>Which times work?</SectionLabel>}
          {meeting.slots.map((s) => {
            const isBest = isOpen && s.id === meeting.bestSlotId && s.score > 0;
            const everyone = s.yes.length >= memberCount && memberCount > 0;
            const isExpanded = expanded === s.id;
            const mine = draft[s.id] ?? null;
            return (
              <div
                key={s.id}
                className={`rounded-xl p-3 ring-1 ${isBest ? "bg-primary/5 ring-primary/30" : "bg-background ring-border"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{formatSlot(s.startsAt, s.durationMin)}</p>
                  {isBest && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {everyone ? "✅ Everyone" : "Best so far"}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : s.id)}
                  className="press mt-1 flex items-center gap-3 text-xs text-muted"
                >
                  <span>✅ {s.yes.length}</span>
                  <span>🤔 {s.ifNeedBe.length}</span>
                  <span>✕ {s.no.length}</span>
                  {(s.yes.length || s.ifNeedBe.length || s.no.length) > 0 && (
                    <span className="text-foreground/40">{isExpanded ? "hide" : "who?"}</span>
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-1.5 space-y-1 border-t border-border pt-1.5 text-xs">
                    {s.yes.length > 0 && (
                      <p><span className="font-semibold text-primary">Yes:</span> {s.yes.map(who).join(", ")}</p>
                    )}
                    {s.ifNeedBe.length > 0 && (
                      <p><span className="font-semibold text-sun">If need be:</span> {s.ifNeedBe.map(who).join(", ")}</p>
                    )}
                    {s.no.length > 0 && (
                      <p><span className="font-semibold text-foreground/60">No:</span> {s.no.map(who).join(", ")}</p>
                    )}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Your availability">
                    {AVAIL_OPTIONS.map((o) => {
                      const on = mine === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDraft((d) => ({ ...d, [s.id]: o.value }))}
                          className={`press rounded-lg py-1.5 text-xs font-semibold ring-1 ${on ? o.on : "bg-card text-foreground/55 ring-border"}`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {isOpen && canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setMeetUrl("");
                      setFinalizing(s);
                    }}
                    className="press mt-2 w-full rounded-lg bg-primary/10 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/20"
                  >
                    Pick this time →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && meeting.status !== "cancelled" && (
        <div className="flex gap-2 pt-1">
          {isOpen && (
            <button
              onClick={onCancel}
              disabled={pending}
              className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-foreground/70 ring-1 ring-border disabled:opacity-50"
            >
              Cancel meeting
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={pending}
            className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-red-600 ring-1 ring-border disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </Sheet>
  );
}
