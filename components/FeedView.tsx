"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { POSTS } from "@/lib/data";

// Run the chat viewport-pin BEFORE the browser paints, so the mobile height
// reconciliation (calc(100dvh) inline → visualViewport height) happens in the
// same frame the chat appears — no post-paint resize jump/flicker. Falls back to
// useEffect during SSR (useLayoutEffect would warn there). Decided once at module
// load, so it doesn't change between renders.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { PostsView } from "@/components/PostsView";
import { CommitteeChat } from "@/components/CommitteeChat";
import { EventChat } from "@/components/EventChat";
import { HouseChat } from "@/components/HouseChat";
import { ConversationSearch } from "@/components/ConversationSearch";
import type { SearchResult } from "@/lib/search";
import { Sheet } from "@/components/Sheet";
import { MeetingComposer } from "@/components/MeetingComposer";
import { ChatPollComposer } from "@/components/ChatPollComposer";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchCanOrganize, type MeetingScope } from "@/lib/meetings";
import type { ChatPollScope } from "@/lib/chatPolls";
import { fetchCommitteeRecipients, fetchHouseRecipients, type RecipientResult } from "@/lib/emailBlast";
import { useSheetDismiss, useUrlParam } from "@/lib/hooks";
import { readPersisted, writePersisted } from "@/lib/swrCache";
import {
  fetchEventChatsForPreview,
  fetchMyEventChats,
  setEventChatMute,
  type EventChatSummary,
} from "@/lib/eventChats";
import { useRouter } from "next/navigation";

/**
 * The "Feed" tab — a Messages-style conversation list grouped into sections
 * (mirrors the iOS app's inset-grouped screen): "Family Feed" (the resort
 * posts) pinned on top, then "Your house", then the committee chats split into
 * three sections in order — "Lead chats" (a private per-committee Leads room,
 * only if you lead something there — migration 0172), "Full helping crew" (each
 * committee's committee-wide channel, area IS NULL — the old "General"), and
 * "Roles & subcommittees" (one row per role/area you hold, e.g. Family Fest →
 * "Meals"). Each section is one card with inset dividers between its rows. Tap a
 * row to open that chat. If you're in no house or committee, the tab drops
 * straight into the Family Feed. Each row shows a last-message preview + unread
 * badge + a mute toggle (0063) — including the pinned Family Feed row itself
 * (migration 0214), whose bell silences new-post pushes without hiding the
 * Activity-tab rows. ⚠️ A member in no house and no committee is dropped
 * straight into the Family Feed and never sees this list, so for them the bell
 * is unreachable and Profile → Notifications stays the only control.
 */
/** The reserved area value for a committee's private Leads chat (migration
 *  0172). Not a real role — messages just carry area = "Leads", and
 *  can_access_committee_area gates it to that committee's area-leads. */
const LEADS_AREA = "Leads";

interface Channel {
  key: string;            // `${slug}|${area ?? ""}`
  committeeId: string;
  slug: string;
  name: string;
  emoji: string;
  area: string | null;    // null = the committee-wide "Helping crew" channel
  /** Which Feed section this row lives in. */
  kind: "general" | "area" | "leads";
  title: string;
  subtitle: string | null;
}
interface HouseChannel {
  key: string;            // `house|${slug}`
  houseId: string;
  slug: string;
  name: string;
  emoji: string;
}
interface Summary {
  last?: string;
  at?: string;
  unread: number;
  muted: boolean;
  /** Set only for a timed mute (null/undefined = permanent or not muted). */
  mutedUntil?: string | null;
}
/** The Family Feed's key in `summaries`. Not a real channel (it has no room to
 *  read or unread count) — it exists so the pinned Family Feed row can carry a
 *  mute bell through the same `summaries`/`bellTapped`/`applyMute` path as every
 *  other row, rather than growing a parallel set of state just for it. */
const FEED_KEY = "feed";
/** What the mute-duration sheet is currently muting — a committee channel, the
 *  house chat, or the Family Feed, so one sheet + one set_*_mute call site covers
 *  all three. */
type MuteTarget =
  | { kind: "committee"; committeeId: string; area: string | null }
  | { kind: "house"; houseId: string }
  | { kind: "feed" }
  | { kind: "event"; eventId: string };

/** An event chat's key in `summaries` / `active`. */
const eventKey = (eventId: string) => `event|${eventId}`;
/** "1 day" / "3 days" / "7 days" / "until I turn it back on" — a null hours
 *  means permanent (no muted_until, mirrors the old toggle behavior). */
const MUTE_DURATIONS: { label: string; hours: number | null }[] = [
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "Until I turn it back on", hours: null },
];
/** Who the ⋯ menu's "Email members" button would email — mirrors the same
 *  room the "who's in this chat" roster (`members`) is already showing. */
type EmailTarget =
  | { type: "committee"; committeeId: string; area: string | null; label: string }
  | { type: "house"; houseId: string; label: string };

const stripLead = (role: string) => (role.endsWith(" · Lead") ? role.slice(0, -" · Lead".length) : role);

// A media-only message (no text) previews as its attachment kind rather than a
// bare "Name: ". Only image/video/sticker/gif are possible (message_media's
// check constraint) — gif falls back to the photo placeholder.
const mediaPreviewLabel = (mediaType: string): string =>
  mediaType === "sticker" ? "Sticker" : mediaType === "video" ? "🎬 Video" : "📷 Photo";

/**
 * Stale-while-revalidate snapshot of the channel list. FeedView remounts on
 * every tab navigation; without a seed, channels/houseChannel reset to
 * empty/null and the "no house & no committee → Main Feed" guard fires for a
 * beat before the load effect resolves — so anyone in a house or committee
 * sees the Main Feed flash, then pops to the Chats list. Two layers now:
 * this memory Map (tab switches, same session) plus a persisted copy under
 * `mlr.cache.v1.feed.<uid>` (lib/swrCache) restored in a post-mount effect,
 * so a COLD app open paints the last known list instantly too. Keyed by uid
 * (or the preview id — previews are never persisted) so a different viewer
 * never reads another's channels. Memory writes happen ONLY inside effects,
 * never during render/SSR — the map is empty at module-eval, so a cold first
 * render still hits the []/null defaults that match the prerendered HTML.
 */
interface FeedSnapshot {
  channels: Channel[];
  houseChannel: HouseChannel | null;
  summaries: Record<string, Summary>;
  /** Read-only chats from committees/roles that were "deleted" (archived,
   *  migration 0112) — you were in them, so their history stays reachable. */
  archivedChannels?: Channel[];
  /** Event chats (0216) — live ones render in their own "Events" section, and
   *  the archived ones join the Archived line at the foot of the list. */
  eventChats?: EventChatSummary[];
}
const feedCache = new Map<string, FeedSnapshot>();

