"use client";

import { useEffect, useRef, useState } from "react";
import { POSTS } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { PostsView } from "@/components/PostsView";
import { CommitteeChat } from "@/components/CommitteeChat";
import { HouseChat } from "@/components/HouseChat";
import { Sheet } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { readPersisted, writePersisted } from "@/lib/swrCache";
import { useRouter } from "next/navigation";

/**
 * The "Feed" tab — a Messages-style conversation list grouped into sections
 * (mirrors the iOS app's inset-grouped screen): "Family Feed" (the resort
 * posts) pinned on top, a "Your house" section (if you're in a house), then a
 * "Committee chats" section — a "{Committee} General" channel (e.g. "Family Fest
 * General") plus one row per role/area you hold (Family Fest → "Meals", …). Each
 * section is one card with inset dividers between its rows. Tap a row to open that
 * chat. If you're in no house or committee, the tab drops straight into the Family
 * Feed. Each row shows a last-message preview + unread badge (committee rows add a
 * mute toggle, 0063).
 */
interface Channel {
  key: string;            // `${slug}|${area ?? ""}`
  committeeId: string;
  slug: string;
  name: string;
  emoji: string;
  area: string | null;    // null = the committee's General channel
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
}

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
}
const feedCache = new Map<string, FeedSnapshot>();

