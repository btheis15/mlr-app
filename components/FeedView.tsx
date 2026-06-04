"use client";

import { useEffect, useRef, useState } from "react";
import { POSTS } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { PostsView } from "@/components/PostsView";
import { CommitteeChat } from "@/components/CommitteeChat";

/**
 * The "Feed" tab — one place to catch up. A pill row switches between the
 * resort-wide Posts feed and a live chat for each committee you're in, each pill
 * with an unread badge. No committees → just Posts (no pills).
 *
 * v2 (post-incident): renders in NORMAL page flow — no fixed full-screen overlay,
 * and it does NOT render its own AnnouncementBanner (the layout already shows one;
 * a second instance opened a duplicate realtime channel that crashed iOS Safari's
 * page process for signed-in users). The committee chat sits inline in a bounded
 * box. Every realtime channel here has a distinct name.
 */
interface MyCommittee {
  id: string;
  slug: string;
  name: string;
  emoji: string;
}
const POSTS_SEEN_KEY = "mlr-feed-posts-seen";

export function FeedView() {
  const { user } = useIdentity();
  const [committees, setCommittees] = useState<MyCommittee[]>([]);
  const [active, setActive] = useState<string>("posts");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [postsUnread, setPostsUnread] = useState(0);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    let me: string | null = null;
    let mine: MyCommittee[] = [];

    const computeUnread = async () => {
      if (!me) return;
      const meId = me;
      const { data: reads } = await sb.from("committee_reads").select("committee_id, last_read_at").eq("user_id", meId);
      const readMap = new Map(((reads ?? []) as { committee_id: string; last_read_at: string }[]).map((r) => [r.committee_id, r.last_read_at]));
      const counts: Record<string, number> = {};
      await Promise.all(
        mine.map(async (c) => {
          let q = sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", c.id).neq("author_id", meId);
          const since = readMap.get(c.id);
          if (since) q = q.gt("created_at", since);
          const { count } = await q;
          counts[c.slug] = count ?? 0;
        }),
      );
      if (cancelled) return;
      setUnread(counts);
      try {
        const seen = localStorage.getItem(POSTS_SEEN_KEY);
        let pq = sb.from("posts").select("id", { count: "exact", head: true }).neq("author_id", meId);
        if (seen) pq = pq.gt("created_at", seen);
        const { count } = await pq;
        if (!cancelled) setPostsUnread(seen ? count ?? 0 : 0);
      } catch {
        /* ignore */
      }
    };

    // (Re)load the committees I'm in. Re-run on a membership change so the pills
    // stay in sync when I join or LEAVE a committee — and if I just left the one
    // I was viewing, fall back to Posts.
    const loadCommittees = async () => {
      if (!me) return;
      const { data: mem } = await sb.from("committee_members").select("committee_id").eq("user_id", me);
      const ids = ((mem ?? []) as { committee_id: string }[]).map((r) => r.committee_id);
      let next: MyCommittee[] = [];
      if (ids.length) {
        const { data: cs } = await sb.from("committees").select("id, slug, name, emoji").in("id", ids).order("position", { ascending: true });
        next = (cs ?? []) as MyCommittee[];
      }
      if (cancelled) return;
      mine = next;
      setCommittees(next);
      setActive((prev) => (prev === "posts" || next.some((c) => c.slug === prev) ? prev : "posts"));
      await computeUnread();
    };

    (async () => {
      me = (await sb.auth.getUser()).data.user?.id ?? null;
      if (cancelled || !me) return;
      await loadCommittees();
      if (cancelled) return;
      const want = new URLSearchParams(window.location.search).get("c");
      if (want && mine.some((c) => c.slug === want)) setActive(want);
      channel = sb
        .channel("feed-unread")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" }, () => computeUnread())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => computeUnread())
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_members", filter: `user_id=eq.${me}` }, () => loadCommittees())
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
    // Key on the stable email, not the whole `user` object — that reference
    // changes on every (hourly) token refresh, which would needlessly tear down
    // and re-subscribe the channel + re-run all the count queries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  // The active committee chat is a fixed layer pinned to the *visual* viewport
  // (see the JSX below), not an inline box in the scrolling page. iOS won't let
  // an in-flow composer stay put when the keyboard opens — the page scrolls and
  // the bottom-fixed TabBar strands mid-screen. Sizing this layer to the visible
  // area (its height, shifted by its offset) keeps the composer locked just
  // above the keyboard with no page movement; when the keyboard is closed we
  // leave room for the TabBar so it stays reachable.
  useEffect(() => {
    if (active === "posts") return;
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

  const select = (key: string) => {
    setActive(key);
    if (key === "posts") {
      try {
        localStorage.setItem(POSTS_SEEN_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
      setPostsUnread(0);
    } else {
      setUnread((u) => ({ ...u, [key]: 0 }));
    }
  };

  const activeCommittee = committees.find((c) => c.slug === active);

  const pills = committees.length > 0 && (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-background px-4 pb-2 pt-1">
      <Pill label="Posts" active={active === "posts"} badge={postsUnread} onClick={() => select("posts")} />
      {committees.map((c) => (
        <Pill key={c.slug} label={c.name} emoji={c.emoji} active={active === c.slug} badge={unread[c.slug] ?? 0} onClick={() => select(c.slug)} />
      ))}
    </div>
  );

  // Active committee chat → a fixed, visual-viewport-pinned conversation that
  // covers the page (and the TabBar) so iOS keyboard behaviour can't shove
  // anything around. The pills ride along as its header so you can still switch
  // rooms or tap Posts to drop back to the feed. It renders no AnnouncementBanner
  // and opens no extra realtime channel (the v1 overlay's duplicate banner is
  // what crashed iOS Safari — this layer is layout-only).
  if (active !== "posts" && activeCommittee) {
    return (
      <div
        ref={chatBoxRef}
        className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col bg-background"
        style={{ height: "calc(100dvh - 64px)", paddingTop: "env(safe-area-inset-top)" }}
      >
        {pills}
        <div className="min-h-0 flex-1">
          <CommitteeChat key={activeCommittee.slug} slug={activeCommittee.slug} name={activeCommittee.name} emoji={activeCommittee.emoji} embedded knownMember />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-1">
      {committees.length > 0 && <div className="sticky top-0 z-10 -mx-4">{pills}</div>}
      <PostsView seed={POSTS} />
    </div>
  );
}

function Pill({ label, emoji, active, badge, onClick }: { label: string; emoji?: string; active: boolean; badge: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
        active ? "bg-primary text-white ring-primary" : "bg-card text-foreground/60 ring-border"
      }`}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      <span className="max-w-[8rem] truncate">{label}</span>
      {badge > 0 && (
        <span className={`ml-0.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold ${active ? "bg-white/25 text-white" : "bg-accent text-white"}`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
