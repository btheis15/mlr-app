"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * Prominent "pay your dues" CTA for the run-up to Family Fest (the planning
 * window). Shown near the top of both Home and the Family Fest page; hidden
 * once the week is live / over. Solid `bg-primary`, so it's forest green on the
 * resort home and heraldic wine inside the Family Fest section automatically.
 */
export function FestDuesCallout() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isPlanning) return null;

  return (
    <Link
      href="/family-fest/pay"
      className="flex items-center gap-3 rounded-2xl bg-primary p-4 text-white shadow-sm"
    >
      <span className="text-2xl">💸</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Pay your Family Fest dues</p>
        <p className="text-xs text-white/80">
          {FAMILY_FEST.dues.perAdult} / adult {FAMILY_FEST.dues.per} · kids{" "}
          {FAMILY_FEST.dues.perKid}
        </p>
      </div>
      <span className="shrink-0 text-white/70" aria-hidden>
        ›
      </span>
    </Link>
  );
}
