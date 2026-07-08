"use client";

import { useEffect, useRef, useState } from "react";
import { POSTS } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { PostsView } from "@/components/PostsView";
import { CommitteeChat } from "@/components/CommitteeChat";
import { HouseChat } from "@/components/HouseChat";
import { useRouter } from "next/navigation";

/**
 * The "Feed" tab — a Messages-style conversation list grouped into sections
 * (mirrors the iOS app's inset-grouped Chats screen): "Main Feed" (the resort
 * posts) pinned on top, a "Your house" section (if you're in a house), then a
 * "Committee chats" section — a "{Committee} General" channel (e.g. "Family Fest
 * General") plus one row per role/area you hold (Family Fest → "Meals", …). Each
 * section is one card with inset dividers between its rows. Tap a row to open that
 * chat. If you're in no house or committee, the tab drops straight into the Main
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

/**
 * Stale-while-revalidate cache, mirroring lib/hooks.ts `eventsCache`. FeedView
 * remounts on every tab navigation; without this, channels/houseChannel reset to
 * empty/null and the "no house & no committee → Main Feed" guard (~line 281)
 * fires for a beat before the load effect resolves — so anyone in a house or
 * committee sees the Main Feed flash, then pops to the Chats list. Holding the
 * last result per viewer lets a returning tab paint the list immediately while
 * the effect refetches in the background. Keyed on `${email}|${previewAs}` so a
 * different viewer (or an admin previewing as someone) never reads another's
 * channels. Memory-only (per session) and written ONLY inside effects, never
 * during render/SSR — the map is empty at module-eval, so a cold first render
 * still hits the []/null defaults that match the static/prerendered HTML (where
 * `user` is null), avoiding any hydration mismatch.
 */
const feedCache = new Map<string, { channels: Channel[]; houseChannel: HouseChannel | null; summaries: Record<string, Summary> }>();

