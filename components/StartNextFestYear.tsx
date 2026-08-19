"use client";

import { useState } from "react";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { formatDateLong } from "@/lib/format";
import { startFestYear } from "@/lib/festContent";
import type { FestConfigContent } from "@/lib/types";

/**
 * "Start planning next year" — the other half of the archive cycle.
 *
 * This has to CREATE a fest year, not edit the current one, and the difference
 * matters: the Planner's Details editor upserts the current `fest_config` row,
 * so moving 2026's dates to next summer would drag the finished 2026 fest along
 * with them — its archive would describe the wrong week and the hub would go
 * back to counting down to a fest that already happened. `startFestYear()`
 * inserts a new row instead, which is what leaves the old year whole in Past
 * Years and hands the hub over to the new one (the current year is resolved as
 * the newest row, so nothing else has to be switched).
 *
 * Shown only to fest editors, and only once the current fest is concluded —
 * there's no sense offering "next year" halfway through planning this one.
 */
export function StartNextFestYear({
  current,
  currentYear,
  onCreated,
}: {
  current: FestConfigContent;
  currentYear: number;
  /** Re-fetch fest content so the hub swaps to the new year immediately. */
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press flex w-full items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 text-left text-sm font-semibold text-primary ring-1 ring-primary/25"
      >
        <span>🌱 Start planning next year</span>
        <span aria-hidden className="text-foreground/40">
          ›
        </span>
      </button>
      {open && (
        <StartNextFestYearSheet
          current={current}
          currentYear={currentYear}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}

function StartNextFestYearSheet({
  current,
  currentYear,
  onClose,
  onCreated,
}: {
  current: FestConfigContent;
  currentYear: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { closing, close, dismissThen } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  // ⚠️ EMPTY, not a computed guess. The Family Fest week is different every year
  // and the family decides it by POLL — it can't be derived from the last one.
  // These dates drive the countdown, every season phase, the day pickers and
  // RSVP, so a prefilled plausible week that nobody remembered to change would
  // have the whole app confidently counting down to the wrong dates.
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [copyPlan, setCopyPlan] = useState(true);

  // The year comes from the START date rather than being typed: the fest year IS
  // the year its week falls in, and letting the two disagree would file the new
  // fest under a year that doesn't match its own dates.
  const year = Number(startDate.slice(0, 4));
  const hasDates = startDate.length > 0 && endDate.length > 0;
  const validRange = hasDates && endDate >= startDate;
  const validYear = hasDates && Number.isInteger(year) && year > currentYear;
  const canSave = validRange && validYear && !save.pending;

  // The name follows the year automatically when the current one is the plain
  // "<something> <year>" form, so nobody has to remember to retitle it.
  const nextName = current.name.includes(String(currentYear))
    ? current.name.replace(String(currentYear), String(year))
    : `${current.name} ${year}`;

  const submit = () =>
    save.run(async () => {
      const { error, copied } = await startFestYear({
        year,
        name: nextName,
        tagline: current.tagline?.trim() ? current.tagline : null,
        startDate,
        endDate,
        copyFromYear: copyPlan ? currentYear : null,
      });
      if (error) {
        save.show(error, 0);
        return undefined;
      }
      onCreated();
      dismissThen(onClose);
      return copied ? `Family Fest ${year} created — ${copied} items copied over.` : `Family Fest ${year} created.`;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="start-next-fest"
      header={
        <div>
          <h2 id="start-next-fest" className="text-base font-bold">
            Start planning next year
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {current.name} stays exactly as it is, in Past Years.
          </p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {save.status && <p className="text-center text-xs text-muted">{save.status}</p>}
          <button
            type="button"
            disabled={!canSave}
            onClick={submit}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.pending
              ? "Creating…"
              : validYear
                ? `Create Family Fest ${year}`
                : "Add the dates to continue"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl bg-primary/10 p-3 text-xs text-muted">
          <strong className="text-primary">The family picks the week.</strong> Enter the dates the
          poll landed on — nothing is guessed from last year, since the week moves every year. You
          can change them any time afterwards in{" "}
          <strong>Edit Family Fest → Details</strong>.
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <SectionLabel>Start</SectionLabel>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`${FIELD} w-full`}
            />
          </div>
          <div className="space-y-1.5">
            <SectionLabel>End</SectionLabel>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${FIELD} w-full`}
            />
          </div>
        </div>
        {!hasDates ? (
          <p className="text-xs text-faint">
            Waiting on the dates? Leave this for now — the Family Fest page keeps saying thank you
            until a new year exists, and nothing here is lost.
          </p>
        ) : !validRange ? (
          <p className="text-xs text-accent">End date must be on or after the start.</p>
        ) : !validYear ? (
          <p className="text-xs text-accent">
            Pick a start date after {currentYear} — {current.name} is the fest already on record.
          </p>
        ) : (
          <p className="text-xs text-faint">
            {formatDateLong(startDate)} – {formatDateLong(endDate)} · will be called “{nextName}”
          </p>
        )}

        <label className="flex items-start gap-2.5 rounded-2xl bg-card p-3 ring-1 ring-border">
          <input
            type="checkbox"
            checked={copyPlan}
            onChange={(e) => setCopyPlan(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span className="text-xs">
            <span className="text-sm font-semibold">Start from {currentYear}&rsquo;s plan</span>
            <span className="mt-0.5 block text-muted">
              Copies the schedule, dinners, dues and payees across as a starting point, with days
              shifted onto the new week. Sign-ups and tournament brackets are deliberately left off
              — those are set up fresh once the week has shape.
            </span>
          </span>
        </label>
      </div>
    </Sheet>
  );
}
