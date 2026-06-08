"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { MigrationHint } from "@/components/MigrationHint";
import { useDebouncedCallback } from "@/lib/hooks";
import { timeAgo, formatDayHeading, groupByDay } from "@/lib/format";
import type { AppNotification, NotifType } from "@/lib/types";

// A little glyph per kind — shown as a corner badge on the actor's avatar, or as
// the standalone icon for system notices (broadcasts) that have no avatar.
const TYPE_EMOJI: Record<NotifType, string> = {
  post_comment: "💬",
  post_reply: "💬",
  post_mention: "🗣️",
  post_tag: "🏷️",
  post_reaction: "❤️",
  new_post: "📸",
  chat_mention: "💬",
  committee_join: "👥",
  cabin_request: "🏡",
  cabin_decision: "🏡",
  broadcast: "📣",
};

interface RawRow {
  id: string;
  type: NotifType;
  actor_id: string | null;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  seen_at: string | null;
  read_at: string | null;
  expires_at: string | null;
  actor: { display_name: string | null; avatar_url: string | null } | null;
}

function isExpired(n: AppNotification): boolean {
  return !!n.expiresAt && new Date(n.expiresAt).getTime() <= Date.now();
}

/**
 * The Notifications tab feed (migration 0030). A durable, Facebook-style list of
 * everything that happened involving you — comments and reactions on your posts,
 * @mentions in posts and committee chat, new Feed posts, committee approvals, and
 * admin broadcasts. Opening this view stamps everything seen (clearing the tab
 * badge) while the items themselves stay; tapping one marks it read and deep-links
 * to the source. Stays live via a Realtime subscription on your own rows.
 *
 * Assumes a signed-in member (the route wraps it in <SignInWall>).
 */
export function NotificationsView() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [schedule] = useDebouncedCallback(300);
  const uidRef = useRef<string | null>(null);

  const load = useCallback(async (uid: string) => {
    const sb = supabase;
    if (!sb) return;
    const { data, error } = await sb
      .from("notifications")
      .select(
        // Disambiguate the actor join — notifications has two FKs to profiles
        // (recipient_id + actor_id), so hint the column.
        "id, type, actor_id, title, body, url, created_at, seen_at, read_at, expires_at, actor:profiles!actor_id(display_name, avatar_url)",
      )
      .eq("recipient_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      // Table not there yet → the migration hasn't been run.
      if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
        setNeedsMigration(true);
      }
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as RawRow[];
    setItems(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        actorId: r.actor_id,
        actorName: r.actor?.display_name ?? null,
        actorAvatarUrl: r.actor?.avatar_url ?? null,
        title: r.title,
        body: r.body,
        url: r.url,
        createdAt: r.created_at,
        seenAt: r.seen_at,
        readAt: r.read_at,
        expiresAt: r.expires_at,
      })),
    );
    setNeedsMigration(false);
    setLoading(false);
    // Clear the badge: everything currently here counts as "seen" now. Keeps the
    // count at zero while the tab is open (new arrivals get re-marked on reload).
    sb.rpc("mark_notifications_seen").then(() => {});
  }, []);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id;
      uidRef.current = uid ?? null;
      if (!uid || cancelled) {
        setLoading(false);
        return;
      }
      await load(uid);
      channel = sb
        .channel(`notif-feed-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${uid}` },
          () => schedule(() => load(uid)),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [load, schedule]);

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      supabase?.rpc("mark_notification_read", { p_id: n.id }).then(() => {});
    }
    if (n.url) router.push(n.url);
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    await supabase?.rpc("mark_all_notifications_read");
  };

  const hasUnread = items.some((n) => !n.readAt);
  const groups = groupByDay(items, (n) => n.createdAt);

  return (
    <div className="space-y-4 pt-6">
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        {hasUnread && (
          <button
            onClick={markAllRead}
            className="press ml-auto rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-border"
          >
            Mark all read
          </button>
        )}
      </header>

      {needsMigration ? (
        <MigrationHint file="0030_notifications_feed.sql">To turn on the Notifications feed,</MigrationHint>
      ) : loading ? (
        <p className="py-10 text-center text-sm text-foreground/45">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-3xl">🔔</div>
          <p className="text-sm font-medium">You&rsquo;re all caught up</p>
          <p className="mt-1 text-xs text-foreground/50">
            Comments and reactions on your posts, @mentions, new Feed posts, and announcements will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day} className="space-y-1.5">
              <h2 className="px-1 text-[11px] font-bold uppercase tracking-wide text-foreground/40">
                {formatDayHeading(g.items[0].createdAt)}
              </h2>
              <ul className="overflow-hidden rounded-2xl ring-1 ring-border">
                {g.items.map((n, i) => {
                  const unread = !n.readAt;
                  const expired = isExpired(n);
                  return (
                    <li key={n.id} className={i ? "border-t border-border" : ""}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={`press flex w-full items-start gap-3 p-3 text-left transition-colors ${
                          unread ? "bg-primary/[0.06]" : "bg-card"
                        } ${expired ? "opacity-60" : ""}`}
                      >
                        <span className="relative shrink-0">
                          {n.actorName || n.actorAvatarUrl ? (
                            <Avatar name={n.actorName || "Member"} url={n.actorAvatarUrl} size={42} />
                          ) : (
                            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-primary/10 text-xl">
                              {TYPE_EMOJI[n.type]}
                            </span>
                          )}
                          <span
                            aria-hidden
                            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-card text-[11px] ring-1 ring-border"
                          >
                            {TYPE_EMOJI[n.type]}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm leading-snug ${unread ? "font-semibold" : "text-foreground/80"}`}>
                            {n.title}
                          </span>
                          {n.body && (
                            <span className="mt-0.5 block truncate text-xs text-foreground/50">{n.body}</span>
                          )}
                          <span className="mt-0.5 block text-[11px] text-foreground/40">
                            {timeAgo(n.createdAt)}
                            {expired ? " · expired" : ""}
                          </span>
                        </span>
                        {unread && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
