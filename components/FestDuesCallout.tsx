"use client";

import { useCurrentFestSeason } from "@/lib/useFestSeason";
import { useFestContent } from "@/lib/useFestContent";
import { duesSummary } from "@/lib/festContent";
import { RowLink } from "@/components/RowLink";

/**
 * Prominent "pay your dues" CTA for the run-up to Family Fest (the planning
 * window). Shown near the top of both Home and the Family Fest page; hidden
 * once the week is live / over. Solid `bg-primary`, so it's forest green on the
 * resort home and heraldic wine inside the Family Fest section automatically.
 */
export function FestDuesCallout() {
  const season = useCurrentFestSeason();
  const { dues } = useFestContent();
  if (!season?.isPlanning) return null;

  return (
    <RowLink
      href="/family-fest/pay"
      tone="primary"
      emoji="💸"
      title="Pay your Family Fest dues"
      subtitle={duesSummary(dues)}
    />
  );
}
