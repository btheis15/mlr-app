"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { TSHIRT_VOTE, FAMILY_FEST } from "@/lib/data";
import { relativeDays } from "@/lib/format";

/**
 * Home call-out for the Family Fest t-shirt vote — the "a new thing needs you"
 * card the home page surfaces when one comes up (it sits right under the Family
 * Fest spotlight). Eye-catching in the fest's heraldic wine (--color-fest, the
 * brand accent OUTSIDE .ff-section), it teases the four designs and links to the
 * in-app preview gallery (/family-fest/shirts), where the "Open the poll" button
 * hands off to the family's real Google Form. It is NOT a poll itself.
 *
 * Self-hides outside the planning run-up and the day after voting closes.
 */
export function TshirtCallout() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const { today } = useDemoDate();

  if (!season?.isPlanning) return null;
  if (today != null && today > TSHIRT_VOTE.deadline) return null;

  const rel = today ? relativeDays(today, TSHIRT_VOTE.deadline) : null;
  // ISO date-only → safe local short date ("Sat, Jun 27"); formatDate() would
  // parse it as UTC and slip a day on US clocks, so build it at local midnight.
  const deadlineShort = new Date(`${TSHIRT_VOTE.deadline}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href="/family-fest/shirts"
      className="press block rounded-2xl bg-fest/10 p-4 ring-1 ring-fest/30 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-fest">
          🗳️ Vote · Family Fest shirt
        </p>
        <span className="shrink-0 rounded-full bg-fest px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          New
        </span>
      </div>

      <p className="mt-1 text-sm font-semibold">Help pick the 2026 t-shirt</p>
      <p className="text-xs text-foreground/60">
        {TSHIRT_VOTE.designs.length} designs from the family — rank your favorites.
        {rel && (rel === "Today" ? " Last day to vote!" : ` Closes ${deadlineShort} · ${rel}.`)}
      </p>

      {/* The four designs as a teaser row — tap through to see them full-size. */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {TSHIRT_VOTE.designs.map((d) => (
          <div key={d.id} className="overflow-hidden rounded-lg ring-1 ring-fest/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.img} alt={d.name} className="aspect-square w-full object-cover" />
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs font-medium text-fest">See the designs &amp; vote →</p>
    </Link>
  );
}
