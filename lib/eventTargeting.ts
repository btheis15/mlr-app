// Shared "only show to people attending this event" targeting, used by the
// three admin broadcast tools (Home callouts, the top-of-app banner, and the
// Activity-tab notification composer — all under Admin → Alerts &
// Notifications). An admin picks an event and an opt-out box, checked by
// default once an event is chosen: someone who explicitly RSVP'd "Can't make
// it" to that event won't see the callout/alert/notification. Anyone who
// hasn't answered yet (or said Going/Maybe) still sees it — they might still
// come, and seeing it can nudge them to RSVP. That's a deliberate choice: a
// silent no-response read as "excluded" would risk someone missing something
// they'd have wanted, which is worse than one extra card for someone who's
// truly not coming.
//
// Callouts and the banner are both fully client-rendered, so their filtering
// happens in the browser against the viewer's own `useEvents().mine` map (see
// isHiddenForEventTarget below). Broadcast notifications persist a row per
// recipient at send time, so that filtering has to happen server-side in the
// send_broadcast_notification RPC (migration 0096) — this module only carries
// the client-side half.

import type { AttendanceStatus, EventAttendance } from "@/lib/types";
import { effectiveStatus } from "@/lib/events";

/** True if this viewer should NOT see something targeted at `eventId` with
 *  `excludeNotAttending` on — i.e. they explicitly RSVP'd "Can't make it".
 *  No event, the toggle off, or no RSVP row at all ⇒ never hidden. */
export function isHiddenForEventTarget(
  mine: Record<string, EventAttendance>,
  eventId: string | null | undefined,
  excludeNotAttending: boolean | null | undefined,
): boolean {
  if (!eventId || !excludeNotAttending) return false;
  const row = mine[eventId];
  if (!row) return false;
  const status: AttendanceStatus = effectiveStatus(row.status, row.days);
  return status === "not_going";
}
