"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { MeetingSchedulerSheet } from "@/components/MeetingSchedulerSheet";
import { useDebouncedCallback } from "@/lib/hooks";
import { fetchMeetingsForRoom, type Meeting, type MeetingScope } from "@/lib/meetings";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";

// The active-meeting bar pinned at the top of a committee/house chat room
// (migration 0116). Scheduling a NEW meeting is a rare-but-important action and
// lives out of the way in the room's ⋯ menu (FeedView's ChatMembersSheet); this
// component is only the RESPONSE surface — it shows the currently active (open,
// else upcoming scheduled) meeting to every member so they can mark availability
// and, for the organizer, finalize it. It renders nothing when there's no live
// meeting, so the chat stays clean the rest of the time. A meeting created from
// the ⋯ menu shows up here on the next realtime tick.

interface RoomMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Stable per-room cache/channel segment. 'family' has no room — it's everyone. */
function roomKeyOf(scope: MeetingScope): string {
  if (scope.type === "committee") return `c:${scope.slug}|${scope.area ?? ""}`;
  if (scope.type === "house") return `h:${scope.houseId}`;
  return "family";
}

function chosenInFuture(m: Meeting): boolean {
  const slot = m.slots.find((s) => s.id === m.chosenSlotId);
  return !!slot && new Date(slot.startsAt).getTime() > Date.now();
}

export function MeetingSection({
  scope,
  members,
  surface = "chat",
}: {
  scope: MeetingScope;
  /** Room roster — for name resolution + the "everyone can make it" count. */
  members: RoomMember[];
  /** "chat" = a flush top-of-room bar; "card" = a rounded card for a page (e.g.
   *  the committee detail page). */
  surface?: "chat" | "card";
}) {
  const { userId, isAdmin, previewAsId } = useIdentity();
  const roomKey = roomKeyOf(scope);

  // uid-scoped SWR cache (rules in CLAUDE.md): preview uses the preview id in a
  // memory-only key (persist off) so an admin viewing-as never writes another
  // account's snapshot to disk.
  const uidForKey = previewAsId ?? userId;
  const { data: meetings, reload } = useCachedResource<Meeting[]>(
    uidForKey ? `meetings.${uidForKey}.${roomKey}` : null,
    [],
    () => fetchMeetingsForRoom(scope),
    { persist: previewAsId ? undefined : "local" },
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const [schedule] = useDebouncedCallback(250);

  // Live: refetch (debounced) when any meeting/slot/availability row changes.
  // Wrapped so a pre-migration publication degrades to load-on-open.
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let channel: ReturnType<typeof sb.channel> | null = null;
    try {
      channel = sb
        .channel(`meetings-${roomKey}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => schedule(reload))
        .on("postgres_changes", { event: "*", schema: "public", table: "meeting_slots" }, () => schedule(reload))
        .on("postgres_changes", { event: "*", schema: "public", table: "meeting_availability" }, () => schedule(reload))
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [reload, schedule, roomKey]);

  // Deep-link: /posts?...&meeting=<id> opens that meeting once it's loaded. Read
  // from the URL directly (client-only, in an effect) — the same pattern FeedView
  // uses for ?c=/?house=, so no useSearchParams Suspense boundary is needed.
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const deepLinkId = new URLSearchParams(window.location.search).get("meeting");
    if (!deepLinkId || deepLinkedRef.current === deepLinkId) return;
    if (meetings.some((m) => m.id === deepLinkId)) {
      deepLinkedRef.current = deepLinkId;
      setOpenId(deepLinkId);
    }
  }, [meetings]);

  const onChanged = useCallback(() => {
    void reload();
  }, [reload]);

  if (!isSupabaseConfigured) return null;

  // The live meeting to surface: an open one wins; else an upcoming scheduled one.
  const featured =
    meetings.find((m) => m.status === "open") ??
    meetings.find((m) => m.status === "scheduled" && chosenInFuture(m)) ??
    null;

  const openMeeting = openId ? meetings.find((m) => m.id === openId) ?? null : null;

  // Nothing live → render nothing (creation is in the ⋯ menu). Still mount the
  // scheduler if a deep-link opened a specific (e.g. just-cancelled) meeting.
  if (!featured && !openMeeting) return null;

  return (
    <div
      className={
        surface === "card"
          ? "rounded-2xl bg-card px-3 py-2 ring-1 ring-border"
          : "shrink-0 border-b border-border bg-card px-3 py-2"
      }
    >
      {featured && (
        <button
          type="button"
          onClick={() => setOpenId(featured.id)}
          className="press flex w-full items-center gap-2.5 rounded-xl bg-primary/5 px-3 py-2 text-left ring-1 ring-primary/20"
        >
          <span aria-hidden className="text-lg">
            📅
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{featured.title}</span>
            <span className="block truncate text-xs text-muted">
              {featured.status === "open"
                ? `Mark when you’re free · ${featured.respondentCount} responded`
                : "Meeting scheduled — tap for details"}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-primary">
            ›
          </span>
        </button>
      )}

      {openMeeting && (
        <MeetingSchedulerSheet
          key={openMeeting.id}
          meeting={openMeeting}
          members={members}
          memberCount={members.length}
          canManage={isAdmin || openMeeting.createdByMe}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
