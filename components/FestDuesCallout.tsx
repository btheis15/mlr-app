"use client";

import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";
import { RowLink } from "@/components/RowLink";

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
    <RowLink
      href="/family-fest/pay"
      tone="primary"
      emoji="💸"
      title="Pay your Family Fest dues"
      subtitle={`${FAMILY_FEST.dues.perAdult} / adult ${FAMILY_FEST.dues.per} · kids ${FAMILY_FEST.dues.perKid}`}
    />
  );
}