export function FeedView() {
  const { user, userId, previewAsId, authReady } = useIdentity();
  const cacheKey = previewAsId ? `preview.${previewAsId}` : (userId ?? "");
  const cached = feedCache.get(cacheKey);
  const [channels, setChannels] = useState<Channel[]>(cached?.channels ?? []);
  const [archivedChannels, setArchivedChannels] = useState<Channel[]>(cached?.archivedChannels ?? []);
  const [houseChannel, setHouseChannel] = useState<HouseChannel | null>(cached?.houseChannel ?? null);
  const [active, setActive] = useState<string>("list"); // "list" | "posts" | channel.key | house key
  const [summaries, setSummaries] = useState<Record<string, Summary>>(cached?.summaries ?? {});
  const [eventChats, setEventChats] = useState<EventChatSummary[]>(cached?.eventChats ?? []);
  // A chat archives itself 7 days after its event ends (the server decides —
  // `archived` is derived there, never a flag this client sets). Live ones get
  // the prominent Events section; the rest fall to the collapsed archive line.
  const liveEventChats = useMemo(() => eventChats.filter((e) => !e.archived), [eventChats]);
  const archivedEventChats = useMemo(() => eventChats.filter((e) => e.archived), [eventChats]);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<{ name: string; lead: boolean }[]>([]);
  // Meeting scheduling lives in the ⋯ menu (rare-but-important action, kept out
  // of the way): the open room's scope + whether the viewer can organize, and
  // the composer toggle. The active-meeting RESPONSE bar is separate (in the
  // chat body via MeetingSection); creating a meeting here surfaces there live.
  const [meetingScope, setMeetingScope] = useState<MeetingScope | null>(null);
  const [meetingLabel, setMeetingLabel] = useState("");
  const [canOrganizeMeeting, setCanOrganizeMeeting] = useState(false);
  const [composeMeeting, setComposeMeeting] = useState(false);
  // "Email members" lives in the same ⋯ menu, open to anyone viewing the
  // room (no organizer gate — everyone here can already see everyone here).
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [composeEmail, setComposeEmail] = useState(false);
  // "Create a poll" joins them in the ⋯ menu, for the same reason meetings are
  // there: it's a rare-but-important action, so it stays out of the composer,
  // which keeps ONE clean "+" (attach) button next to the text field. Open to
  // any room member (the family-polls doctrine). The poll itself renders inline
  // in the message timeline — created here, it shows up there on the next
  // realtime tick, so there's no cross-component wiring, same as meetings.
  const [composePoll, setComposePoll] = useState(false);
  // The poll scope is exactly the room scope already resolved for meetings,
  // minus the "family" case ChatPollScope doesn't have (and openMembers /
  // openHouseMembers never set).
  const pollScope: ChatPollScope | null =
    meetingScope && meetingScope.type !== "family" ? meetingScope : null;
  // Semantic search across every conversation this member can see.
  const [searchOpen, setSearchOpen] = useState(false);
  // Mute-duration sheet — opened from the bell on either a committee channel
  // or the house row; null while closed.
  const [muteTarget, setMuteTarget] = useState<MuteTarget | null>(null);

  // Jump from a search result into the right conversation. We set the URL
  // params the chat/feed views already understand (?c/&area/&m for committees,
  // ?house/&m for a house, ?post for the Family Feed) THEN switch the active
  // view — the room mounts fresh and its own `?m` effect scrolls to + flashes
  // the message, exactly like an Activity-tab deep-link.
  const openResult = (r: SearchResult) => {
    const url = new URL(window.location.href);
    const clear = (...keys: string[]) => keys.forEach((k) => url.searchParams.delete(k));
    setSearchOpen(false);
    if (r.source_type === "post" || r.source_type === "post_comment") {
      clear("c", "area", "house", "m");
      if (r.post_id) url.searchParams.set("post", r.post_id);
      else clear("post");
      window.history.replaceState(null, "", url.toString());
      setActive("posts");
      return;
    }
    if (r.source_type === "committee_message" && r.committee_id) {
      const ch = channels.find((c) => c.committeeId === r.committee_id && (c.area ?? "") === (r.area ?? ""));
      if (!ch) return;
      clear("post", "house");
      url.searchParams.set("c", ch.slug);
      if (ch.area) url.searchParams.set("area", ch.area);
      else clear("area");
      url.searchParams.set("m", r.source_id);
      window.history.replaceState(null, "", url.toString());
      setActive(ch.key);
      return;
    }
    if (r.source_type === "house_message" && houseChannel && r.house_id === houseChannel.houseId) {
      clear("post", "c", "area");
      url.searchParams.set("house", houseChannel.slug);
      url.searchParams.set("m", r.source_id);
      window.history.replaceState(null, "", url.toString());
      setActive(houseChannel.key);
    }
  };
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Opened from the House hub (/posts?house=slug): back should return to /house,
  // and we hold the feed/list render until loaded so we don't flash it on the way.
  const openedFromHouseRef = useRef(false);
  // Same idea for a committee page's chat tiles (/posts?c=slug[&area=]&from=
  // committee): Back should return to that committee, not dump you on the Chats
  // list. Those tiles link through the Feed because the standalone
  // /committees/<slug>/chat route fails outright in the installed PWA — see
  // ChatEntryButton's note — so this preserves the Back target that route's
  // own header "‹" used to give.
  //
  // ⚠️ Read via useUrlParam (an EFFECT), never a useState initializer that
  // touches window.location: this component is prerendered, so a render-time
  // read makes the first client render disagree with the served HTML and React
  // throws a hydration error (#418) — which is what silently killed every link
  // on the committee page in PR #493. It only feeds a Back label/target, so
  // resolving a tick late costs nothing.
  const fromCommittee = useUrlParam("from");
  const [bootHouseSlug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null
  );
  // Same idea for a committee/area deep-link (?c=slug&area=) — without this,
  // a cold mount briefly renders the plain Chats list (or Main Feed) before
  // the channels fetch resolves and `setActive` jumps to the right room,
  // which reads as an extra visible "hop" even when the deep link works.
  const [bootChannelKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    return c ? `${c}|${params.get("area") ?? ""}` : null;
  });
  // Same again for an event-chat deep link (?event=<id>) — the target of every
  // event-chat push and @mention notification (0216/0217). ⚠️ Notifications point
  // at the FEED, never a standalone chat route, since those fail outright in an
  // installed PWA (see CLAUDE.md).
  const [bootEventId] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("event") : null
  );
  const [loaded, setLoaded] = useState(false);

  // A ?post=<id> deep-link (Activity notification for a Main Feed post, an
  // On-This-Day card, etc.) — or a bare ?feed=main, which opens the Main Feed
  // with no particular post in mind (the fest wrap card's "Add your photos",
  // which otherwise stranded people on the Chats list) —
  // needs NONE of the house/committee data the load
  // effect below fetches — PostsView mounts and loads its own feed
  // independently. So flip straight to "posts" in a LAYOUT effect (runs
  // synchronously after the initial hydration render but before the browser
  // paints), instead of waiting for the async loadHouse()/loadChannels() to
  // resolve like the mount effect below does. Without this, a member who IS
  // in a house/committee (so the "no channels → straight to Family Feed"
  // render branch below doesn't apply either) would see the plain Chats list
  // for a beat before the deep link "hopped" them to the post — hydration-safe
  // because the very first render still matches the SSR'd "list" HTML.
  useIsoLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("post") || params.get("feed") === "main") setActive("posts");
  }, []);
  // Holds the latest computeSummaries so the "returning to list" effect below
  // (which lives outside the load effect's closure) can trigger a refresh.
  const computeSummariesRef = useRef<() => Promise<void>>(async () => {});
  // Latest archived channel list, so the load effect's closing snapshot write
  // (outside loadChannels' scope) keeps it instead of dropping it.
  const archivedRef = useRef<Channel[]>(cached?.archivedChannels ?? []);

  // Messages-style push/pop for the full-screen room containers: the room
  // slides in from the right on open (chat-push, plays on mount) and Back
  // holds the room mounted just long enough to slide it back out (chat-pop)
  // before navigating — the same state-timed close idiom as useSheetDismiss.
  const [chatClosing, setChatClosing] = useState(false);
  const chatAnim = chatClosing ? "chat-pop" : "chat-push";
  const closeChat = (after: () => void) => {
    const reduce =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    if (reduce || chatClosing) {
      after();
      return;
    }
    setChatClosing(true);
    setTimeout(() => {
      setChatClosing(false);
      after();
    }, 240); // matches the chat-pop duration in globals.css
  };

  // Persisted-snapshot seed + house deep-link fast path (post-mount, so it's
  // hydration-safe). On a cold app open the module cache is empty; restore the
  // last known channel list from storage so the Chats list paints instantly —
  // and if we were opened from the House hub (?house=slug) and the snapshot
  // already has that house, drop straight into the house chat one tick after
  // mount instead of waiting for the full channels fetch. The load effect
  // below still revalidates everything behind it.
  useEffect(() => {
    if (!user || !userId) return;
    let snap = feedCache.get(cacheKey) ?? null;
    if (!snap && !previewAsId) {
      snap = readPersisted<FeedSnapshot>(`feed.${userId}`);
      if (snap) {
        feedCache.set(cacheKey, snap);
        setChannels(snap.channels);
        setArchivedChannels(snap.archivedChannels ?? []);
        setEventChats(snap.eventChats ?? []);
        setHouseChannel(snap.houseChannel);
        setSummaries(snap.summaries);
      }
    }
    if (
      bootHouseSlug &&
      !openedFromHouseRef.current &&
      snap?.houseChannel &&
      snap.houseChannel.slug === bootHouseSlug
    ) {
      openedFromHouseRef.current = true;
      setActive(snap.houseChannel.key);
    }
    // Same fast path for a COMMITTEE/area deep-link (?c=slug[&area=]) — this
    // was house-only, which is why the committee page's chat tiles still
    // "redirected to Chats": the snapshot restores the channel list (so the
    // `!loaded` gate below stops hiding anything) but nothing had opened the
    // room yet, so the Chats list painted until the async channels fetch
    // finally resolved and setActive jumped into it. Matching the house branch
    // closes that window on every warm open.
    if (bootChannelKey && snap?.channels?.some((c) => c.key === bootChannelKey)) {
      setActive(bootChannelKey);
    }
    // Same fast path for an event chat, off the cached snapshot.
    if (bootEventId && snap?.eventChats?.some((e) => e.eventId === bootEventId)) {
      setActive(eventKey(bootEventId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, previewAsId]);

  // Cold open of an event-chat deep link (?event=<id>) — a push or @mention
  // tap on a device with no cached Feed snapshot. The snapshot fast path above
  // can't fire (there's no snapshot), so open it as soon as the list lands.
  // Guarded on `active === "list"` so it never yanks someone out of a room they
  // navigated to themselves, and it only ever fires for a room actually in
  // their list — a stale link just leaves them on the list.
  useEffect(() => {
    if (!bootEventId || active !== "list") return;
    if (eventChats.some((e) => e.eventId === bootEventId)) setActive(eventKey(bootEventId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootEventId, eventChats]);

  // Load my channels (Main Feed is implicit) + their previews.
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) {
      // No signed-in user: flip loaded so a guest deep-linking
      // /posts?house=<slug> doesn't hang on the loading gate below forever —
      // but ONLY once auth has actually settled. Before authReady, `user` may
      // just not have resolved yet; flipping early would defeat the gate and
      // flash the wrong view at a signed-in member.
      if (!isSupabaseConfigured || !sb || authReady) setLoaded(true);
      return;
    }
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    let me: string | null = null;
    let mine: Channel[] = [];
    let houseCh: HouseChannel | null = null;
    let computingSummaries = false;

    // Write-through: memory for tab switches, storage for the next cold open.
    // Previews are memory-only (an admin's view-as must never persist).
    const saveSnap = (snap: FeedSnapshot) => {
      feedCache.set(cacheKey, snap);
      if (!previewAsId && userId) writePersisted(`feed.${userId}`, snap);
    };

    const computeSummaries = async () => {
      if (!me || computingSummaries) return;
      computingSummaries = true;
      try {
        const meId = me;
        const next: Record<string, Summary> = {};
        await Promise.all(
          mine.map(async (ch) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const areaEq = (q: any) => (ch.area ? q.eq("area", ch.area) : q.is("area", null));
            const [lastRes, readRes] = await Promise.all([
              areaEq(
                sb
                  .from("committee_messages")
                  .select("text, created_at, profiles!author_id(display_name), committee_message_media(media_type)")
                  .eq("committee_id", ch.committeeId)
                  .is("deleted_at", null),
              ).order("created_at", { ascending: false }).limit(1).maybeSingle(),
              sb.from("committee_area_reads").select("last_read_at, muted, muted_until").eq("committee_id", ch.committeeId).eq("user_id", meId).eq("area", ch.area ?? "").maybeSingle(),
            ]);
            const lastRow = lastRes.data as {
              text: string | null;
              created_at: string;
              profiles: { display_name: string | null } | null;
              committee_message_media: { media_type: string }[] | null;
            } | null;
            const read = readRes.data as { last_read_at: string | null; muted: boolean | null; muted_until: string | null } | null;
            let unreadQ = areaEq(
              sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", ch.committeeId).neq("author_id", meId).is("deleted_at", null),
            );
            if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
            const { count } = await unreadQ;
            const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
            const body = lastRow?.text || (lastRow?.committee_message_media?.length ? mediaPreviewLabel(lastRow.committee_message_media[0].media_type) : "");
            const timedActive = Boolean(read?.muted_until && new Date(read.muted_until).getTime() > Date.now());
            next[ch.key] = {
              last: lastRow ? who + body : undefined,
              at: lastRow?.created_at,
              unread: count ?? 0,
              muted: (read?.muted ?? false) || timedActive,
              mutedUntil: timedActive ? read!.muted_until : null,
            };
          }),
        );
        // House channel summary (its own tables; timed/permanent mute on house_reads, 0155).
        if (houseCh) {
          const hid = houseCh.houseId;
          const [lastRes, readRes] = await Promise.all([
            sb
              .from("house_messages")
              .select("text, created_at, profiles!author_id(display_name), house_message_media(media_type)")
              .eq("house_id", hid)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            sb.from("house_reads").select("last_read_at, muted, muted_until").eq("house_id", hid).eq("user_id", meId).maybeSingle(),
          ]);
          const lastRow = lastRes.data as {
            text: string | null;
            created_at: string;
            profiles: { display_name: string | null } | null;
            house_message_media: { media_type: string }[] | null;
          } | null;
          const read = readRes.data as { last_read_at: string | null; muted: boolean | null; muted_until: string | null } | null;
          let unreadQ = sb.from("house_messages").select("id", { count: "exact", head: true }).eq("house_id", hid).neq("author_id", meId).is("deleted_at", null);
          if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
          const { count } = await unreadQ;
          const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
          const body = lastRow?.text || (lastRow?.house_message_media?.length ? mediaPreviewLabel(lastRow.house_message_media[0].media_type) : "");
          const timedActive = Boolean(read?.muted_until && new Date(read.muted_until).getTime() > Date.now());
          next[houseCh.key] = {
            last: lastRow ? who + body : undefined,
            at: lastRow?.created_at,
            unread: count ?? 0,
            muted: (read?.muted ?? false) || timedActive,
            mutedUntil: timedActive ? read!.muted_until : null,
          };
        }
        // Family Feed mute (migration 0214). The feed has no unread count or
        // last-message preview in this list, so this is mute state ONLY — the
        // row still shows its "Everyone" subtitle. A missing table pre-migration
        // comes back as an error with null data, which reads as "not muted", so
        // no explicit guard is needed.
        {
          const feedRes = await sb
            .from("feed_mutes")
            .select("muted, muted_until")
            .eq("user_id", meId)
            .maybeSingle();
          const fm = feedRes.data as { muted: boolean | null; muted_until: string | null } | null;
          const timedActive = Boolean(fm?.muted_until && new Date(fm.muted_until).getTime() > Date.now());
          next[FEED_KEY] = {
            unread: 0,
            muted: (fm?.muted ?? false) || timedActive,
            mutedUntil: timedActive ? fm!.muted_until : null,
          };
        }
        // Event chats (migration 0216) — one RPC returns every room the viewer
        // is in, with previews, unread and mute state already resolved by the
        // same predicate the RLS policies use.
        //
        // ⚠️ In "View as" this switches to the preview RPC, which returns the
        // rooms WITHOUT any last-message text: an admin may confirm a member has
        // the right chats, never read them. The bell/unread still render, since
        // those describe that member's UI rather than what anyone said.
        const evs = previewAsId
          ? await fetchEventChatsForPreview(previewAsId)
          : await fetchMyEventChats();
        for (const e of evs) {
          next[eventKey(e.eventId)] = {
            last: e.last,
            at: e.lastAt,
            unread: e.unread,
            muted: e.muted,
            mutedUntil: e.mutedUntil,
          };
        }
        if (!cancelled) setEventChats(evs);

        // Keep the cached snapshot's summaries current so a returning tab paints
        // the latest previews (only if a structural entry already exists — the
        // channels/houseChannel structural write below is what creates it).
        const prevSnap = feedCache.get(cacheKey);
        if (prevSnap) saveSnap({ ...prevSnap, summaries: next, eventChats: evs });
        if (!cancelled) setSummaries(next);
      } finally {
        computingSummaries = false;
      }
    };
    computeSummariesRef.current = computeSummaries;

    const loadHouse = async (): Promise<HouseChannel | null> => {
      if (!me) return null;
      const { data } = await sb.from("profiles").select("house_id, houses:house_id(id, slug, name, emoji)").eq("id", me).maybeSingle();
      const h = (data as { houses: { id: string; slug: string; name: string; emoji: string } | null } | null)?.houses ?? null;
      houseCh = h ? { key: `house|${h.slug}`, houseId: h.id, slug: h.slug, name: h.name, emoji: h.emoji || "🏠" } : null;
      if (!cancelled) setHouseChannel(houseCh);
      return houseCh;
    };

    const loadChannels = async () => {
      if (!me) return;
      const meId = me;
      // is_lead (committee-level lead, migration 0177) with a graceful fallback
      // so the Feed still builds channels on a pre-0177 DB.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rosRes: any = await sb.from("committee_roster").select("committee_slug, roles, is_lead").eq("linked_user_id", meId);
      if (rosRes.error && (rosRes.error.code === "42703" || /column .* does not exist/i.test(rosRes.error.message ?? ""))) {
        rosRes = await sb.from("committee_roster").select("committee_slug, roles").eq("linked_user_id", meId);
      }
      const rosterRows = (rosRes.data ?? []) as { committee_slug: string; roles: string[] | null; is_lead?: boolean | null }[];
      const slugs = Array.from(new Set(rosterRows.map((r) => r.committee_slug)));
      const built: Channel[] = [];
      const archived: Channel[] = [];
      if (slugs.length) {
        // Committees, with their archived state (migration 0112). Retry without
        // archived_at pre-migration so a pre-0112 DB still lists live channels.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cRes: any = await sb.from("committees").select("id, slug, name, emoji, archived_at").in("slug", slugs).order("position", { ascending: true });
        if (cRes.error) cRes = await sb.from("committees").select("id, slug, name, emoji").in("slug", slugs).order("position", { ascending: true });
        const committees = (cRes.data ?? []) as { id: string; slug: string; name: string; emoji: string; archived_at?: string | null }[];

        // Which roles are archived, per committee slug (same graceful fallback).
        const archivedAreas = new Map<string, Set<string>>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let aRes: any = await sb.from("committee_areas").select("committee_slug, area, archived_at").in("committee_slug", slugs);
        if (aRes.error) aRes = await sb.from("committee_areas").select("committee_slug, area").in("committee_slug", slugs);
        for (const r of (aRes.data ?? []) as { committee_slug: string; area: string; archived_at?: string | null }[]) {
          if (!r.archived_at) continue;
          if (!archivedAreas.has(r.committee_slug)) archivedAreas.set(r.committee_slug, new Set());
          archivedAreas.get(r.committee_slug)!.add(r.area);
        }

        for (const c of committees) {
          const committeeArchived = Boolean(c.archived_at);
          const areaArchived = archivedAreas.get(c.slug) ?? new Set<string>();
          const myRows = rosterRows.filter((r) => r.committee_slug === c.slug);
          const myRolesRaw = myRows.flatMap((r) => r.roles ?? []);
          // A lead here = committee-level (is_lead) OR area lead ("· Lead" role),
          // so a committee with no subcommittees can still open its Leads room.
          const iAmLead = myRows.some((r) => r.is_lead) || myRolesRaw.some((r) => r.endsWith(" · Lead"));
          const myAreas = Array.from(new Set(myRolesRaw.map(stripLead).filter(Boolean)));
          // "Helping crew" = the committee-wide channel (area IS NULL) — the old
          // "General", renamed. Title is just the committee name (the section
          // header says which crew), disambiguating multiple committees' rows.
          const general: Channel = { key: `${c.slug}|`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: null, kind: "general", title: c.name, subtitle: "Full helping crew" };
          (committeeArchived ? archived : built).push(general);
          // A private Leads room, only for people who lead something here (and
          // only when there's no real role literally named "Leads" to collide
          // with — mirrors the SQL guard in can_access_committee_area, 0172).
          if (iAmLead && !committeeArchived && !myAreas.includes(LEADS_AREA)) {
            built.push({ key: `${c.slug}|${LEADS_AREA}`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: LEADS_AREA, kind: "leads", title: c.name, subtitle: "Leads" });
          }
          for (const a of myAreas) {
            const ch: Channel = { key: `${c.slug}|${a}`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: a, kind: "area", title: a, subtitle: c.name };
            // A role goes to Archived if its committee is archived OR that role
            // itself was archived (deleted out from under a still-live committee).
            (committeeArchived || areaArchived.has(a) ? archived : built).push(ch);
          }
        }
      }
      if (cancelled) return;
      mine = built;
      setChannels(built);
      setArchivedChannels(archived);
      archivedRef.current = archived;
      // Structural write: keep the cache's channels/houseChannel current. Also
      // runs on realtime roster/profile changes (this fn re-runs), so a removed
      // committee/house is reflected in the cache and can't stick on revisit.
      const prevSnap = feedCache.get(cacheKey);
      saveSnap({ channels: built, houseChannel: houseCh, summaries: prevSnap?.summaries ?? {}, archivedChannels: archived });
      const hasAny = built.length > 0 || houseCh !== null;
      setActive((prev) =>
        !hasAny
          ? "posts"
          : prev === "posts" || prev === "list" || prev === houseCh?.key || built.some((c) => c.key === prev)
            ? prev
            : "list",
      );
      await computeSummaries();
    };

    (async () => {
      me = previewAsId ?? userId; // context uid — no auth round-trip
      if (cancelled || !me) return;
      const hc = await loadHouse();
      await loadChannels();
      if (cancelled) return;
      // Deep-links: ?post=<id> (a Family Feed post — Activity notifications
      // and the On-This-Day Home card land here; PostsView scrolls to + flashes
      // it), ?c=slug&area= (committee), or ?house=slug (house).
      const params = new URLSearchParams(window.location.search);
      const wantSlug = params.get("c");
      const wantArea = params.get("area") ?? "";
      const wantHouse = params.get("house");
      if (params.get("post") || params.get("feed") === "main") {
        setActive("posts");
      } else if (wantSlug) {
        const key = `${wantSlug}|${wantArea}`;
        // Fall back to the archived list too — a deep-linked committee/role
        // may have been archived (0112) since the notification was sent;
        // it's still reachable read-only, so don't silently strand the user
        // on the plain Chats list with no explanation.
        if (mine.some((c) => c.key === key) || archivedRef.current.some((c) => c.key === key)) setActive(key);
      } else if (wantHouse && hc && hc.slug === wantHouse) {
        openedFromHouseRef.current = true;
        setActive(hc.key);
      }
      // Snapshot the resolved structure so the next remount paints the list
      // instantly instead of flashing the Main Feed guard.
      saveSnap({ channels: mine, houseChannel: houseCh, summaries: feedCache.get(cacheKey)?.summaries ?? {}, archivedChannels: archivedRef.current });
      if (!cancelled) setLoaded(true);
      channel = sb
        .channel("feed-conversations")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" }, () => computeSummaries())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "house_messages" }, () => computeSummaries())
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_roster" }, () => loadChannels())
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${me}` }, () => { void loadHouse().then(loadChannels); })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, previewAsId, authReady]);

  // Re-resolve a ?post=/?c=&area=/?house= deep-link whenever the URL changes,
  // not just at mount. The load effect above only reads window.location.search
  // once (inside its startup IIFE) — a SECOND Activity-tab notification tapped
  // while already on this route doesn't remount FeedView (same page, same
  // component), so without this, the second tap silently does nothing and
  // just leaves you wherever the first deep-link (or the plain list) landed.
  const urlPost = useUrlParam("post");
  const urlC = useUrlParam("c");
  const urlArea = useUrlParam("area");
  const urlHouse = useUrlParam("house");
  const urlFeed = useUrlParam("feed");
  const wantsMainFeed = urlFeed === "main";
  const lastUrlSigRef = useRef<string>("");
  useEffect(() => {
    if (!loaded) return;
    const sig = `${urlPost ?? ""}|${urlC ?? ""}|${urlArea ?? ""}|${urlHouse ?? ""}|${urlFeed ?? ""}`;
    if (!urlPost && !urlC && !urlHouse && !wantsMainFeed) return;
    if (lastUrlSigRef.current === sig) return;
    lastUrlSigRef.current = sig;
    if (urlPost || wantsMainFeed) {
      setActive("posts");
    } else if (urlC) {
      const key = `${urlC}|${urlArea ?? ""}`;
      if (channels.some((c) => c.key === key) || archivedChannels.some((c) => c.key === key)) setActive(key);
    } else if (urlHouse && houseChannel && houseChannel.slug === urlHouse) {
      openedFromHouseRef.current = true;
      setActive(houseChannel.key);
    }
  }, [urlPost, urlC, urlArea, urlHouse, urlFeed, wantsMainFeed, loaded, channels, archivedChannels, houseChannel]);

  // Recompute summaries when returning to the list: otherwise a room's unread
  // badge only clears on the next message INSERT, so it stays lit after you've
  // read it and come back. computeSummaries() itself doesn't overlap (guarded
  // by computingSummaries above); this just skips the redundant fetch on mount.
  const prevActiveRef = useRef(active);
  useEffect(() => {
    if (active === "list" && prevActiveRef.current !== "list") void computeSummariesRef.current();
    prevActiveRef.current = active;
  }, [active]);

  // Pin the active chat to the visual viewport so the iOS keyboard can't shove
  // the page around (same technique as the old overlay). Runs as a LAYOUT effect
  // so the first `apply()` sets the real (visualViewport-based) height before the
  // browser paints — otherwise mobile paints the inline calc(100dvh - 64px)
  // first, then resizes to the smaller visible height a frame later, which reads
  // as an awkward flicker when opening a chat (desktop's dvh == visible height,
  // so it never showed there).
  useIsoLayoutEffect(() => {
    if (active === "list" || active === "posts") return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = chatBoxRef.current;
    // withTransform=false on the FIRST (pre-paint) call: the chat-push slide-in
    // owns `transform` via its keyframes, so setting an inline translateY before
    // paint makes the panel flash in-place for a frame before the animation yanks
    // it off-screen to slide in — a flicker that showed on desktop too. We set
    // the HEIGHT before paint (the mobile dvh→visible reconciliation) but leave
    // transform to the animation. The keyboard/resize handlers (post-paint, where
    // any inline transform is harmless — overridden mid-animation, correct after)
    // still set it so the room follows the on-screen keyboard.
    const apply = (withTransform: boolean) => {
      if (!el) return;
      const innerH = window.innerHeight;
      const visH = vv ? vv.height : innerH;
      const keyboardOpen = innerH - visH > 120;
      const tabBar = document.querySelector("nav.fixed") as HTMLElement | null;
      const tabH = keyboardOpen ? 0 : tabBar?.getBoundingClientRect().height ?? 64;
      el.style.height = `${visH - tabH}px`;
      if (withTransform) el.style.transform = `translateY(${vv ? vv.offsetTop : 0}px)`;
    };
    apply(false);
    const onEvt = () => apply(true);
    const t = setTimeout(onEvt, 60);
    window.addEventListener("resize", onEvt);
    vv?.addEventListener("resize", onEvt);
    vv?.addEventListener("scroll", onEvt);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onEvt);
      vv?.removeEventListener("resize", onEvt);
      vv?.removeEventListener("scroll", onEvt);
    };
  }, [active]);

  // Load "who's in this chat" — for a role channel, roster members who hold that
  // area; for General, everyone on the committee roster.
  const openMembers = async (ch: Channel) => {
    const sb = supabase;
    if (!sb) return;
    // is_lead (0177) with a graceful fallback so the members sheet still loads pre-migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mRes: any = await sb.from("committee_roster").select("name, roles, is_lead, profiles:linked_user_id(display_name)").eq("committee_slug", ch.slug);
    if (mRes.error && (mRes.error.code === "42703" || /column .* does not exist/i.test(mRes.error.message ?? ""))) {
      mRes = await sb.from("committee_roster").select("name, roles, profiles:linked_user_id(display_name)").eq("committee_slug", ch.slug);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (mRes.data ?? []) as any[];
    const isLeadRow = (r: { roles?: string[] | null; is_lead?: boolean | null }) =>
      !!r.is_lead || ((r.roles ?? []) as string[]).some((role) => role.endsWith(" · Lead"));
    const inArea =
      ch.area === LEADS_AREA
        ? // The Leads room: every lead of the committee (committee-level OR area).
          rows.filter(isLeadRow)
        : ch.area
          ? rows.filter((r) => ((r.roles ?? []) as string[]).some((role) => role === ch.area || role === `${ch.area} · Lead`))
          : rows;
    setMembers(
      inArea
        .map((r) => {
          const p = r.profiles;
          const displayName = (Array.isArray(p) ? p[0]?.display_name : p?.display_name) as string | undefined;
          return { name: displayName || r.name, lead: isLeadRow(r) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    // Wire up "Schedule a meeting" for this room's ⋯ menu (organizers only —
    // admin, or a Lead of this committee/area; asked server-side).
    const scope: MeetingScope = { type: "committee", committeeId: ch.committeeId, slug: ch.slug, area: ch.area };
    setMeetingScope(scope);
    setMeetingLabel(ch.area ?? ch.name);
    setCanOrganizeMeeting(false);
    void fetchCanOrganize(scope).then(setCanOrganizeMeeting);
    setEmailTarget({ type: "committee", committeeId: ch.committeeId, area: ch.area, label: ch.title });
    setShowMembers(true);
  };

  // Same "who's in this chat" + Schedule-a-meeting menu for a house (houses are
  // admin-only for meetings; can_organize_meeting enforces it server-side).
  const openHouseMembers = async (hc: HouseChannel) => {
    const sb = supabase;
    if (!sb) return;
    const { data } = await sb.from("profiles").select("display_name").eq("house_id", hc.houseId);
    const rows = (data ?? []) as { display_name: string | null }[];
    setMembers(
      rows
        .map((r) => ({ name: r.display_name || "Member", lead: false }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    const scope: MeetingScope = { type: "house", houseId: hc.houseId, slug: hc.slug };
    setMeetingScope(scope);
    setMeetingLabel(hc.name);
    setCanOrganizeMeeting(false);
    void fetchCanOrganize(scope).then(setCanOrganizeMeeting);
    setEmailTarget({ type: "house", houseId: hc.houseId, label: hc.name });
    setShowMembers(true);
  };

  // Tapping the bell: already muted → one-tap unmute. Not muted → open the
  // duration sheet (1/3/7 days or "until I turn it back on").
  const bellTapped = (key: string, target: MuteTarget) => {
    if (summaries[key]?.muted) {
      void applyMute(key, target, false, null);
    } else {
      setMuteTarget(target);
    }
  };

  const applyMute = async (key: string, target: MuteTarget, muted: boolean, hours: number | null) => {
    const sb = supabase;
    if (!sb) return;
    const mutedUntil = muted && hours != null ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
    setSummaries((s) => ({ ...s, [key]: { ...(s[key] ?? { unread: 0, muted: false }), muted, mutedUntil } }));
    if (target.kind === "event") {
      await setEventChatMute(target.eventId, muted, hours);
    } else if (target.kind === "feed") {
      await sb.rpc("set_feed_mute", { p_muted: muted, p_muted_until: mutedUntil });
    } else if (target.kind === "house") {
      await sb.rpc("set_house_mute", { hid: target.houseId, p_muted: muted, p_muted_until: mutedUntil });
    } else {
      await sb.rpc("set_area_mute", { cid: target.committeeId, p_area: target.area, p_muted: muted, p_muted_until: mutedUntil });
    }
  };

  // One committee-chat section (Lead chats / Helping crew / Roles & subcommittees).
  // Renders nothing when its slice is empty, so a member with e.g. no lead role
  // never sees an empty "Lead chats" header.
  const renderChannelSection = (label: string, list: Channel[]) =>
    list.length > 0 ? (
      <ChatSection label={label}>
        {list.map((ch, i) => (
          <div key={ch.key}>
            {i > 0 && <div className="ml-[68px] border-t border-border" aria-hidden />}
            <ConversationRow
              emoji={ch.emoji}
              title={ch.title}
              subtitle={ch.subtitle}
              summary={summaries[ch.key]}
              onOpen={() => setActive(ch.key)}
              onToggleMute={() => bellTapped(ch.key, { kind: "committee", committeeId: ch.committeeId, area: ch.area })}
            />
          </div>
        ))}
      </ChatSection>
    ) : null;

  // Opened via a house deep-link (from the House hub): wait for load so we drop
  // straight into the house chat instead of flashing the feed/list on the way in.
  // Exception: the snapshot fast path above may have already opened the house
  // chat — then there's nothing to hide, so skip the gate and render it now.
  const fastPathOpen =
    (houseChannel !== null && active === houseChannel.key) ||
    (!!bootChannelKey && active === bootChannelKey) ||
    (!!bootEventId && active === eventKey(bootEventId));
  // Hold until the deep-linked room is actually OPEN, not merely until `loaded`.
  // `loaded` only means the channel fetch finished — `setActive` happens in the
  // same tick for a reachable room, but if the room ISN'T in the list (archived,
  // access revoked, a stale link) `active` stays "list", and gating on `active`
  // alone would spin forever. So: while a deep-link is pending, hide until
  // either it opens (fastPathOpen) or the fetch is done and we know it won't.
  if ((bootHouseSlug || bootChannelKey || bootEventId) && !loaded && !fastPathOpen) {
    return (
      <div className="flex h-[50dvh] items-center justify-center text-sm text-foreground/40">Loading…</div>
    );
  }

  // No house and no committees → straight to the Family Feed, no list. (But if
  // you have archived chats to browse, keep the list so they stay reachable.)
  //
  // ⚠️ Event chats count here too (0216). Plenty of family are in no committee
  // and no house but DO go to the work weekends — dropping them into the bare
  // Family Feed would hide their Events section, and with it the only chat they
  // have, plus the Family Feed's own mute bell.
  if (
    channels.length === 0 &&
    !houseChannel &&
    archivedChannels.length === 0 &&
    eventChats.length === 0
  ) {
    return (
      <div className="space-y-3 pt-1">
        <PostsView seed={POSTS} showHeading />
      </div>
    );
  }

  // The house chat opened from the list.
  if (houseChannel && active === houseChannel.key) {
    return (
      <>
        <div ref={chatBoxRef} className={`${chatAnim} fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background`} style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
          <div key={active} aria-hidden className="chat-unmask pointer-events-none absolute inset-0 z-20 bg-background" />
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <BackButton
              label={openedFromHouseRef.current ? "House" : "Feed"}
              onClick={() => closeChat(() => { if (openedFromHouseRef.current) router.push("/house"); else setActive("list"); })}
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-bold">{houseChannel.emoji} {houseChannel.name}</p>
            </div>
            <button type="button" onClick={() => openHouseMembers(houseChannel)} aria-label="Members" className="press flex h-9 w-9 items-center justify-center rounded-full text-foreground/50">
              ⋯
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <HouseChat key={houseChannel.key} slug={houseChannel.slug} name={houseChannel.name} emoji={houseChannel.emoji} houseId={houseChannel.houseId} embedded knownMember />
          </div>
        </div>
        {showMembers && (
          <ChatMembersSheet
            title={houseChannel.name}
            members={members}
            canSchedule={canOrganizeMeeting}
            onSchedule={() => { setShowMembers(false); setComposeMeeting(true); }}
            onEmail={() => { setShowMembers(false); setComposeEmail(true); }}
            onPoll={() => { setShowMembers(false); setComposePoll(true); }}
            onClose={() => setShowMembers(false)}
          />
        )}
        {composeMeeting && meetingScope && (
          <MeetingComposer scope={meetingScope} roomLabel={meetingLabel} onClose={() => setComposeMeeting(false)} onCreated={() => {}} />
        )}
        {composeEmail && emailTarget && (
          <ChatEmailSheet target={emailTarget} onClose={() => setComposeEmail(false)} />
        )}
        {composePoll && pollScope && (
          <ChatPollComposer
            scope={pollScope}
            roomLabel={meetingLabel}
            onClose={() => setComposePoll(false)}
            onCreated={() => setComposePoll(false)}
          />
        )}
      </>
    );
  }

  // An open committee chat → the viewport-pinned conversation, with a back button.
  const activeChannel = channels.find((c) => c.key === active);
  if (activeChannel) {
    return (
      <>
        <div ref={chatBoxRef} className={`${chatAnim} fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background`} style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
          <div key={active} aria-hidden className="chat-unmask pointer-events-none absolute inset-0 z-20 bg-background" />
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <BackButton
              label={fromCommittee ? "Committee" : "Feed"}
              onClick={() =>
                closeChat(() => {
                  if (fromCommittee) router.push(`/committees/${fromCommittee}`);
                  else setActive("list");
                })
              }
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-bold">{activeChannel.emoji} {activeChannel.title}</p>
              {activeChannel.subtitle && <p className="truncate text-[11px] text-foreground/45">{activeChannel.subtitle}</p>}
            </div>
            <button type="button" onClick={() => openMembers(activeChannel)} aria-label="Members" className="press flex h-9 w-9 items-center justify-center rounded-full text-foreground/50">
              ⋯
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <CommitteeChat key={activeChannel.key} slug={activeChannel.slug} name={activeChannel.title} emoji={activeChannel.emoji} area={activeChannel.area} embedded knownMember />
          </div>
        </div>
        {/* Outside the chat container: its viewport-pinning effect sets a
            transform on that div, which would re-anchor the Sheet's
            `fixed inset-0` to the container instead of the viewport. */}
        {showMembers && (
          <ChatMembersSheet
            title={activeChannel.title}
            members={members}
            canSchedule={canOrganizeMeeting}
            onSchedule={() => { setShowMembers(false); setComposeMeeting(true); }}
            onEmail={() => { setShowMembers(false); setComposeEmail(true); }}
            onPoll={() => { setShowMembers(false); setComposePoll(true); }}
            onClose={() => setShowMembers(false)}
          />
        )}
        {composeMeeting && meetingScope && (
          <MeetingComposer scope={meetingScope} roomLabel={meetingLabel} onClose={() => setComposeMeeting(false)} onCreated={() => {}} />
        )}
        {composeEmail && emailTarget && (
          <ChatEmailSheet target={emailTarget} onClose={() => setComposeEmail(false)} />
        )}
        {composePoll && pollScope && (
          <ChatPollComposer
            scope={pollScope}
            roomLabel={meetingLabel}
            onClose={() => setComposePoll(false)}
            onCreated={() => setComposePoll(false)}
          />
        )}
      </>
    );
  }

  // An archived chat opened from the "Archived chats" section — read-only.
  const archivedActive = archivedChannels.find((c) => c.key === active);
  if (archivedActive) {
    return (
      <div ref={chatBoxRef} className={`${chatAnim} fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background`} style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
        <div key={active} aria-hidden className="chat-unmask pointer-events-none absolute inset-0 z-20 bg-background" />
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <BackButton label="Feed" onClick={() => closeChat(() => setActive("list"))} />
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-bold">🗄️ {archivedActive.title}</p>
            <p className="truncate text-[11px] text-foreground/45">{archivedActive.subtitle ?? archivedActive.name} · archived</p>
          </div>
          <span className="h-9 w-9" aria-hidden />
        </div>
        <div className="min-h-0 flex-1">
          <CommitteeChat key={archivedActive.key} slug={archivedActive.slug} name={archivedActive.title} emoji={archivedActive.emoji} area={archivedActive.area} embedded knownMember readOnly />
        </div>
      </div>
    );
  }

  // An event chat opened from the list (migration 0216).
  const activeEvent = eventChats.find((e) => eventKey(e.eventId) === active);
  if (activeEvent) {
    return (
      <div className="space-y-3 pt-1">
        <EventChat
          key={activeEvent.eventId}
          eventId={activeEvent.eventId}
          title={activeEvent.title}
          emoji={activeEvent.emoji}
          archived={activeEvent.archived}
          canPost={activeEvent.canPost}
          when={eventWhen(activeEvent)}
          onBack={() => setActive("list")}
        />
      </div>
    );
  }

  // Family Feed opened from the list.
  if (active === "posts") {
    return (
      <div className="space-y-3 pt-1">
        <BackButton label="Feed" onClick={() => setActive("list")} />
        <PostsView seed={POSTS} showHeading={false} />
      </div>
    );
  }

  // The conversation list — a Messages-style, grouped layout mirroring the iOS
  // app: Family Feed pinned on top, then a "Your house" section, then a "Committee
  // chats" section. Each section is one rounded card with inset dividers between
  // its rows (not a stack of separate cards), so the list reads clean.
  return (
    <div className="space-y-5 pt-1">
      <h1 className="px-1 text-lg font-bold">Feed</h1>

      {/* Family Feed — pinned on top, its own card. Carries the same bell as
          every chat below it (migration 0214): muting it stops new posts buzzing
          your phone, while they still land in the Activity tab. Its summary is
          mute-state-only, so the row shows "Everyone" and no unread badge. */}
      <ChatCard>
        <ConversationRow
          emoji="📰"
          title="Family Feed"
          subtitle="Everyone"
          summary={summaries[FEED_KEY]}
          onOpen={() => setActive("posts")}
          onToggleMute={() => bellTapped(FEED_KEY, { kind: "feed" })}
        />
      </ChatCard>

      {/* Events (migration 0216) — right under the Family Feed, per Brian.
          Deliberately given a DIFFERENT border to the other cards: the whole
          point is to nudge people to talk about an event here, among the people
          going, instead of putting logistics in front of everyone on the feed. */}
      {liveEventChats.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Events</p>
          <div className="overflow-hidden rounded-2xl bg-card ring-2 ring-accent/45">
            {liveEventChats.map((e, i) => (
              <div key={e.eventId}>
                {i > 0 && <div className="ml-[68px] border-t border-border" aria-hidden />}
                <ConversationRow
                  emoji={e.emoji || "📅"}
                  title={e.title}
                  subtitle={eventWhen(e)}
                  summary={summaries[eventKey(e.eventId)]}
                  onOpen={() => setActive(eventKey(e.eventId))}
                  onToggleMute={() => bellTapped(eventKey(e.eventId), { kind: "event", eventId: e.eventId })}
                />
              </div>
            ))}
          </div>
          {/* ⚠️ This line states the FULL rule (Going or Maybe), unlike the
              prompt inside a room you can't post in yet, which deliberately
              asks for Going only — per Brian, no reason to advertise the Maybe
              route at the point of asking someone to commit. Labels match
              AttendanceControl's exactly: Going / Maybe / Can't make. */}
          {/* ⚠️ Every text run is an explicit {"…"} STRING EXPRESSION, not JSX
              text. Interleaving bold spans with bare prose here silently ate the
              space after each </span> and rendered "Maybeand you’re in the
              chat" — the same class of bug as the "MJT Housegoing to a resort
              event" footnote (see the House-calendar warning above). JSX trims
              whitespace around text nodes; a string expression it cannot touch.
              Don’t "tidy" these back into plain JSX text. */}
          <p className="px-1 text-[11px] text-faint">
            {"RSVP "}
            <span className="font-semibold">Going</span>
            {" or "}
            <span className="font-semibold">Maybe</span>
            {" and you’re in the chat — you can read everything said before you joined. Switch to "}
            <span className="font-semibold">Can’t make</span>
            {" and you’re removed."}
          </p>
        </div>
      )}

      {houseChannel && (
        <ChatSection label="Your house">
          <ConversationRow
            emoji={houseChannel.emoji}
            title={houseChannel.name}
            subtitle="Your house"
            summary={summaries[houseChannel.key]}
            onOpen={() => setActive(houseChannel.key)}
            onToggleMute={() => bellTapped(houseChannel.key, { kind: "house", houseId: houseChannel.houseId })}
          />
        </ChatSection>
      )}

      {renderChannelSection("Lead chats", channels.filter((c) => c.kind === "leads"))}
      {renderChannelSection("Full helping crew", channels.filter((c) => c.kind === "general"))}
      {renderChannelSection("Roles & subcommittees", channels.filter((c) => c.kind === "area"))}

      {/* Search — at the foot of the conversation list. Semantic ("find it
          without the exact words") and scoped to your own RLS: it only ever
          surfaces messages you can already see. */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="press flex w-full items-center gap-2 rounded-xl bg-card px-4 py-3 text-sm text-muted"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search all conversations…
      </button>

      {/* Archived chats — a quiet, unobtrusive line at the very bottom. Opens a
          read-only view of a committee/role you were in that's since been
          "deleted" (archived, migration 0112). Kept out of the way; admins
          restore from Admin → Committees. */}
      {(archivedChannels.length > 0 || archivedEventChats.length > 0) && (
        <ArchivedChatsLine
          channels={archivedChannels}
          eventChats={archivedEventChats}
          onOpen={setActive}
        />
      )}

      {searchOpen && (
        <ConversationSearch
          channels={channels}
          houseChannel={houseChannel}
          onOpenResult={openResult}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {muteTarget && (
        <MuteDurationSheet
          onPick={(hours) => {
            const key =
              muteTarget.kind === "event"
                ? eventKey(muteTarget.eventId)
                : muteTarget.kind === "feed"
                ? FEED_KEY
                : muteTarget.kind === "house"
                  ? (houseChannel?.key ?? "")
                  : (channels.find((c) => c.committeeId === muteTarget.committeeId && (c.area ?? "") === (muteTarget.area ?? ""))?.key ?? "");
            if (key) void applyMute(key, muteTarget, true, hours);
            setMuteTarget(null);
          }}
          onClose={() => setMuteTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * Collapsible "Archived chats" disclosure at the foot of the Feed list —
 * collapsed by default so finished things stay out of the way. Carries BOTH
 * archived committee/role chats (0112) and event chats whose event ended more
 * than 7 days ago (0216); they're one list on purpose, since "old chats I can
 * still read" is a single idea to the reader.
 */
function ArchivedChatsLine({
  channels,
  eventChats,
  onOpen,
}: {
  channels: Channel[];
  eventChats: EventChatSummary[];
  onOpen: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = channels.length + eventChats.length;
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-foreground/40"
      >
        🗄️ Archived chats ({total})
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
      </button>
      {open && (
        <ChatCard>
          {channels.map((ch, i) => (
            <div key={ch.key}>
              {i > 0 && <div className="ml-[68px] border-t border-border" aria-hidden />}
              <ConversationRow
                emoji="🗄️"
                title={ch.title}
                subtitle={ch.subtitle ?? ch.name}
                summary={undefined}
                onOpen={() => onOpen(ch.key)}
              />
            </div>
          ))}
          {eventChats.map((e, i) => (
            <div key={e.eventId}>
              {(i > 0 || channels.length > 0) && <div className="ml-[68px] border-t border-border" aria-hidden />}
              <ConversationRow
                emoji="🗄️"
                title={e.title}
                subtitle={eventWhen(e)}
                summary={undefined}
                onOpen={() => onOpen(eventKey(e.eventId))}
              />
            </div>
          ))}
        </ChatCard>
      )}
    </div>
  );
}

/** "Sat, Aug 30" / "Aug 30 – Sep 1" — the row's subtitle, and what an event
 *  chat shows instead of a last-message preview in "View as". */
function eventWhen(e: Pick<EventChatSummary, "startDate" | "endDate">): string {
  if (!e.startDate) return "Event";
  const start = formatEventDay(e.startDate);
  // ⚠️ endDate is NULL on a single-day event — never compare or print it raw
  // (the trap called out for ResortEvent.endDate in CLAUDE.md).
  if (!e.endDate || e.endDate === e.startDate) return start;
  return `${start} – ${formatEventDay(e.endDate)}`;
}

/** ⚠️ Never hand a bare YYYY-MM-DD to `new Date()` — it parses as UTC midnight
 *  and renders as the PREVIOUS day in Central. That bug labelled every fest
 *  sign-up slot a day early (migration 0168). Split the parts by hand. */
function formatEventDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Button twin of BackLink (components/BackLink.tsx) — same markup + classes,
 * but with onClick semantics: these "back" actions swap in-page state
 * (setActive) or conditionally route, which BackLink (href-only, a Link) can't
 * express. If BackLink's styling changes, mirror it here.
 */
function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press -ml-1 inline-flex items-center gap-0.5 py-3 text-sm font-semibold text-primary"
    >
      <span aria-hidden className="text-lg leading-none">
        ‹
      </span>
      {label}
    </button>
  );
}

/**
 * "Who's in this chat" — the roster behind the ⋯ button on an open committee
 * chat, on the shared Sheet scaffolding (scrim + slide-up panel + ✕ + Escape
 * via useSheetDismiss), replacing the old hand-rolled bg-black/30 overlay.
 * Mounted per-open (useSheetDismiss is one-shot), like EventSheet.
 */
function ChatMembersSheet({
  title,
  members,
  canSchedule = false,
  onSchedule,
  onEmail,
  onPoll,
  onClose,
}: {
  title: string;
  members: { name: string; lead: boolean }[];
  /** Show the "Schedule a meeting" action (organizers only). */
  canSchedule?: boolean;
  onSchedule?: () => void;
  /** Show the "Email members" action — open to anyone viewing the room. */
  onEmail?: () => void;
  /** Show the "Create a poll" action — open to anyone viewing the room. */
  onPoll?: () => void;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="chat-members-title"
      header={
        <h2 id="chat-members-title" className="text-lg font-bold">
          {title} · {members.length} {members.length === 1 ? "person" : "people"}
        </h2>
      }
    >
      {canSchedule && onSchedule && (
        <button
          type="button"
          onClick={onSchedule}
          className="press mb-2 flex w-full items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          <span aria-hidden className="text-base">📅</span>
          Schedule a meeting
        </button>
      )}
      {onEmail && (
        <button
          type="button"
          onClick={onEmail}
          className="press mb-2 flex w-full items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          <span aria-hidden className="text-base">✉️</span>
          Email members
        </button>
      )}
      {onPoll && (
        <button
          type="button"
          onClick={onPoll}
          className="press mb-3 flex w-full items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          <span aria-hidden className="text-base">🗳️</span>
          Create a poll
        </button>
      )}
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.name} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 ring-1 ring-border">
            <span className="text-sm font-medium">{m.name}</span>
            {m.lead && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">Lead</span>}
          </li>
        ))}
        {members.length === 0 && <li className="px-1 py-2 text-sm text-foreground/50">No one here yet.</li>}
      </ul>
    </Sheet>
  );
}

/**
 * "Email members" for the room behind the ⋯ menu — the same
 * EmailMembersComposer used on the People page (lib/emailBlast.ts), just
 * pre-scoped to whoever's in THIS chat instead of a picker. A committee's
 * General channel emails the whole roster; an area sub-channel (e.g. Family
 * Fest's "Meals") narrows the committee roster down to that area's members,
 * mirroring exactly who `openMembers()` lists in the roster sheet above.
 */
function ChatEmailSheet({ target, onClose }: { target: EmailTarget; onClose: () => void }) {
  const { closing, close } = useSheetDismiss(onClose);
  const load = (): Promise<RecipientResult> =>
    target.type === "house"
      ? fetchHouseRecipients(target.houseId)
      : fetchCommitteeRecipients(target.committeeId).then((res) =>
          target.area === LEADS_AREA
            ? { ...res, recipients: res.recipients.filter((r) => r.roles?.some((role) => role.endsWith(" · Lead"))) }
            : target.area
              ? { ...res, recipients: res.recipients.filter((r) => r.roles?.some((role) => role.replace(/ · Lead$/, "") === target.area)) }
              : res,
        );
  const sourceKey = target.type === "house" ? `house:${target.houseId}` : `committee:${target.committeeId}|${target.area ?? ""}`;
  const migrationFile = target.type === "house" ? "0123_family_roster.sql" : "0028_email_recipients.sql";
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="chat-email-title"
      header={<h2 id="chat-email-title" className="text-lg font-bold">✉️ Email {target.label}</h2>}
    >
      <EmailMembersComposer sourceKey={sourceKey} load={load} groupNoun={target.label} migrationFile={migrationFile} />
    </Sheet>
  );
}

/**
 * "Mute for…" — the duration picker opened from a conversation row's bell
 * (1/3/7 days, or indefinitely). Unmuting itself is a one-tap toggle on the
 * bell (see bellTapped) and never opens this sheet.
 */
function MuteDurationSheet({ onPick, onClose }: { onPick: (hours: number | null) => void; onClose: () => void }) {
  const { closing, close } = useSheetDismiss(onClose);
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="mute-duration-title"
      header={
        <h2 id="mute-duration-title" className="text-lg font-bold">
          🔕 Mute this chat
        </h2>
      }
    >
      <ul className="space-y-2">
        {MUTE_DURATIONS.map((d) => (
          <li key={d.label}>
            <button
              type="button"
              onClick={() => onPick(d.hours)}
              className="press flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 text-left text-sm font-medium ring-1 ring-border"
            >
              {d.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** A rounded, ringed card that groups conversation rows (iOS inset-grouped look). */
function ChatCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">{children}</div>;
}

/** A labeled group of conversation rows: a small header over one ChatCard. */
function ChatSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-foreground/45">{label}</h2>
      <ChatCard>{children}</ChatCard>
    </section>
  );
}

function ConversationRow({
  emoji,
  title,
  subtitle,
  summary,
  onOpen,
  onToggleMute,
}: {
  emoji: string;
  title: string;
  subtitle: string | null;
  summary?: Summary;
  onOpen: () => void;
  onToggleMute?: () => void;
}) {
  const when = summary?.at ? formatWhen(summary.at) : null;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <button type="button" onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">{emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            {summary?.muted && (
              <span aria-label={summary.mutedUntil ? `Muted until ${formatWhen(summary.mutedUntil)}` : "Muted"} title={summary.mutedUntil ? `Muted until ${formatWhen(summary.mutedUntil)}` : "Muted"}>
                🔕
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-foreground/45">{when}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground/55">{summary?.last ?? subtitle ?? ""}</span>
            {!!summary?.unread && summary.unread > 0 && (
              <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-bold text-white ${summary.muted ? "bg-foreground/40" : "bg-accent"}`}>
                {summary.unread > 99 ? "99+" : summary.unread}
              </span>
            )}
          </span>
        </span>
      </button>
      {onToggleMute && (
        <button type="button" onClick={onToggleMute} aria-label={summary?.muted ? "Unmute" : "Mute"} className="press shrink-0 rounded-full p-1.5 text-foreground/40">
          {summary?.muted ? "🔕" : "🔔"}
        </button>
      )}
    </div>
  );
}

function formatWhen(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
