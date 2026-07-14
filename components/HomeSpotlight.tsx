"use client";

import { useEffect, useState } from "react";
import { useFestContent } from "@/lib/useFestContent";
import { useEvents } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";
import { CalloutCard } from "@/components/CalloutCard";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isHiddenForEventTarget } from "@/lib/eventTargeting";
import { fetchMyCalloutCompletions, markCalloutDone } from "@/lib/calloutCompletions";
import { getCurrentUserId } from "@/lib/roles";
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
  const { user, promptSignIn } = useIdentity();

  // Callouts this viewer has marked "done" (migration 0098) — permanently
  // hidden, unlike the swipe/✕ dismiss which only lasts the session. `User`
  // (IdentityProvider) doesn't carry the Supabase auth uid, so it's resolved
  // via getCurrentUserId() — `user` (name/email) is just the signed-in-or-not
  // trigger.
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState<string | null>(null);
  useEffect(() => {
    if (!user) {
      setCompleted(new Set());
      return;
    }
    let cancelled = false;
    getCurrentUserId().then((uid) => {
      if (cancelled || !uid) return;
      fetchMyCalloutCompletions(uid).then((ids) => {
        if (!cancelled) setCompleted(ids);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onMarkDone = (calloutId: string) => {
    if (!user) {
      promptSignIn();
      return;
    }
    setMarking(calloutId);
    // Optimistic: it should disappear the instant you tap it, not after the
    // round-trip lands.
    setCompleted((prev) => new Set(prev).add(calloutId));
    getCurrentUserId().then((uid) => {
      if (!uid) return;
      return markCalloutDone(calloutId, uid);
    }).finally(() => setMarking(null));
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