export function FeedView() {
  const { user, previewAsId } = useIdentity();
  const cacheKey = `${user?.email ?? ""}|${previewAsId ?? "self"}`;
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

  // Load my channels (Main Feed is implicit) + their previews.
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    let me: string | null = null;
    let mine: Channel[] = [];
    let houseCh: HouseChannel | null = null;

    const computeSummaries = async () => {
      if (!me) return;
      const meId = me;
      const next: Record<string, Summary> = {};
      await Promise.all(
        mine.map(async (ch) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const areaEq = (q: any) => (ch.area ? q.eq("area", ch.area) : q.is("area", null));
          const [lastRes, readRes] = await Promise.all([
            areaEq(
              sb.from("committee_messages").select("text, created_at, profiles!author_id(display_name)").eq("committee_id", ch.committeeId),
            ).order("created_at", { ascending: false }).limit(1).maybeSingle(),
            sb.from("committee_area_reads").select("last_read_at, muted").eq("committee_id", ch.committeeId).eq("user_id", meId).eq("area", ch.area ?? "").maybeSingle(),
          ]);
          const lastRow = lastRes.data as { text: string | null; created_at: string; profiles: { display_name: string | null } | null } | null;
          const read = readRes.data as { last_read_at: string | null; muted: boolean | null } | null;
          let unreadQ = areaEq(sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", ch.committeeId).neq("author_id", meId));
          if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
          const { count } = await unreadQ;
          const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
          next[ch.key] = {
            last: lastRow ? who + (lastRow.text ?? "") : undefined,
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
          sb.from("house_messages").select("text, created_at, profiles!author_id(display_name)").eq("house_id", hid).order("created_at", { ascending: false }).limit(1).maybeSingle(),
          sb.from("house_reads").select("last_read_at").eq("house_id", hid).eq("user_id", meId).maybeSingle(),
        ]);
        const lastRow = lastRes.data as { text: string | null; created_at: string; profiles: { display_name: string | null } | null } | null;
        const read = readRes.data as { last_read_at: string | null } | null;
        let unreadQ = sb.from("house_messages").select("id", { count: "exact", head: true }).eq("house_id", hid).neq("author_id", meId);
        if (read?.last_read_at) unreadQ = unreadQ.gt("created_at", read.last_read_at);
        const { count } = await unreadQ;
        const who = lastRow?.profiles?.display_name ? `${lastRow.profiles.display_name}: ` : "";
        next[houseCh.key] = {
          last: lastRow ? who + (lastRow.text ?? "") : undefined,
          at: lastRow?.created_at,
          unread: count ?? 0,
          muted: false,
        };
      }
      // Keep the cached snapshot's summaries current so a returning tab paints
      // the latest previews (only if a structural entry already exists — the
      // channels/houseChannel structural write below is what creates it).
      const prevSnap = feedCache.get(cacheKey);
      if (prevSnap) feedCache.set(cacheKey, { ...prevSnap, summaries: next });
      if (!cancelled) setSummaries(next);
    };

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
      feedCache.set(cacheKey, { channels: built, houseChannel: houseCh, summaries: prevSnap?.summaries ?? {} });
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
      me = previewAsId ?? (await sb.auth.getUser()).data.user?.id ?? null;
      if (cancelled || !me) return;
      const hc = await loadHouse();
      await loadChannels();
      if (cancelled) return;
      // Deep-links: ?c=slug&area= (committee) or ?house=slug (house).
      const params = new URLSearchParams(window.location.search);
      const wantSlug = params.get("c");
      const wantArea = params.get("area") ?? "";
      const wantHouse = params.get("house");
      if (wantSlug) {
        const key = `${wantSlug}|${wantArea}`;
        if (mine.some((c) => c.key === key)) setActive(key);
      } else if (wantHouse && hc && hc.slug === wantHouse) {
        openedFromHouseRef.current = true;
        setActive(hc.key);
      }
      // Snapshot the resolved structure so the next remount paints the list
      // instantly instead of flashing the Main Feed guard.
      feedCache.set(cacheKey, { channels: mine, houseChannel: houseCh, summaries: feedCache.get(cacheKey)?.summaries ?? {} });
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
  }, [user?.email, previewAsId]);

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
  if (bootHouseSlug && !loaded) {
    return (
      <div className="flex h-[50dvh] items-center justify-center text-sm text-foreground/40">Loading…</div>
    );
  }

  // No house and no committees → straight to the Main Feed, no list.
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
      <div ref={chatBoxRef} className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background" style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => { if (openedFromHouseRef.current) router.push("/house"); else setActive("list"); }}
            className="press flex items-center gap-1 text-sm font-semibold text-primary"
          >
            ‹ {openedFromHouseRef.current ? "House" : "Chats"}
          </button>
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
      <div ref={chatBoxRef} className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background" style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <button type="button" onClick={() => setActive("list")} className="press flex items-center gap-1 text-sm font-semibold text-primary">
            ‹ Chats
          </button>
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
        {showMembers && (
          <div className="absolute inset-0 z-10 flex flex-col bg-black/30" onClick={() => setShowMembers(false)}>
            <div className="mt-auto max-h-[70%] overflow-y-auto rounded-t-2xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold">{activeChannel.title} · {members.length} {members.length === 1 ? "person" : "people"}</h2>
                <button type="button" onClick={() => setShowMembers(false)} className="press text-sm font-semibold text-primary">Done</button>
              </div>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.name} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                    <span className="text-sm font-medium">{m.name}</span>
                    {m.lead && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">Lead</span>}
                  </li>
                ))}
                {members.length === 0 && <li className="px-1 py-2 text-sm text-foreground/50">No one here yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main Feed opened from the list.
  if (active === "posts") {
    return (
      <div className="space-y-3 pt-1">
        <button type="button" onClick={() => setActive("list")} className="press flex items-center gap-1 text-sm font-semibold text-primary">
          ‹ Chats
        </button>
        <PostsView seed={POSTS} showHeading={false} />
      </div>
    );
  }

  // The conversation list — a Messages-style, grouped layout mirroring the iOS
  // app: Main Feed pinned on top, then a "Your house" section, then a "Committee
  // chats" section. Each section is one rounded card with inset dividers between
  // its rows (not a stack of separate cards), so the list reads clean.
  return (
    <div className="space-y-5 pt-1">
      <h1 className="px-1 text-lg font-bold">Chats</h1>

      {/* Main Feed — pinned on top, its own card. */}
      <ChatCard>
        <ConversationRow emoji="📰" title="Main Feed" subtitle="Everyone" summary={undefined} onOpen={() => setActive("posts")} />
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
