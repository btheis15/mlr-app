"use client";

import { useMemo, useState } from "react";
import { useFestContent } from "@/lib/useFestContent";
import { useEvents } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";
import { CalloutCard } from "@/components/CalloutCard";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isHiddenForEventTarget } from "@/lib/eventTargeting";
import { fetchMyCalloutCompletions, markCalloutDone } from "@/lib/calloutCompletions";
import { useCachedResource } from "@/lib/swrCache";
import type { HomeCallout } from "@/lib/festContent";

/** Is this call-out showing today? `today` is null until mounted: an
 *  UNBOUNDED card shows immediately (it can't be wrong), but a date-bounded
 *  card waits for the real date — otherwise an expired card would flash on
 *  every cold open and vanish after hydration, which reads as a glitch.
 *  Appearing a beat late is the calmer failure mode. Null bounds are
 *  open-ended; `endsOn` is the inclusive last day shown. */
function isLive(c: HomeCallout, today: string | null): boolean {
  if (!c.isActive) return false;
  if (today === null) return !c.startsOn && !c.endsOn;
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
  const { config, schedule, dinners, callouts } = useFestContent({ realtime: true });
  const { today } = useDemoDate();
  // The viewer's own RSVPs, for callouts targeted at an event (see
  // lib/eventTargeting.ts) — hides a card from anyone who explicitly RSVP'd
  // "Can't make it" to the linked event. Shares the same events cache/fetch
  // as everything else that calls useEvents(), so this doesn't add a
  // separate round-trip.
  const { mine } = useEvents();
  const { user, userId, promptSignIn } = useIdentity();

  // Callouts this viewer has marked "done" (migration 0098) — permanently
  // hidden, unlike the swipe/✕ dismiss which only lasts the session. The ids
  // ride the shared SWR cache with local persistence (`calloutsDone.<uid>`),
  // so on the next app open the completed card is filtered out from the very
  // first paint — no more "shows for half a second then vanishes". The fetch
  // still revalidates against home_callout_completions (a completion made on
  // another device appears; a deleted row eventually clears). Keyed on the
  // REAL uid even while an admin previews — completions always belong to the
  // real account (markCalloutDone writes the real user's row).
  const [marking, setMarking] = useState<string | null>(null);
  const { data: completedIds, mutate: mutateCompleted } = useCachedResource<string[]>(
    user && userId ? `calloutsDone.${userId}` : null,
    [],
    () => fetchMyCalloutCompletions(userId).then((ids) => [...ids]),
    { persist: "local" },
  );
  const completed = useMemo(() => new Set(completedIds), [completedIds]);

  const onMarkDone = (calloutId: string) => {
    if (!user || !userId) {
      promptSignIn();
      return;
    }
    setMarking(calloutId);
    // Optimistic + persisted in one call: it disappears the instant you tap it
    // and stays gone on the next cold open, even before the round-trip lands.
    const addId = (prev: string[]) => (prev.includes(calloutId) ? prev : [...prev, calloutId]);
    mutateCompleted(addId);
    markCalloutDone(calloutId, userId)
      // Re-apply after the write lands, in case the initial fetch was in
      // flight during the tap and its (pre-write) result overwrote the
      // optimistic id.
      .then(() => mutateCompleted(addId))
      .finally(() => setMarking(null));
  };

  const items: StackItem[] = callouts
    .filter((c) => isLive(c, today) && !isHiddenForEventTarget(mine, c.eventId, c.excludeNotAttending) && !completed.has(c.id))
    .map((c) => ({
      id: c.dismissId,
      swipeable: true,
      node: <CalloutCard callout={c} onMarkDone={() => onMarkDone(c.id)} marking={marking === c.id} />,
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
        dinners={dinners}
      />
    ),
  });

  return <CalloutStack items={items} />;
}
