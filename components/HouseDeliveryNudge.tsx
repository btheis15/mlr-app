"use client";

import { useMemo } from "react";
import { useEvents, useHouseCalendar } from "@/lib/hooks";
import { useCachedResource } from "@/lib/swrCache";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchHouseMembers, impliedStays, nextPresence, type HouseMember } from "@/lib/housePresence";
import { requestCost, type HouseRequest } from "@/lib/houseRequests";
import { formatDateRange, formatMoney, plural } from "@/lib/format";

/**
 * How far ahead the in-app card looks. Deliberately WIDER than the push
 * (`ORDER_REMINDER_DAYS` = 7 on the mini's order-reminder.js), and the difference
 * is intentional:
 *
 *   • The push INTERRUPTS somebody, so it fires once, close in, when the errand
 *     is genuinely urgent.
 *   • This card is passive — it only appears at all when there really are
 *     approved purchases nobody has ordered, i.e. work that's already overdue —
 *     and ordering something that has to SHIP needs more than a week of warning.
 *
 * Six weeks covers "a work weekend is on the calendar and there are three things
 * sitting approved" without being so far out that it's noise.
 */
const NUDGE_WITHIN_DAYS = 45;

/**
 * "People are going to be at the house — and there's stuff nobody's ordered."
 *
 * The gap this closes: a purchase gets approved, and then it just sits, because
 * ordering it has no deadline attached to it. But there IS a natural deadline —
 * the next time anyone is actually at the house to receive a delivery. Pairing
 * the two turns "somebody should buy this eventually" into "order it this week
 * and have it waiting at the door."
 *
 * ⚠️ Presence includes RSVPs, not just typed stays (lib/housePresence): the whole
 * point is knowing somebody will be there, and most people never add a stay for a
 * resort event they've already RSVP'd to.
 *
 * ⚠️ It also offers the OTHER reading, because it's at least as likely: the thing
 * may well have been bought already and simply never marked ordered. The card
 * says so rather than nagging an admin about a job they already did.
 *
 * Renders nothing unless there's both something unordered and somebody coming.
 */
export function HouseDeliveryNudge({
  houseId,
  houseName,
  requests,
}: {
  houseId: string;
  houseName: string;
  requests: HouseRequest[];
}) {
  const { today } = useDemoDate();
  const { stays } = useHouseCalendar(houseId);
  const events = useEvents();

  const { data: members } = useCachedResource<HouseMember[]>(
    isSupabaseConfigured ? `houseMembers.${houseId}` : null,
    [],
    () => fetchHouseMembers(houseId),
    { persist: "local" },
  );

  // ⚠️ PURCHASES ONLY. An approved reimbursement needs paying, not delivering,
  // and an approved idea has nothing to buy at all — neither has any relationship
  // to when somebody is at the house.
  const unordered = useMemo(
    () => requests.filter((r) => r.kind === "purchase" && r.status === "approved"),
    [requests],
  );

  const goingRows = useMemo(
    () => Object.values(events.summaries).flatMap((s) => s.going),
    [events.summaries],
  );
  const presence = useMemo(() => {
    if (!today) return null;
    const implied = impliedStays({ events: events.events, attendance: goingRows, members, stays, today });
    return nextPresence({ stays, implied, today });
  }, [events.events, goingRows, members, stays, today]);

  if (unordered.length === 0 || !presence || presence.daysUntil > NUDGE_WITHIN_DAYS) return null;

  const total = unordered.reduce((sum, r) => sum + (requestCost(r) ?? 0), 0);
  const soon = presence.daysUntil <= 7;
  const here = presence.daysUntil === 0;
  const who =
    presence.names.length <= 3
      ? presence.names.join(", ")
      : `${presence.names.slice(0, 2).join(", ")} and ${presence.names.length - 2} more`;

  return (
    <section className="space-y-2 rounded-2xl bg-lake/10 p-4 ring-1 ring-lake/20">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="text-xl leading-none">
          🚚
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold leading-snug">
            {here ? `Somebody's at ${houseName} right now` : `People will be at ${houseName} soon`}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {presence.eventTitle ? `${presence.eventTitle} · ` : ""}
            {formatDateRange(presence.startDate, presence.endDate)}
            {here ? "" : ` · in ${presence.daysUntil} ${plural(presence.daysUntil, "day")}`}
          </p>
          {who && <p className="mt-0.5 truncate text-xs text-muted">{who}</p>}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-foreground/80">
        <span className="font-semibold">
          {unordered.length} approved {plural(unordered.length, "purchase")}{" "}
          {unordered.length === 1 ? "isn't" : "aren't"} marked ordered
        </span>
        {total > 0 ? ` (${formatMoney(total)})` : ""}.{" "}
        {soon
          ? "If it still needs buying, order today so it can be delivered while everyone's up there."
          : "Ordering now means it can be delivered to the house while everyone's up there."}
      </p>

      {/* ⚠️ The equally-likely other explanation, said out loud. Nagging a House
          Admin to do something they already did is how a reminder gets ignored. */}
      <p className="text-xs leading-relaxed text-muted">
        Already bought {unordered.length === 1 ? "it" : "them"}? Mark{" "}
        {unordered.length === 1 ? "it" : "them"} ordered below so nobody buys{" "}
        {unordered.length === 1 ? "it" : "them"} twice.
      </p>

      <ul className="space-y-1 pt-0.5">
        {unordered.slice(0, 4).map((r) => (
          <li key={r.id} className="flex items-baseline gap-2 text-xs">
            <span aria-hidden className="text-faint">
              •
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
            {requestCost(r) !== null && (
              <span className="shrink-0 tabular-nums text-muted">{formatMoney(requestCost(r))}</span>
            )}
          </li>
        ))}
        {unordered.length > 4 && (
          <li className="pl-4 text-xs text-faint">and {unordered.length - 4} more</li>
        )}
      </ul>
    </section>
  );
}
