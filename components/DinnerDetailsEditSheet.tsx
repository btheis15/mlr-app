"use client";

import { useState } from "react";
import type { Dinner } from "@/lib/types";
import { updateDinnerDetails } from "@/lib/festContent";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";
import { toTimeInputValue } from "@/lib/format";

/**
 * Lets a dinner's head chef or an assigned crew member (or a fest
 * admin/committee editor) edit that dinner's operational details — menu,
 * served time/location, prep time/location — directly from the schedule/
 * detail screen, without the full Family Fest Planner's edit access
 * (migration 0099). Deliberately narrower than the Planner's DinnerSheet: day,
 * title, chef, crew, and houses stay admin/committee-managed there.
 */
export function DinnerDetailsEditSheet({
  dinner,
  onClose,
  onSaved,
}: {
  dinner: Dinner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [menu, setMenu] = useState(dinner.menu === "TBD" ? "" : dinner.menu);
  const [servedTime, setServedTime] = useState(toTimeInputValue(dinner.time === "TBD" ? undefined : dinner.time));
  const [servedLocation, setServedLocation] = useState(dinner.location === "TBD" ? "" : dinner.location);
  const [prepTime, setPrepTime] = useState(toTimeInputValue(dinner.prepTime === "TBD" ? undefined : dinner.prepTime));
  const [prepLocation, setPrepLocation] = useState(dinner.prepLocation ?? "");

  const submit = () =>
    save.run(async () => {
      const { error } = await updateDinnerDetails(dinner.id, {
        menu: menu.trim() || null,
        servedTime: servedTime || null,
        servedLocation: servedLocation.trim() || null,
        prepTime: prepTime || null,
        prepLocation: prepLocation.trim() || null,
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
      labelledBy="dinner-details-sheet"
      header={
        <>
          <h2 id="dinner-details-sheet" className="text-lg font-bold">
            {dinner.emoji} Edit {dinner.title}
          </h2>
          <p className="text-sm text-foreground/60">Menu, timing, and location — since you&rsquo;re on for this one.</p>
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
        <SectionLabel>Menu</SectionLabel>
        <textarea
          value={menu}
          onChange={(e) => setMenu(e.target.value)}
          rows={3}
          placeholder="What's cooking (blank = TBD)"
          className={`${FIELD} w-full resize-none`}
        />
      </div>
      <div className="space-y-2">
        <SectionLabel>Served</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <input type="time" value={servedTime} onChange={(e) => setServedTime(e.target.value)} aria-label="Served time" className={FIELD} />
          <input value={servedLocation} onChange={(e) => setServedLocation(e.target.value)} placeholder="Location" className={FIELD} />
        </div>
      </div>
      <div className="space-y-2">
        <SectionLabel>Prep</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <input type="time" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} aria-label="Prep time" className={FIELD} />
          <input value={prepLocation} onChange={(e) => setPrepLocation(e.target.value)} placeholder="Location (blank = same as served)" className={FIELD} />
        </div>
      </div>
      {save.status && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{save.status}</p>
      )}
    </Sheet>
  );
}
