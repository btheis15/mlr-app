"use client";

import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";
import { RowLink } from "@/components/RowLink";

/**
 * During fest week, surface the **Family Fest committee** right under the daily
 * summary — tap to see who's running things and reach them. The other resort
 * committees aren't relevant during the fest; they live on the regular
 * Committees tab (off the Home page). Hidden outside the week.
 */
export function FestCommitteesLink() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isLive) return null;

  return (
    <RowLink
      href="/committees/family-fest"
      emoji="🎉"
      title="Contact the Family Fest committee"
      subtitle="See who’s running things — tap for names & contacts."
    />
  );
}
