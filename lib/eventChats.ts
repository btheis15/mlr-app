import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Event chats — one room per event, for the people actually going (migration
 * 0216). The Family Feed is for what everyone should see; this is for the
 * dozen people who'll be at the Work Weekend, so logistics stop bombarding
 * everyone else's notifications.
 *
 * ⚠️ **Membership is NOT resolved here.** `my_event_chats()` runs the same
 * `is_event_chat_member` predicate the RLS policies use, so the list can never
 * disagree with what the member can actually open — the `event_message_preview`
 * doctrine (0192). Never reimplement the going/maybe/creator/host rule client
 * side; it needs the viewer's committee memberships and which of those have
 * leads, and a second copy would drift on the first change to either.
 *
 * ⚠️ **Archived is DERIVED from the event's end date, not a stored flag** — the
 * server decides, this file only reports. Same for `muted`, which folds the
 * permanent flag and a still-running timer together (the split 0215 fixed).
 */

/** One row of the Feed's Events section. */
export interface EventChatSummary {
  eventId: string;
  title: string;
  emoji: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Read-only: the event ended more than 7 days ago (unless an admin reopened it). */
  archived: boolean;
  /** Last visible message, already composed as "Name: text" for the row. */
  last?: string;
  lastAt?: string;
  unread: number;
  muted: boolean;
  /** Set only while a timed mute is running. */
  mutedUntil?: string | null;
}

/** An archived room as the admin unarchive surface sees it — never any content. */
export interface ArchivedEventChat {
  eventId: string;
  title: string | null;
  emoji: string | null;
  startDate: string | null;
  endDate: string | null;
  messageCount: number;
  reopenedUntil: string | null;
}

/** A missing table/function means "migration 0216 hasn't been run" — degrade to
 *  empty rather than throwing, so the Feed still renders (the house-requests /
 *  drop-box seam idiom). Anything else is a real error worth surfacing. */
const isMissing = (code?: string) =>
  code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST116";

// A media-only message previews as its attachment kind rather than a bare
// "Name: " — mirrors FeedView's mediaPreviewLabel.
const mediaLabel = (t: string | null): string =>
  t === "sticker" ? "Sticker" : t === "video" ? "🎬 Video" : t === "file" ? "📎 File" : "📷 Photo";

/**
 * Every event chat the caller is in, live and archived, with previews. One
 * round-trip — resolving this client-side would be a membership probe per event
 * plus four reads each.
 */
export async function fetchMyEventChats(): Promise<EventChatSummary[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data, error } = await sb.rpc("my_event_chats");
  if (error) {
    if (!isMissing(error.code)) console.warn("[eventChats] my_event_chats failed", error.message);
    return [];
  }
  type Row = {
    event_id: string; title: string | null; emoji: string | null;
    start_date: string | null; end_date: string | null; archived: boolean;
    last_text: string | null; last_at: string | null; last_author: string | null;
    last_media: string | null; unread: number | string; muted: boolean;
    muted_until: string | null;
  };
  return ((data ?? []) as Row[])
    // An event row can only be missing if its `events` row went away between
    // the delete trigger firing and this read; a nameless row would render as a
    // blank tile, so drop it rather than paint a mystery.
    .filter((r) => r.title)
    .map((r) => {
      const who = r.last_author ? `${r.last_author}: ` : "";
      const body = r.last_text || (r.last_media ? mediaLabel(r.last_media) : "");
      return {
        eventId: r.event_id,
        title: r.title as string,
        emoji: r.emoji,
        startDate: r.start_date,
        endDate: r.end_date,
        archived: Boolean(r.archived),
        last: r.last_at ? who + body : undefined,
        lastAt: r.last_at ?? undefined,
        // `count(*)` comes back from PostgREST as a string — coerce, or the
        // badge does string concatenation instead of arithmetic (the same trap
        // `formatMoney` hit with numeric).
        unread: Number(r.unread ?? 0),
        muted: Boolean(r.muted),
        mutedUntil: r.muted_until,
      };
    })
    // Soonest first among live rooms; most recently finished first among
    // archived ones (what you'd go looking for in the archive).
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
}

