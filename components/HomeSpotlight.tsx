"use client";

import { useFestContent } from "@/lib/useFestContent";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";
import { CalloutCard } from "@/components/CalloutCard";
import { useDemoDate } from "@/lib/DemoDateProvider";
import type { HomeCallout } from "@/lib/festContent";

/** Is this call-out showing today? `today` is null until mounted — treat that
 *  as "show" so a card never pops in after hydration; null bounds are
 *  open-ended; `endsOn` is the inclusive last day shown. */
function isLive(c: HomeCallout, today: string | null): boolean {
  if (!c.isActive) return false;
  if (today === null) return true;
  if (c.startsOn && today < c.startsOn) return false;
  if (c.endsOn && today > c.endsOn) return false;
  return true;
}

/**
 * The Home "what's happening" slot. The Family Fest spotlight is the permanent
 * base; temporary call-outs stack on top of it as swipe-away cards (see
 * CalloutStack). Stacking — rather than listing them down the page — is
 * deliberate: it keeps the slot to one card tall so the Ask-for-Help row below
 * stays in view no matter how many call-outs are active.
 *
 * Call-outs are admin-managed rows in `home_callouts` (migration 0083, edited
 * in the Family Fest Planner's Callouts section), rendered by CalloutCard. Each
 * card's StackItem id is its row's `dismiss_id` — editors version it (the
 * Planner suggests slug+date) so a brand-new alert reappears even in a session
 * where an old, same-purpose card was swiped. Pre-migration / offline,
 * fetchFestContent falls back to the in-code seed (the t-shirt flyer), so Home
 * is identical whether or not the migration has run.
 */
export function HomeSpotlight() {
  // Live fest content (schedule + meta + call-outs) so Home matches the Planner.
  const { config, schedule, callouts } = useFestContent({ realtime: true });
  const { today } = useDemoDate();

  const items: StackItem[] = callouts
    .filter((c) => isLive(c, today))
    .map((c) => ({
      id: c.dismissId,
      swipeable: true,
      node: <CalloutCard callout={c} />,
    }));

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
