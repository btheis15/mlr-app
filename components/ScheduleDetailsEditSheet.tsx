"use client";

import { useState } from "react";
import type { ScheduleEvent } from "@/lib/types";
import { updateScheduleDetails } from "@/lib/festContent";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";

/**
 * Lets an event's lead or an assigned crew member (or a fest admin/committee
 * editor) edit that event's on-the-ground details — location, description,
 * what to bring — directly from the schedule view, without the full Family
 * Fest Planner's edit access (migration 0110). Deliberately narrower than the
 * Planner's ScheduleSheet: day, title, time, lead, and crew stay
 * admin/committee-managed there.
 */
export function ScheduleDetailsEditSheet({
  event,
  onClose,
  onSaved,
}: {
  event: ScheduleEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [location, setLocation] = useState(event.location === "TBD" ? "" : event.location);
  const [description, setDescription] = useState(event.description);
  const [bring, setBring] = useState(event.bring ?? "");

  const submit = () =>
    save.run(async () => {
      const { error } = await updateScheduleDetails(event.id, {
        location: location.trim() || null,
        description: description.trim() || null,
        bring: bring.trim() || null,
      });
      if (error) return error;
      onSaved();
      close();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="event-details-sheet"
      header={
        <>
          <h2 id="event-details-sheet" className="text-lg font-bold">
            {event.emoji} Edit {event.title}
          </h2>
          <p className="text-sm text-foreground/60">Location, details, and what to bring — since you&rsquo;re running this one.</p>
        </>
      }
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={save.pending}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {save.pending ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="space-y-2">
        <SectionLabel>Location</SectionLabel>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Where (blank = TBD)"
          className={`${FIELD} w-full`}
        />
      </div>
      <div className="space-y-2">
        <SectionLabel>Details</SectionLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What it is, when to arrive…"
          className={`${FIELD} w-full resize-none`}
        />
      </div>
      <div className="space-y-2">
        <SectionLabel>What to bring (optional)</SectionLabel>
        <input
          value={bring}
          onChange={(e) => setBring(e.target.value)}
          placeholder="e.g. swimsuit & towel"
          className={`${FIELD} w-full`}
        />
      </div>
      {save.status && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{save.status}</p>
      )}
    </Sheet>
  );
}
