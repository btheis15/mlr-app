"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MigrationHint } from "@/components/MigrationHint";
import { useBusyAction } from "@/lib/hooks";
import { plural } from "@/lib/format";

interface QueueRow {
  entity_type: "post" | "comment";
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

interface BlockRow {
  id: string;
  pattern: string;
  note: string | null;
}

/**
 * Admin content review (migration 0040). Two parts:
 *   • the review QUEUE — every post/comment that was auto-held (blocked term or
 *     enough reports) or reported, with Approve / Remove;
 *   • the BLOCKLIST — admin-managed terms that auto-hold matching text.
 * Shows a "run the migration" hint until `moderation_queue()` exists, like the
 * other admin panels.
 */
export function AdminModeration() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [block, setBlock] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rpcReady, setRpcReady] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const { busy, run } = useBusyAction();

  const load = async () => {
    const sb = supabase;
    if (!sb) return;
    setLoading(true);
    const q = await sb.rpc("moderation_queue");
    if (q.error) {
      setRpcReady(false);
      setLoading(false);
      return;
    }
    setRpcReady(true);
    setQueue((q.data ?? []) as QueueRow[]);
    const b = await sb.from("moderation_blocklist").select("id, pattern, note").order("pattern");
    setBlock((b.data ?? []) as BlockRow[]);
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

  const addTerm = async () => {
    const sb = supabase;
    const pattern = newTerm.trim();
    if (!sb || !pattern) return;
    const { data, error } = await sb
      .from("moderation_blocklist")
      .insert({ pattern })
      .select("id, pattern, note")
      .single();
    if (error) {
      window.alert(error.message || "Couldn't add the term.");
      return;
    }
    setBlock((prev) => [...prev, data as BlockRow].sort((a, b) => a.pattern.localeCompare(b.pattern)));
    setNewTerm("");
  };

  const removeTerm = async (id: string) => {
    const sb = supabase;
    if (!sb) return;
    await sb.from("moderation_blocklist").delete().eq("id", id);
    setBlock((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Content review</h2>
        {rpcReady && (
          <span className="ml-auto text-xs text-foreground/45">
            {queue.length} {plural(queue.length, "item")} to review
          </span>
        )}
      </div>

      {!rpcReady && !loading ? (
        <MigrationHint file="0040_content_moderation.sql">
          To hold flagged posts for review and manage the blocklist,
        </MigrationHint>
      ) : loading ? (
        <p className="py-3 text-center text-xs text-foreground/45">Loading…</p>
      ) : (
        <>
          {queue.length === 0 ? (
            <p className="rounded-xl bg-background px-3 py-4 text-center text-xs text-foreground/55 ring-1 ring-border">
              Nothing needs review — the feed is clear. 🌲
            </p>
          ) : (
            <ul className="space-y-2">
              {queue.map((r) => (
                <li key={`${r.entity_type}-${r.entity_id}`} className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
                  <div className="flex items-center gap-2 text-[11px] text-foreground/45">
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 font-medium uppercase tracking-wide">{r.entity_type}</span>
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
                  <p className="text-sm text-foreground/80">{r.body || <span className="text-foreground/40">(no text — media only)</span>}</p>
                  {r.reasons && r.reasons.length > 0 && (
                    <p className="text-[11px] text-foreground/50">Reasons: {r.reasons.join(", ")}</p>
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

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-foreground/70">Blocked words</p>
            <p className="text-[11px] text-foreground/50">
              A post or comment containing one of these is automatically held for review. Matching is
              case-insensitive. Nothing is shipped here by default — add what fits your family.
            </p>
            <div className="flex gap-2">
              <input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTerm()}
                placeholder="Add a word or phrase…"
                className="flex-1 rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={addTerm}
                disabled={!newTerm.trim()}
                className="press shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {block.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {block.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs text-foreground/70 ring-1 ring-border">
                    {b.pattern}
                    <button onClick={() => removeTerm(b.id)} aria-label={`Remove ${b.pattern}`} className="press text-foreground/40 hover:text-accent">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
