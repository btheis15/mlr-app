"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonList } from "@/components/Skeleton";
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
  committee_join_request: "🙋",
  cabin_request: "🏡",
  cabin_decision: "🏡",
  event_rsvp: "📅",
  help_request: "🙌",
  help_response: "🚶",
  help_urgent: "🚨",
  work_item_comment: "💬",
  work_item_mention: "🗣️",
  work_item_created: "🔧",
  house_stay_created: "🏡",
  meeting_proposed: "📅",
  meeting_scheduled: "✅",
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
 * Stale-while-revalidate cache for the notifications feed, keyed by viewer email.
 * `NotificationsView` remounts on every visit to the Activity tab; without this it
 * resets to `[]` + `loading`, so the feed shows a full SkeletonList before the list
 * paints. It now rides the shared SWR cache (`notifFeed.<uid>`, lib/swrCache):
 * memory covers the tab-switch remounts, and the persisted copy paints the
 * last-known feed instantly on a cold open too, while the fetch reconciles in
 * the background.
 */

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
  const { userId } = useIdentity();
  const [needsMigration, setNeedsMigration] = useState(false);
  const [schedule] = useDebouncedCallback(300);

  const { data: items, loading, reload, mutate } = useCachedResource<AppNotification[]>(
    isSupabaseConfigured && userId ? `notifFeed.${userId}` : null,
    [],
    async () => {
      const sb = supabase;
      if (!sb || !userId) return [];
      const { data, error } = await sb
        .from("notifications")
        .select(
          // Disambiguate the actor join — notifications has two FKs to profiles
          // (recipient_id + actor_id), so hint the column.
          "id, type, actor_id, title, body, url, created_at, seen_at, read_at, expires_at, actor:profiles!actor_id(display_name, avatar_url)",
        )
        .eq("recipient_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        // Table not there yet → the migration hasn't been run. Throw either
        // way so a transient error keeps the stale list instead of caching [].
        if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
          setNeedsMigration(true);
        }
        throw new Error(error.message);
      }
      const rows = (data ?? []) as unknown as RawRow[];
      const mapped: AppNotification[] = rows.map((r) => ({
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
      }));
      setNeedsMigration(false);
      // Clear the badge: everything currently here counts as "seen" now. Keeps the
      // count at zero while the tab is open (new arrivals get re-marked on reload).
      sb.rpc("mark_notifications_seen").then(() => {});
      return mapped;
    },
    { persist: "local" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !userId) return;
    const channel = sb
      .channel(`notif-feed-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, reload, schedule]);

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      mutate((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      supabase?.rpc("mark_notification_read", { p_id: n.id }).then(() => {});
    }
    if (n.url) router.push(n.url);
  };

  const markAllRead = async () => {
    mutate((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    await supabase?.rpc("mark_all_notifications_read");
  };

  const hasUnread = items.some((n) => !n.readAt);
  const groups = groupByDay(items, (n) => n.createdAt);

  return (
    <div className="space-y-4 pt-6">
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
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
        <SkeletonList />
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-3xl">🔔</div>
          <p className="text-sm font-medium">You&rsquo;re all caught up</p>
          <p className="mt-1 text-xs text-muted">
            Comments and reactions on your posts, @mentions, new Feed posts, and announcements will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day} className="space-y-1.5">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-faint">
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
                            <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>
                          )}
                          <span className="mt-0.5 block text-xs text-faint">
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
