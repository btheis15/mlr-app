"use client";

import { useState } from "react";
import type { FestActivity } from "@/lib/types";
import { updateActivityDetails } from "@/lib/festContent";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";

/**
 * Lets an activity's lead or an assigned crew member (or a fest admin/
 * committee editor) edit that activity's details — blurb, details, where to
 * start — directly from the Overview page, without the full Family Fest
 * Planner's edit access (migration 0110). Deliberately narrower than the
 * Planner's ActivitySheet: title, lead, and crew stay admin/committee-managed
 * there.
 */
export function ActivityDetailsEditSheet({
  activity,
  onClose,
  onSaved,
}: {
  activity: FestActivity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [blurb, setBlurb] = useState(activity.blurb);
  const [details, setDetails] = useState(activity.details ?? "");
  const [location, setLocation] = useState(activity.location ?? "");

  const submit = () =>
    save.run(async () => {
      const { error } = await updateActivityDetails(activity.id, {
        blurb: blurb.trim() || null,
        details: details.trim() || null,
        location: location.trim() || null,
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
      labelledBy="activity-details-sheet"
      header={
        <>
          <h2 id="activity-details-sheet" className="text-lg font-bold">
            {activity.emoji} Edit {activity.title}
          </h2>
          <p className="text-sm text-foreground/60">Blurb, details, and where to start — since you&rsquo;re running this one.</p>
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
        <SectionLabel>Blurb (one-liner)</SectionLabel>
        <input value={blurb} onChange={(e) => setBlurb(e.target.value)} className={`${FIELD} w-full`} />
      </div>
      <div className="space-y-2">
        <SectionLabel>Details (optional)</SectionLabel>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className={`${FIELD} w-full resize-none`} />
      </div>
      <div className="space-y-2">
        <SectionLabel>Where to start (optional)</SectionLabel>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${FIELD} w-full`} />
      </div>
      {save.status && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{save.status}</p>
      )}
    </Sheet>
  );
}
