"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonList } from "@/components/Skeleton";
import { useBusyAction } from "@/lib/hooks";
import { plural } from "@/lib/format";

type ModEntity = "post" | "comment" | "committee_message" | "house_message" | "event_chat_message";

// Friendly label for the entity chip (raw values like "committee_message" read
// badly uppercased). Chat rows carry their room in the body (see moderation_queue).
const ENTITY_LABEL: Record<ModEntity, string> = {
  post: "post",
  comment: "comment",
  committee_message: "committee chat",
  house_message: "house chat",
  // Event chats have no app-admin override (0216) — an admin can read a message
  // ONLY while it's held, which is exactly what this queue shows. So this row is
  // the one and only place an admin sees event-chat content.
  event_chat_message: "event chat",
};

interface QueueRow {
  entity_type: ModEntity;
  entity_id: string;
  post_id: string | null;
  author_id: string | null;
  author_name: string | null;
  body: string;
  status: "visible" | "pending" | "hidden";
  report_count: number;
  reasons: string[] | null;
  created_at: string;
}

/**
 * Stale-while-revalidate cache for the moderation panel. `AdminModeration`
 * remounts every time Profile → Admin is reopened; without this the review queue
 * resets to empty + `loading`, so the panel blanks out and pops back
 * in on every visit. Holding the last result in memory lets a returning admin
 * paint instantly from cache while a background refetch keeps it current. It's an
 * admin-only global, so a single module-scope singleton (not keyed) is enough.
 * Memory-only (per session) and only ever written *after* a client fetch — never
 * during SSR/render — so it can't change the server/first-paint render and can't
 * cause a hydration mismatch (a cold load starts with a null cache, i.e. the
 * original empty + loading behavior). Mirrors `eventsCache` in `lib/hooks.ts`.
 */
let adminModerationCache: { queue: QueueRow[]; rpcReady: boolean } | null = null;

/**
 * Admin content review (migration 0040). Two parts:
 *   • the review QUEUE — everything auto-held (Apple Intelligence, a photo/video
 *     verdict, or enough reports) or reported, with Approve / Remove and the
 *     reason it was held;
 *   • a note that wording is judged in context — the keyword blocklist was
 *     retired in 0222.
 * Shows a "run the migration" hint until `moderation_queue()` exists, like the
 * other admin panels.
 */
export function AdminModeration() {
  const [queue, setQueue] = useState<QueueRow[]>(adminModerationCache?.queue ?? []);
  // Warm cache ⇒ paint immediately (no skeleton/blank); still refetch in the
  // background below so the cached view is brought up to date.
  const [loading, setLoading] = useState(!adminModerationCache);
  // Seed rpcReady from cache: it gates the queue/blocklist vs. the "run migration
  // 0040" hint, so leaving it false on a warm remount would flash the migration
  // notice over the cached data until the background RPC resolves.
  const [rpcReady, setRpcReady] = useState(adminModerationCache?.rpcReady ?? false);
  const { busy, run } = useBusyAction();

  const load = async () => {
    const sb = supabase;
    if (!sb) return;
    // Don't flip back to `loading` here: a warm-cache remount keeps the cached
    // view painted while this refetch runs in the background (a cold load already
    // starts `loading` true from initial state).
    const q = await sb.rpc("moderation_queue");
    if (q.error) {
      setRpcReady(false);
      setLoading(false);
      return;
    }
    setRpcReady(true);
    const nextQueue = (q.data ?? []) as QueueRow[];
    setQueue(nextQueue);
    // Client-only write (inside an effect-driven fetch) — never during SSR/render.
    adminModerationCache = { queue: nextQueue, rpcReady: true };
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (row: QueueRow, status: "visible" | "hidden") => {
    const sb = supabase;
    if (!sb) return;
    const { error } = await run(row.entity_id, () =>
      sb.rpc("set_content_status", { p_entity_type: row.entity_type, p_entity_id: row.entity_id, p_status: status }),
    );
    if (error) {
      window.alert(error.message || "Couldn't update.");
      return;
    }
    setQueue((prev) => prev.filter((r) => r.entity_id !== row.entity_id));
  };

  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Content review</h2>
        {rpcReady && (
          <span className="ml-auto text-xs text-faint">
            {queue.length} {plural(queue.length, "item")} to review
          </span>
        )}
      </div>

      {!rpcReady && !loading ? (
        <MigrationHint file="0040_content_moderation.sql">
          To hold flagged posts for review,
        </MigrationHint>
      ) : loading ? (
        <SkeletonList count={2} />
      ) : (
        <>
          {queue.length === 0 ? (
            <p className="rounded-xl bg-background px-3 py-4 text-center text-xs text-muted ring-1 ring-border">
              Nothing needs review — the feed is clear. 🌲
            </p>
          ) : (
            <ul className="space-y-2">
              {queue.map((r) => (
                <li key={`${r.entity_type}-${r.entity_id}`} className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
                  <div className="flex items-center gap-2 text-xs text-faint">
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 font-medium uppercase tracking-wide">{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</span>
                    {r.status === "pending" && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700">Held</span>
                    )}
                    {r.report_count > 0 && (
                      <span className="rounded-full bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
                        {r.report_count} {plural(r.report_count, "report")}
                      </span>
                    )}
                    <span className="ml-auto">{r.author_name || "Member"}</span>
                  </div>
                  <p className="text-sm text-foreground/80">{r.body || <span className="text-faint">(no text — media only)</span>}</p>
                  {r.reasons && r.reasons.length > 0 && (
                    <p className="text-xs text-muted">Reasons: {r.reasons.join(", ")}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => decide(r, "visible")}
                      disabled={busy === r.entity_id}
                      className="press rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-primary disabled:opacity-50"
                    >
                      {busy === r.entity_id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => decide(r, "hidden")}
                      disabled={busy === r.entity_id}
                      className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-50"
                    >
                      Remove
                    </button>
                    {r.post_id && (
                      <Link href={`/posts?post=${r.post_id}`} className="press rounded-full px-3 py-1.5 text-xs font-medium text-primary">
                        View ↗
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-border pt-3 text-xs text-muted">
            Posts, comments and chat messages are read by Apple Intelligence on the media server, which
            judges the wording in context — there&rsquo;s no list of banned words. Anything it holds lands here
            with its reason, and members can still report things it missed.
          </p>
        </>
      )}
    </div>
  );
}
