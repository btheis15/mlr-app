"use client";

import { useFestContent } from "@/lib/useFestContent";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";

/**
 * The Home "what's happening" slot. The Family Fest spotlight is the permanent
 * base; temporary call-outs (future news/alerts) stack on top of it as
 * swipe-away cards (see CalloutStack). Stacking — rather than listing them down
 * the page — is deliberate: it keeps the slot to one card tall so the
 * Ask-for-Help row below stays in view no matter how many call-outs are active.
 *
 * Add a future call-out by pushing another swipeable StackItem ABOVE the base,
 * gated by whatever decides it should show. Give it a stable, versioned id so a
 * brand-new alert reappears even if a same-purpose card was swiped before.
 */
export function HomeSpotlight() {
  // Live fest content (schedule + meta) so the spotlight matches the Planner.
  const { config, schedule } = useFestContent({ realtime: true });

  const items: StackItem[] = [];

  // The permanent base — never swipeable, so something always sits here.
  items.push({
    id: "family-fest-spotlight",
    swipeable: false,
    node: (
      <FamilyFestSpotlight
        name={config.name}
        tagline={config.tagline}
        startDate={config.startDate}
        endDate={config.endDate}
        schedule={schedule}
      />
    ),
  });

  return <CalloutStack items={items} />;
}
