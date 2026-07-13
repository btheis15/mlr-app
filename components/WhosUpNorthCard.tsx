"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchEvents, fetchAttendance } from "@/lib/events";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { presentFromAttendance, presentFromCabins, mergePresence, type PresentMember } from "@/lib/presence";

const MAX_SHOWN = 8;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Members-only "who's up north today" strip. Presence is derived EXACTLY like
 * Ask for Help (lib/helpRequests.ts, widened from "am I present" to "who's
 * present" in lib/presence.ts): RSVP'd going to an event whose ±2-day window
 * covers today — day-aware (`days[today]`) on a real event day, lenient
 * ("going at all") on the grace shoulder — OR an approved cabin booking
 * covering today. Reads via `fetchEvents()`/`fetchAttendance()`
 * (lib/events.ts) — the same functions `useEvents()` itself calls — rather
 * than that hook, because the hook only exposes pre-grouped `summaries`
 * (going/maybe/not-going rolled up over an event's WHOLE run), which loses
 * the per-day `days` map this card needs for the "going today specifically"
 * check on a real event day. `today` comes from `useDemoDate()` — the same
 * "see the app as if it's this day" override Ask for Help honors, so a demo
 * date test also moves this card. Null for guests or when nobody's present /
 * the data isn't reachable.
 *
 * Usage: `<WhosUpNorthCard />` — anywhere on Home, members-only (self-hides
 * for guests and on a day with nobody up north).
 */
export function WhosUpNorthCard() {
  const { user } = useIdentity();
  const { today } = useDemoDate();
  const [members, setMembers] = useState<PresentMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !today) {
      setMembers([]);
      return;
    }
    (async () => {
      try {
        const [events, rows, cabin] = await Promise.all([fetchEvents(), fetchAttendance(), presentFromCabins(today)]);
        if (cancelled) return;
        const eventPresence = presentFromAttendance(events, rows, today);
        setMembers(mergePresence(eventPresence, cabin));
      } catch {
        if (!cancelled) setMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, today]);

  if (!user || !members.length) return null;

  const shown = members.slice(0, MAX_SHOWN);
  const overflow = members.length - shown.length;
  const namesLine = shown.map((m) => firstName(m.name)).join(", ") + (overflow > 0 ? ` +${overflow} more` : "");

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <span aria-hidden className="text-2xl leading-none">
        🏕
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Up North right now</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex shrink-0 -space-x-2">
            {shown.map((m) => (
              <Avatar key={m.userId} name={m.name} url={m.avatarUrl} size={26} className="ring-2 ring-card" />
            ))}
            {overflow > 0 && (
              <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground/70 ring-2 ring-card">
                +{overflow}
              </span>
            )}
          </div>
          <p className="min-w-0 truncate text-xs text-foreground/60">{namesLine}</p>
        </div>
      </div>
    </div>
  );
}
