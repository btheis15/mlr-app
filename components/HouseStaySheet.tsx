"use client";

import { useState } from "react";
import type { HouseStay } from "@/lib/types";
import { stayLabel, stayHeadCount } from "@/lib/houseCalendar";
import { formatDateRange, relativeDays } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { PrivateName } from "@/components/Guard";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

/**
 * A stay's details: dates, who's coming (the member + everyone they added), and
 * any note. The author (or an admin) gets Edit + Cancel controls; everyone else
 * in the house just sees who's up and when.
 */
export function HouseStaySheet({
  stay,
  today,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  stay: HouseStay;
  today: string;
  /** Author or admin — shows the Edit/Cancel controls. */
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const when = relativeDays(today, stay.startDate);
  const headCount = stayHeadCount(stay);

  const doDelete = async () => {
    setBusy(true);
    const res = await onDelete();
    setBusy(false);
    if (!res.error) close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="stay-sheet-title"
      header={
        <div className="pr-8">
          <h2 id="stay-sheet-title" className="text-lg font-bold">
            🏡 {stayLabel(stay)}
          </h2>
          <p className="mt-0.5 text-sm text-foreground/60">
            {formatDateRange(stay.startDate, stay.endDate)}
            {when && <span className="text-foreground/45"> · {when}</span>}
          </p>
        </div>
      }
      footer={
        canEdit ? (
          confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="press flex-1 rounded-2xl bg-card py-3 text-sm font-semibold ring-1 ring-border"
              >
                Keep it
              </button>
              <button
                onClick={doDelete}
                disabled={busy}
                className="press flex-1 rounded-2xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Removing…" : "Cancel this stay"}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(true)}
                className="press flex-1 rounded-2xl bg-card py-3 text-sm font-semibold text-accent ring-1 ring-border"
              >
                Cancel stay
              </button>
              <button
                onClick={onEdit}
                className="press flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
              >
                Edit
              </button>
            </div>
          )
        ) : undefined
      }
    >
      {/* Who's coming */}
      <div className="space-y-2">
        <SectionLabel>Who&rsquo;s coming ({headCount})</SectionLabel>
        <div className="flex items-center gap-2">
          <Avatar name={stay.authorName} url={stay.authorAvatarUrl} size={28} />
          <span className="text-sm font-semibold">
            <PrivateName name={stay.authorName} />
          </span>
          <span className="text-xs text-foreground/45">organizing</span>
        </div>
        {stay.guestNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {stay.guestNames.map((g, i) => (
              <span
                key={`${g}-${i}`}
                className="rounded-full bg-card px-3 py-1 text-xs font-medium ring-1 ring-border"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Note */}
      {stay.note && (
        <div className="space-y-1">
          <SectionLabel>Notes</SectionLabel>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{stay.note}</p>
        </div>
      )}
    </Sheet>
  );
}