/**
 * "View as" — which event chats does THAT member have? Per Brian: an admin
 * using View As should be able to confirm someone has access to the right
 * chats/features, and must not be able to read what's in them.
 *
 * ⚠️ So these summaries deliberately arrive with **no `last` preview** — the
 * server never sends one (`preview_event_chats`, 0216). The Feed's row would
 * otherwise print "Abbie: Black camo igloo with neon green", which is exactly
 * the content being withheld. The row falls back to its date subtitle instead.
 *
 * ⚠️ The caller must ALSO block the tap-through; the list is the whole
 * affordance in preview mode. RLS would deny the messages anyway (the admin
 * isn't a member of that room), but landing in a silently empty chat reads as a
 * bug rather than as a boundary.
 */
export async function fetchEventChatsForPreview(userId: string): Promise<EventChatSummary[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !userId) return [];
  const { data, error } = await sb.rpc("preview_event_chats", { p_user: userId });
  if (error) {
    if (!isMissing(error.code)) console.warn("[eventChats] preview list failed", error.message);
    return [];
  }
  type Row = {
    event_id: string; title: string | null; emoji: string | null;
    start_date: string | null; end_date: string | null; archived: boolean;
    unread: number | string; muted: boolean; muted_until: string | null;
  };
  return ((data ?? []) as Row[])
    .filter((r) => r.title)
    .map((r) => ({
      eventId: r.event_id,
      title: r.title as string,
      emoji: r.emoji,
      startDate: r.start_date,
      endDate: r.end_date,
      archived: Boolean(r.archived),
      last: undefined, // withheld on purpose — see above
      lastAt: undefined,
      unread: Number(r.unread ?? 0),
      muted: Boolean(r.muted),
      mutedUntil: r.muted_until,
    }))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
}

export async function markEventChatRead(eventId: string): Promise<void> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return;
  await sb.rpc("mark_event_chat_read", { p_event_id: eventId });
}

/** Mute/unmute one event chat. `hours = null` with `muted` means permanent. */
export async function setEventChatMute(
  eventId: string,
  muted: boolean,
  hours: number | null,
): Promise<void> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return;
  const until = muted && hours != null ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
  await sb.rpc("set_event_chat_mute", { p_event_id: eventId, p_muted: muted, p_muted_until: until });
}

/** Admin only: every archived room, for the reopen surface. */
export async function fetchArchivedEventChats(): Promise<ArchivedEventChat[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data, error } = await sb.rpc("admin_archived_event_chats");
  if (error) {
    if (!isMissing(error.code)) console.warn("[eventChats] archived list failed", error.message);
    return [];
  }
  type Row = {
    event_id: string; title: string | null; emoji: string | null;
    start_date: string | null; end_date: string | null;
    message_count: number | string; reopened_until: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    eventId: r.event_id,
    title: r.title,
    emoji: r.emoji,
    startDate: r.start_date,
    endDate: r.end_date,
    messageCount: Number(r.message_count ?? 0),
    reopenedUntil: r.reopened_until,
  }));
}

/**
 * Admin only: reopen an archived room for 1 or 7 days, or pass `null` to
 * re-archive it now. Returns the instant it re-archives.
 *
 * ⚠️ Reopening lets the people who were in it post again; it does NOT let the
 * admin read it. An admin who wasn't going still can't see a word (0216).
 */
export async function setEventChatReopened(
  eventId: string,
  days: 1 | 7 | null,
): Promise<{ ok: true; until: string | null } | { ok: false; error: string }> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return { ok: false, error: "Not connected." };
  const { data, error } = await sb.rpc("set_event_chat_reopened", { p_event_id: eventId, p_days: days });
  // Carry the server's own message up — the RSVP outage (0210) showed how a
  // generic "couldn't save" makes an app-wide failure look like one bad wifi.
  if (error) return { ok: false, error: error.message || "Couldn't change that." };
  return { ok: true, until: (data as string | null) ?? null };
}

/** Is this room muted right now? Mirrors the SQL rule for locally-updated state. */
export const eventChatMuted = (s: Pick<EventChatSummary, "muted" | "mutedUntil">): boolean =>
  s.muted || Boolean(s.mutedUntil && new Date(s.mutedUntil).getTime() > Date.now());
