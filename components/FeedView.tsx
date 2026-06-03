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
  const [chatH, setChatH] = useState<string | number>("60dvh");
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const computeUnread = async (mine: MyCommittee[], me: string) => {
      const { data: reads } = await sb.from("committee_reads").select("committee_id, last_read_at").eq("user_id", me);
      const readMap = new Map(((reads ?? []) as { committee_id: string; last_read_at: string }[]).map((r) => [r.committee_id, r.last_read_at]));
      const counts: Record<string, number> = {};
      await Promise.all(
        mine.map(async (c) => {
          let q = sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", c.id).neq("author_id", me);
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
        let pq = sb.from("posts").select("id", { count: "exact", head: true }).neq("author_id", me);
        if (seen) pq = pq.gt("created_at", seen);
        const { count } = await pq;
        if (!cancelled) setPostsUnread(seen ? count ?? 0 : 0);
      } catch {
        /* ignore */
      }
    };

    (async () => {
      const me = (await sb.auth.getUser()).data.user?.id ?? null;
      if (cancelled || !me) return;
      const { data: mem } = await sb.from("committee_members").select("committee_id").eq("user_id", me);
      const ids = ((mem ?? []) as { committee_id: string }[]).map((r) => r.committee_id);
      let mine: MyCommittee[] = [];
      if (ids.length) {
        const { data: cs } = await sb.from("committees").select("id, slug, name, emoji").in("id", ids).order("position", { ascending: true });
        mine = (cs ?? []) as MyCommittee[];
      }
      if (cancelled) return;
      setCommittees(mine);
      const want = new URLSearchParams(window.location.search).get("c");
      if (want && mine.some((c) => c.slug === want)) setActive(want);
      await computeUnread(mine, me);
      channel = sb
        .channel("feed-unread")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" }, () => computeUnread(mine, me))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => computeUnread(mine, me))
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

  // Size the inline committee chat to the space between the pills and the fixed
  // TabBar, and shrink to the visible area when the iOS keyboard opens — so the
  // composer is never stranded behind the TabBar or the keyboard. (Replaces a
  // guessed calc() that ignored the safe-area inset.)
  useEffect(() => {
    if (active === "posts") return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const measure = () => {
      const el = chatBoxRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const innerH = window.innerHeight;
      const visH = vv ? vv.height : innerH;
      const keyboardOpen = innerH - visH > 120;
      const tabBar = document.querySelector('nav[class*="fixed"]') as HTMLElement | null;
      const tabH = keyboardOpen ? 0 : tabBar?.getBoundingClientRect().height ?? 60;
      const bottom = vv ? vv.offsetTop + vv.height : innerH;
      setChatH(Math.max(260, bottom - top - tabH - 6));
    };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [active, committees.length]);

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

  return (
    <div className="space-y-3 pt-1">
      {committees.length > 0 && (
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background px-4 pb-2 pt-1">
          <Pill label="Posts" active={active === "posts"} badge={postsUnread} onClick={() => select("posts")} />
          {committees.map((c) => (
            <Pill key={c.slug} label={c.name} emoji={c.emoji} active={active === c.slug} badge={unread[c.slug] ?? 0} onClick={() => select(c.slug)} />
          ))}
        </div>
      )}

      {active !== "posts" && activeCommittee ? (
        <div ref={chatBoxRef} style={{ height: chatH }} className="overflow-hidden rounded-2xl ring-1 ring-border">
          <CommitteeChat key={activeCommittee.slug} slug={activeCommittee.slug} name={activeCommittee.name} emoji={activeCommittee.emoji} embedded />
        </div>
      ) : (
        <PostsView seed={POSTS} />
      )}
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
