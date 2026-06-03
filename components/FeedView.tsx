"use client";

import { useEffect, useState } from "react";
import { POSTS } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { PostsView } from "@/components/PostsView";
import { CommitteeChat } from "@/components/CommitteeChat";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";

/**
 * The "Feed" tab — one place to catch up on everything. A pill row switches
 * between the resort-wide **Posts** feed and a live **chat** for each committee
 * you're in; each pill shows an unread badge (new since you last looked). With
 * no committees you just get Posts. Committee chats render inline below the
 * pills (CommitteeChat in `embedded` mode).
 *
 * Rendered only for signed-in members (wrapped in SignInWall by the page). It's
 * a fixed full-height column above the tab bar so the chat composer can sit at
 * the bottom and the message list scrolls — like a real chat tab.
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
  const [active, setActive] = useState<string>("posts"); // "posts" or a committee slug
  const [unread, setUnread] = useState<Record<string, number>>({}); // slug -> count
  const [postsUnread, setPostsUnread] = useState(0);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const computeUnread = async (mine: MyCommittee[], me: string) => {
      const { data: reads } = await sb
        .from("committee_reads")
        .select("committee_id, last_read_at")
        .eq("user_id", me);
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
      // Deep link from the committee page: /posts?c=<slug>
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
  }, [user]);

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
      setUnread((u) => ({ ...u, [key]: 0 })); // CommitteeChat marks it read server-side on open
    }
  };

  const activeCommittee = committees.find((c) => c.slug === active);

  return (
    <div
      className="fixed inset-x-0 z-30 mx-auto flex max-w-md flex-col bg-background"
      style={{ top: "env(safe-area-inset-top)", bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="shrink-0 px-4 pt-2">
        <AnnouncementBanner items={[]} />
      </div>

      {committees.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 pb-2 pt-1">
          <Pill label="Posts" active={active === "posts"} badge={postsUnread} onClick={() => select("posts")} />
          {committees.map((c) => (
            <Pill key={c.slug} label={c.name} emoji={c.emoji} active={active === c.slug} badge={unread[c.slug] ?? 0} onClick={() => select(c.slug)} />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {active !== "posts" && activeCommittee ? (
          <CommitteeChat key={activeCommittee.slug} slug={activeCommittee.slug} name={activeCommittee.name} emoji={activeCommittee.emoji} embedded />
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-4">
            <PostsView seed={POSTS} />
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, emoji, active, badge, onClick }: { label: string; emoji?: string; active: boolean; badge: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press relative flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
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
