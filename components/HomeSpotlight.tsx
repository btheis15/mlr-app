"use client";

import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { FAMILY_FEST, SCHEDULE, TSHIRT_VOTE } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { TshirtCallout } from "@/components/TshirtCallout";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";

/**
 * The Home "what's happening" slot. The Family Fest spotlight is the permanent
 * base; temporary call-outs (the t-shirt vote, future news/alerts) stack on top
 * of it as swipe-away cards (see CalloutStack). Stacking — rather than listing
 * them down the page — is deliberate: it keeps the slot to one card tall so the
 * Ask-for-Help row below stays in view no matter how many call-outs are active.
 *
 * Add a future call-out by pushing another swipeable StackItem ABOVE the base,
 * gated by whatever decides it should show. Give it a stable, versioned id so a
 * brand-new alert reappears even if a same-purpose card was swiped before.
 */
export function HomeSpotlight() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const { today } = useDemoDate();

  const items: StackItem[] = [];

  // T-shirt vote — only during the planning run-up + the day after it closes
  // (mirrors TshirtCallout's own self-hide so the card never renders empty).
  const tshirtActive =
    season?.isPlanning && !(today != null && today > TSHIRT_VOTE.deadline);
  if (tshirtActive) {
    items.push({
      id: `tshirt:${TSHIRT_VOTE.deadline}`,
      swipeable: true,
      node: <TshirtCallout />,
    });
  }

  // The permanent base — never swipeable, so something always sits here.
  items.push({
    id: "family-fest-spotlight",
    swipeable: false,
    node: (
      <FamilyFestSpotlight
        name={FAMILY_FEST.name}
        tagline={FAMILY_FEST.tagline}
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        schedule={SCHEDULE}
      />
    ),
  });

  return <CalloutStack items={items} />;
}
