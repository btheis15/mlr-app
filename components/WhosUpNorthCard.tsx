"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchEvents, fetchAttendance } from "@/lib/events";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useCachedResource } from "@/lib/swrCache";
import { useSheetDismiss } from "@/lib/hooks";
import { Sheet } from "@/components/Sheet";
import { MemberSheet } from "@/components/MemberSheet";
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
 * Tapping the card opens a full roster sheet (`UpNorthSheet`) of everyone
 * shown here — same data, no extra fetch — and tapping a name there opens
 * their profile via the shared `MemberSheet`.
 *
 * Usage: `<WhosUpNorthCard />` — anywhere on Home, members-only (self-hides
 * for guests and on a day with nobody up north).
 */
export function WhosUpNorthCard() {
  const { user, userId } = useIdentity();
  const { today } = useDemoDate();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [profile, setProfile] = useState<{ id: string; name: string; avatar: string | null } | null>(null);
  // Shared SWR cache, date-scoped (`whosUpNorth.<uid>.<today>`, 30-minute TTL)
  // so a cold open paints the strip instantly instead of popping in — and a
  // stale DAY can never paint, since yesterday's key simply isn't today's.
  const { data: members } = useCachedResource<PresentMember[]>(
    user && userId && today ? `whosUpNorth.${userId}.${today}` : null,
    [],
    async () => {
      const [events, rows, cabin] = await Promise.all([fetchEvents(), fetchAttendance(), presentFromCabins(today!)]);
      return mergePresence(presentFromAttendance(events, rows, today!), cabin);
    },
    { persist: "local", ttlMs: 30 * 60 * 1000 },
  );

  if (!user || !members.length) return null;

  const shown = members.slice(0, MAX_SHOWN);
  const overflow = members.length - shown.length;
  const namesLine = shown.map((m) => firstName(m.name)).join(", ") + (overflow > 0 ? ` +${overflow} more` : "");

  return (
    <>
      <button
        type="button"
        onClick={() => setRosterOpen(true)}
        className="press flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border"
      >
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
        <span aria-hidden className="shrink-0 text-foreground/30">
          ›
        </span>
      </button>

      {rosterOpen && (
        <UpNorthSheet
          members={members}
          onOpenMember={(m) => setProfile({ id: m.userId, name: m.name, avatar: m.avatarUrl })}
          onClose={() => setRosterOpen(false)}
        />
      )}

      {profile && <MemberSheet key={profile.id} id={profile.id} name={profile.name} avatarUrl={profile.avatar} onClose={() => setProfile(null)} />}
    </>
  );
}

/** The full "Up North right now" roster — same members the card already
 *  fetched, just listed out with a tap-through to each person's profile. */
function UpNorthSheet({
  members,
  onOpenMember,
  onClose,
}: {
  members: PresentMember[];
  onOpenMember: (m: PresentMember) => void;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="up-north-title"
      header={
        <h2 id="up-north-title" className="text-lg font-bold">
          🏕 Up North right now · {members.length}
        </h2>
      }
    >
      <ul className="space-y-1.5">
        {members.map((m) => (
          <li key={m.userId}>
            <button
              type="button"
              onClick={() => onOpenMember(m)}
              className="press flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left ring-1 ring-border"
            >
              <Avatar name={m.name} url={m.avatarUrl} size={36} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
              <span aria-hidden className="shrink-0 text-foreground/30">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
