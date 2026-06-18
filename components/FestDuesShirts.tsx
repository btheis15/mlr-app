"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { FAMILY_FEST, TSHIRT_VOTE } from "@/lib/data";

/**
 * Family Fest "Pay Dues" + "Vote on Shirts" as a tidy side-by-side square pair —
 * lives on the Family Fest hub. Shown during the planning run-up. Pay Dues is
 * the filled CTA (heraldic wine inside the .ff-section); the shirts tile links
 * to the in-app design gallery (/family-fest/shirts), which hands off to the
 * family's poll. While the vote is open it nudges the deadline; once it closes
 * it just offers a look at the winning lineup.
 */
export function FestDuesShirts() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const { today } = useDemoDate();
  if (!season?.isPlanning) return null;

  const voteOpen = today == null || today <= TSHIRT_VOTE.deadline;
  const deadlineShort = new Date(`${TSHIRT_VOTE.deadline}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="grid grid-cols-2 gap-3">
      <Link
        href="/family-fest/pay"
        className="press flex flex-col rounded-2xl bg-primary p-4 text-white shadow-sm"
      >
        <span className="text-2xl" aria-hidden>💸</span>
        <span className="mt-2 text-sm font-semibold">Pay Dues</span>
        <span className="mt-0.5 text-xs text-white/80">
          {FAMILY_FEST.dues.perAdult} / adult {FAMILY_FEST.dues.per}
        </span>
      </Link>

      <Link
        href="/family-fest/shirts"
        className="press flex flex-col rounded-2xl bg-card p-4 ring-1 ring-primary/25 shadow-sm"
      >
        <span className="text-2xl" aria-hidden>👕</span>
        <span className="mt-2 text-sm font-semibold">Vote on Shirts</span>
        <span className="mt-0.5 text-xs text-foreground/60">
          {voteOpen ? `${TSHIRT_VOTE.designs.length} designs · vote by ${deadlineShort}` : "See the designs"}
        </span>
      </Link>
    </div>
  );
}
