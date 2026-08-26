"use client";

import Link from "next/link";
import { useState } from "react";
import { hasChosenLook } from "@/lib/festTheme";
import type { FestConfigContent } from "@/lib/types";

/**
 * "Set up Family Fest <year>" — the editors-only card that makes a brand-new
 * fest year obviously plannable.
 *
 * `startFestYear()` creates a year from two dates and (optionally) a copy of
 * last year's plan, and everything else about it — theme, cover photo, colours,
 * the daily plan, dinners, dues, who collects the money — is blank on purpose.
 * That's correct (the theme is the part of a fest that's *supposed* to change),
 * but it left a discovery problem: the hub for a fresh year is just a countdown,
 * so the only clue that any of it is editable at all was a small ✏️ link, and
 * nothing said WHAT was still missing. Editors were expected to know that the
 * Planner exists, that it has a Look section, and that a year starts empty.
 *
 * This is that knowledge, on screen, for the people who have permission to act
 * on it:
 *
 *  - Every row is a real gap, derived from the year's own data — not a static
 *    tutorial. Set the thing and the row goes green; set everything and the card
 *    removes itself, so it can't become permanent furniture on the hub.
 *  - Every row links straight into the Planner section that fixes it (the master
 *    editor takes a `?section=` hint), so "add the cover photo" is one tap from
 *    knowing you need one.
 *  - Dates never appear as a gap — a year can't exist without them.
 *
 * Hidden entirely once the fest is CONCLUDED: at that point the year's job is to
 * be an archive, and the only thing left to do is start the next one (which
 * FestStatus's own "Start planning next year" button owns). A checklist nagging
 * an editor to pick colours for a fest that already happened is noise.
 */
export function FestSetupChecklist({
  config,
  scheduleCount,
  dinnerCount,
  duesSet,
  payeeCount,
  concluded,
}: {
  config: FestConfigContent;
  /** ⚠️ Must be counted WITHIN this year's window by the caller. The content
   *  layer backfills an empty current year with the in-code 2026 seed so the hub
   *  is never blank, so a raw `schedule.length` is non-zero for a fest that has
   *  no plan at all — and this card would tick "build the daily plan" for a week
   *  with nothing in it. */
  scheduleCount: number;
  dinnerCount: number;
  duesSet: boolean;
  payeeCount: number;
  concluded: boolean;
}) {
  const [open, setOpen] = useState(true);

  const items: { key: string; label: string; hint: string; done: boolean; section: string }[] = [
    {
      key: "theme",
      label: "Name this year's theme",
      hint: "The line under the title — 2026's was “Ye Olde Family Feste”.",
      done: Boolean(config.theme.trim()),
      section: "details",
    },
    {
      key: "cover",
      label: "Add the cover photo",
      hint: "The banner across the top of this page.",
      done: Boolean(config.coverUrl),
      section: "look",
    },
    {
      key: "look",
      label: "Pick the theme colours & background",
      hint: "Colours, background image or pattern, and the display font.",
      done: hasChosenLook(config.look),
      section: "look",
    },
    {
      key: "schedule",
      label: "Build the daily plan",
      hint: "What's happening each day of the week.",
      done: scheduleCount > 0,
      section: "schedule",
    },
    {
      key: "dinners",
      label: "Set the dinners",
      hint: "Who's cooking each night, and what's on the menu.",
      done: dinnerCount > 0,
      section: "dinners",
    },
    {
      key: "dues",
      label: "Set the dues",
      hint: "What it costs per adult and per kid.",
      done: duesSet,
      section: "dues",
    },
    {
      key: "payees",
      label: "Say who collects the money",
      hint: "The Venmo / Zelle the dues go to.",
      done: payeeCount > 0,
      section: "payees",
    },
  ];

  const remaining = items.filter((i) => !i.done);

  // Nothing left to set up, or the year is history ⇒ this card has no job.
  if (concluded || remaining.length === 0) return null;

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-primary/25">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press flex w-full items-center gap-3 text-left"
        aria-expanded={open}
      >
        <span aria-hidden className="text-xl">
          🌱
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-primary">
            Set up {config.name}
          </span>
          <span className="block text-xs text-muted">
            {remaining.length} of {items.length} still to do · only you and the Family Fest
            committee see this
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-foreground/40">
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open && (
        <>
          <ul className="mt-3 space-y-1.5">
            {items.map((i) => (
              <li key={i.key}>
                <Link
                  href={`/family-fest/master?section=${i.section}`}
                  className={`press flex items-start gap-2.5 rounded-xl px-2.5 py-2 ${
                    i.done ? "opacity-55" : "bg-primary/5"
                  }`}
                >
                  <span aria-hidden className="mt-px shrink-0 text-sm">
                    {i.done ? "✅" : "⬜️"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm font-semibold ${i.done ? "line-through" : ""}`}
                    >
                      {i.label}
                    </span>
                    {!i.done && <span className="block text-xs text-muted">{i.hint}</span>}
                  </span>
                  <span aria-hidden className="shrink-0 text-foreground/30">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 px-1 text-[11px] text-faint">
            Everything here is editable in the app — nothing needs a new build. Dates are already
            set; change them any time in <strong>Details</strong>.
          </p>
        </>
      )}
    </section>
  );
}
