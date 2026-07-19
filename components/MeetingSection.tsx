"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { MeetingComposer } from "@/components/MeetingComposer";
import { MeetingSchedulerSheet } from "@/components/MeetingSchedulerSheet";
import { useDebouncedCallback } from "@/lib/hooks";
import { fetchCanOrganize, fetchMeetingsForRoom, type Meeting, type MeetingScope } from "@/lib/meetings";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";

// The meeting bar pinned at the top of a committee/house chat room (migration
// 0116). Self-contained: owns the room's meetings (fetch + realtime + SWR
// cache), the organizer gate, the ?meeting= deep-link, and both sheets. Shows
// the active (open, else upcoming scheduled) meeting to EVERY member so they can
// respond, plus a "Schedule a meeting" affordance for organizers. Renders
// nothing when there's nothing to show and the viewer can't organize.

interface RoomMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Stable per-room cache/channel segment. */
function roomKeyOf(scope: MeetingScope): string {
  return scope.type === "committee" ? `c:${scope.slug}|${scope.area ?? ""}` : `h:${scope.houseId}`;
}

function chosenInFuture(m: Meeting): boolean {
  const slot = m.slots.find((s) => s.id === m.chosenSlotId);
  return !!slot && new Date(slot.startsAt).getTime() > Date.now();
}

export function MeetingSection({
  scope,
  members,
  label,
}: {
  scope: MeetingScope;
  /** Room roster — for name resolution + the "everyone can make it" count. */
  members: RoomMember[];
  /** Human room name for the composer header (e.g. "Meals" or "MJT House"). */
  label: string;
}) {
  const { userId, isAdmin, previewAsId } = useIdentity();
  const roomKey = roomKeyOf(scope);

  // uid-scoped SWR cache (rules in CLAUDE.md): preview uses the preview id in a
  // memory-only key (persist off) so an admin viewing-as never writes another
  // account's snapshot to disk.
  const uidForKey = previewAsId ?? userId;
  const { data: meetings, reload, mutate } = useCachedResource<Meeting[]>(
    uidForKey ? `meetings.${uidForKey}.${roomKey}` : null,
    [],
    () => fetchMeetingsForRoom(scope),
    { persist: previewAsId ? undefined : "local" },
  );

  const [canOrganize, setCanOrganize] = useState(false);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [schedule] = useDebouncedCallback(250);

  // Can the viewer propose here? Ask the server so it can't drift from the RLS
  // gate. Guests/non-organizers just don't see the button.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setCanOrganize(false);
      return;
    }
    void fetchCanOrganize(scope).then((ok) => {
      if (!cancelled) setCanOrganize(ok);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, roomKey]);

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

  // What to surface in the bar: an open meeting wins; else an upcoming scheduled
  // one; else nothing.
  const featured =
    meetings.find((m) => m.status === "open") ??
    meetings.find((m) => m.status === "scheduled" && chosenInFuture(m)) ??
    null;

  if (!featured && !canOrganize) return null;

  const openMeeting = openId ? meetings.find((m) => m.id === openId) ?? null : null;

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-2">
      {featured ? (
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
      ) : (
        canOrganize && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="press flex w-full items-center justify-center gap-2 rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary ring-1 ring-primary/20"
          >
            📅 Schedule a meeting
          </button>
        )
      )}

      {/* When a meeting is already featured, organizers still get a quiet way to
          start another. */}
      {featured && canOrganize && (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="press mt-1.5 w-full text-center text-xs font-semibold text-primary"
        >
          + Schedule another meeting
        </button>
      )}

      {composing && (
        <MeetingComposer
          scope={scope}
          roomLabel={label}
          onClose={() => setComposing(false)}
          onCreated={onChanged}
        />
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