export function FeedView() {
  const { user, userId, previewAsId, authReady } = useIdentity();
  const cacheKey = previewAsId ? `preview.${previewAsId}` : (userId ?? "");
  const cached = feedCache.get(cacheKey);
  const [channels, setChannels] = useState<Channel[]>(cached?.channels ?? []);
  const [houseChannel, setHouseChannel] = useState<HouseChannel | null>(cached?.houseChannel ?? null);
  const [active, setActive] = useState<string>("list"); // "list" | "posts" | channel.key | house key
  const [summaries, setSummaries] = useState<Record<string, Summary>>(cached?.summaries ?? {});
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<{ name: string; lead: boolean }[]>([]);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Opened from the House hub (/posts?house=slug): back should return to /house,
  // and we hold the feed/list render until loaded so we don't flash it on the way.
  const openedFromHouseRef = useRef(false);
  const [bootHouseSlug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null
  );
  const [loaded, setLoaded] = useState(false);
  // Holds the latest computeSummaries so the "returning to list" effect below
  // (which lives outside the load effect's closure) can trigger a refresh.
  const computeSummariesRef = useRef<() => Promise<void>>(async () => {});

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, previewAsId]);

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
              sb.from("committee_area_reads").select("last_read_at, muted").eq("committee_id", ch.committeeId).eq("user_id", meId).eq("area", ch.area ?? "").maybeSingle(),
            ]);
            const lastRow = lastRes.data as {
              text: string | null;
              created_at: string;
              profiles: { display_name: string | null } | null;
              committee_message_media: { media_type: string }[] | null;
            } | null;
            const read = readRes.data as { last_read_at: string | null; muted: boolean | null } | null;
            let unreadQ = areaEq(
              sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", ch.committeeId).neq("author_id", meId).is("deleted_at", null),
            );
            if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
            const { count } = await unreadQ;
            const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
            const body = lastRow?.text || (lastRow?.committee_message_media?.length ? mediaPreviewLabel(lastRow.committee_message_media[0].media_type) : "");
            next[ch.key] = {
              last: lastRow ? who + body : undefined,
              at: lastRow?.created_at,
              unread: count ?? 0,
              muted: read?.muted ?? false,
            };
          }),
        );
        // House channel summary (its own tables; no per-room mute).
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
            sb.from("house_reads").select("last_read_at").eq("house_id", hid).eq("user_id", meId).maybeSingle(),
          ]);
          const lastRow = lastRes.data as {
            text: string | null;
            created_at: string;
            profiles: { display_name: string | null } | null;
            house_message_media: { media_type: string }[] | null;
          } | null;
          const read = readRes.data as { last_read_at: string | null } | null;
          let unreadQ = sb.from("house_messages").select("id", { count: "exact", head: true }).eq("house_id", hid).neq("author_id", meId).is("deleted_at", null);
          if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
          const { count } = await unreadQ;
          const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
          const body = lastRow?.text || (lastRow?.house_message_media?.length ? mediaPreviewLabel(lastRow.house_message_media[0].media_type) : "");
          next[houseCh.key] = {
            last: lastRow ? who + body : undefined,
            at: lastRow?.created_at,
            unread: count ?? 0,
            muted: false,
          };
        }
        // Keep the cached snapshot's summaries current so a returning tab paints
        // the latest previews (only if a structural entry already exists — the
        // channels/houseChannel structural write below is what creates it).
        const prevSnap = feedCache.get(cacheKey);
        if (prevSnap) saveSnap({ ...prevSnap, summaries: next });
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
      const { data: ros } = await sb.from("committee_roster").select("committee_slug, roles").eq("linked_user_id", meId);
      const rosterRows = (ros ?? []) as { committee_slug: string; roles: string[] | null }[];
      const slugs = Array.from(new Set(rosterRows.map((r) => r.committee_slug)));
      const built: Channel[] = [];
      if (slugs.length) {
        const { data: cs } = await sb.from("committees").select("id, slug, name, emoji").in("slug", slugs).order("position", { ascending: true });
        const committees = (cs ?? []) as { id: string; slug: string; name: string; emoji: string }[];
        for (const c of committees) {
          const myAreas = Array.from(
            new Set(
              rosterRows.filter((r) => r.committee_slug === c.slug).flatMap((r) => (r.roles ?? []).map(stripLead)).filter(Boolean),
            ),
          );
          if (myAreas.length === 0) {
            built.push({ key: `${c.slug}|`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: null, title: c.name, subtitle: null });
          } else {
            // The committee-wide channel: title carries the committee name (e.g.
            // "Family Fest General") so it's clear which committee's General this
            // is once real messages replace the subtitle fallback.
            built.push({ key: `${c.slug}|`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: null, title: `${c.name} General`, subtitle: null });
            for (const a of myAreas) {
              built.push({ key: `${c.slug}|${a}`, committeeId: c.id, slug: c.slug, name: c.name, emoji: c.emoji, area: a, title: a, subtitle: c.name });
            }
          }
        }
      }
      if (cancelled) return;
      mine = built;
      setChannels(built);
      // Structural write: keep the cache's channels/houseChannel current. Also
      // runs on realtime roster/profile changes (this fn re-runs), so a removed
      // committee/house is reflected in the cache and can't stick on revisit.
      const prevSnap = feedCache.get(cacheKey);
      saveSnap({ channels: built, houseChannel: houseCh, summaries: prevSnap?.summaries ?? {} });
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
      if (params.get("post")) {
        setActive("posts");
      } else if (wantSlug) {
        const key = `${wantSlug}|${wantArea}`;
        if (mine.some((c) => c.key === key)) setActive(key);
      } else if (wantHouse && hc && hc.slug === wantHouse) {
        openedFromHouseRef.current = true;
        setActive(hc.key);
      }
      // Snapshot the resolved structure so the next remount paints the list
      // instantly instead of flashing the Main Feed guard.
      saveSnap({ channels: mine, houseChannel: houseCh, summaries: feedCache.get(cacheKey)?.summaries ?? {} });
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
  // the page around (same technique as the old overlay).
  useEffect(() => {
    if (active === "list" || active === "posts") return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = chatBoxRef.current;
    const apply = () => {
      if (!el) return;
      const innerH = window.innerHeight;
      const visH = vv ? vv.height : innerH;
      const keyboardOpen = innerH - visH > 120;
      const tabBar = document.querySelector("nav.fixed") as HTMLElement | null;
      const tabH = keyboardOpen ? 0 : tabBar?.getBoundingClientRect().height ?? 64;
      el.style.height = `${visH - tabH}px`;
      el.style.transform = `translateY(${vv ? vv.offsetTop : 0}px)`;
    };
    apply();
    const t = setTimeout(apply, 60);
    window.addEventListener("resize", apply);
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", apply);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
    };
  }, [active]);

  // Load "who's in this chat" — for a role channel, roster members who hold that
  // area; for General, everyone on the committee roster.
  const openMembers = async (ch: Channel) => {
    const sb = supabase;
    if (!sb) return;
    const { data } = await sb
      .from("committee_roster")
      .select("name, roles, profiles:linked_user_id(display_name)")
      .eq("committee_slug", ch.slug);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const inArea = ch.area
      ? rows.filter((r) => ((r.roles ?? []) as string[]).some((role) => role === ch.area || role === `${ch.area} · Lead`))
      : rows;
    setMembers(
      inArea
        .map((r) => {
          const p = r.profiles;
          const displayName = (Array.isArray(p) ? p[0]?.display_name : p?.display_name) as string | undefined;
          return { name: displayName || r.name, lead: ((r.roles ?? []) as string[]).some((x) => x.endsWith(" · Lead")) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setShowMembers(true);
  };

  const toggleMute = async (ch: Channel) => {
    const sb = supabase;
    if (!sb) return;
    const nextMuted = !(summaries[ch.key]?.muted ?? false);
    setSummaries((s) => ({ ...s, [ch.key]: { ...(s[ch.key] ?? { unread: 0, muted: false }), muted: nextMuted } }));
    await sb.rpc("set_area_mute", { cid: ch.committeeId, p_area: ch.area, p_muted: nextMuted });
  };

  // Opened via a house deep-link (from the House hub): wait for load so we drop
  // straight into the house chat instead of flashing the feed/list on the way in.
  // Exception: the snapshot fast path above may have already opened the house
  // chat — then there's nothing to hide, so skip the gate and render it now.
  const fastPathOpen = houseChannel !== null && active === houseChannel.key;
  if (bootHouseSlug && !loaded && !fastPathOpen) {
    return (
      <div className="flex h-[50dvh] items-center justify-center text-sm text-foreground/40">Loading…</div>
    );
  }

  // No house and no committees → straight to the Family Feed, no list.
  if (channels.length === 0 && !houseChannel) {
    return (
      <div className="space-y-3 pt-1">
        <PostsView seed={POSTS} showHeading />
      </div>
    );
  }

  // The house chat opened from the list.
  if (houseChannel && active === houseChannel.key) {
    return (
      <div ref={chatBoxRef} data-ptr-block className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background" style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <BackButton
            label={openedFromHouseRef.current ? "House" : "Feed"}
            onClick={() => { if (openedFromHouseRef.current) router.push("/house"); else setActive("list"); }}
          />
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-bold">{houseChannel.emoji} {houseChannel.name}</p>
          </div>
          <span className="h-9 w-9" aria-hidden />
        </div>
        <div className="min-h-0 flex-1">
          <HouseChat key={houseChannel.key} slug={houseChannel.slug} name={houseChannel.name} emoji={houseChannel.emoji} houseId={houseChannel.houseId} embedded knownMember />
        </div>
      </div>
    );
  }

  // An open committee chat → the viewport-pinned conversation, with a back button.
  const activeChannel = channels.find((c) => c.key === active);
  if (activeChannel) {
    return (
      <>
        <div ref={chatBoxRef} data-ptr-block className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background" style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <BackButton label="Feed" onClick={() => setActive("list")} />
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
            onClose={() => setShowMembers(false)}
          />
        )}
      </>
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

      {/* Family Feed — pinned on top, its own card. */}
      <ChatCard>
        <ConversationRow emoji="📰" title="Family Feed" subtitle="Everyone" summary={undefined} onOpen={() => setActive("posts")} />
      </ChatCard>

      {houseChannel && (
        <ChatSection label="Your house">
          <ConversationRow
            emoji={houseChannel.emoji}
            title={houseChannel.name}
            subtitle="Your house"
            summary={summaries[houseChannel.key]}
            onOpen={() => setActive(houseChannel.key)}
          />
        </ChatSection>
      )}

      {channels.length > 0 && (
        <ChatSection label="Committee chats">
          {channels.map((ch, i) => (
            <div key={ch.key}>
              {i > 0 && <div className="ml-[68px] border-t border-border" aria-hidden />}
              <ConversationRow
                emoji={ch.emoji}
                title={ch.title}
                subtitle={ch.subtitle}
                summary={summaries[ch.key]}
                onOpen={() => setActive(ch.key)}
                onToggleMute={() => toggleMute(ch)}
              />
            </div>
          ))}
        </ChatSection>
      )}
    </div>
  );
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
  onClose,
}: {
  title: string;
  members: { name: string; lead: boolean }[];
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
            {summary?.muted && <span aria-label="Muted">🔕</span>}
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
