"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FIELD } from "@/components/Sheet";
import { timeAgo } from "@/lib/format";
import { searchConversations, type SearchResult } from "@/lib/search";

// Minimal shapes of FeedView's Channel/HouseChannel — just what we need to label
// a result's room and let FeedView resolve navigation.
interface ChannelLite {
  key: string;
  committeeId: string;
  slug: string;
  name: string;
  emoji: string;
  area: string | null;
  title: string;
}
interface HouseLite {
  key: string;
  houseId: string;
  slug: string;
  name: string;
  emoji: string;
}

interface Props {
  channels: ChannelLite[];
  houseChannel: HouseLite | null;
  onOpenResult: (r: SearchResult) => void;
  onClose: () => void;
}

/**
 * Full-screen semantic search over everything the member can see — the resort
 * Family Feed (posts + comments), their committee/area chats, and their house
 * chat. Matches by MEANING, so you don't have to remember the exact words
 * ("plumbing upstairs" finds "leak in the second-floor bathroom"). Results are
 * already RLS-scoped by the server; this only displays and links into them.
 */
export function ConversationSearch({ channels, houseChannel, onOpenResult, onClose }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search. A monotonic seq guards against out-of-order responses.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearched(false); setError(null); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const r = await searchConversations(term, 15);
        if (my !== seq.current) return;
        setResults(r);
        setSearched(true);
      } catch (e) {
        if (my !== seq.current) return;
        setError((e instanceof Error && e.message) || "Search is unavailable right now.");
        setResults([]);
        setSearched(true);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  // Resolve author display names for the current results (members-only read; the
  // searcher is a member). Best-effort — a miss just omits the name.
  useEffect(() => {
    const ids = Array.from(new Set(results.map((r) => r.author_id).filter(Boolean))) as string[];
    const missing = ids.filter((id) => !(id in names));
    if (!missing.length || !supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase!.from("profiles").select("id, display_name").in("id", missing);
      if (cancelled || !data) return;
      setNames((prev) => {
        const next = { ...prev };
        for (const p of data as { id: string; display_name: string | null }[]) next[p.id] = p.display_name || "Member";
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const roomLabel = (r: SearchResult): { label: string; emoji: string } => {
    if (r.source_type === "post" || r.source_type === "post_comment") return { label: "Family Feed", emoji: "🏡" };
    if (r.source_type === "committee_message") {
      const ch = channels.find((c) => c.committeeId === r.committee_id && (c.area ?? "") === (r.area ?? ""));
      if (ch) return { label: ch.area ? `${ch.name} · ${ch.area}` : `${ch.name} · General`, emoji: ch.emoji || "💬" };
      return { label: "Committee chat", emoji: "💬" };
    }
    if (r.source_type === "house_message") {
      return { label: houseChannel?.name || "House chat", emoji: houseChannel?.emoji || "🏠" };
    }
    return { label: "", emoji: "💬" };
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Search conversations">
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 pb-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all conversations…"
            enterKeyHint="search"
            className={`${FIELD} pl-9`}
            aria-label="Search conversations"
          />
        </div>
        <button onClick={onClose} className="shrink-0 px-2 py-2 text-primary font-medium">Cancel</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {q.trim().length < 2 ? (
          <p className="mt-10 text-center text-sm text-faint">
            Search by meaning — you don&apos;t need the exact words.
            <br />
            Try &quot;the plumbing problem upstairs&quot; or &quot;who&apos;s bringing dessert&quot;.
          </p>
        ) : loading && !results.length ? (
          <p className="mt-10 text-center text-sm text-muted">Searching…</p>
        ) : error ? (
          <p className="mt-10 text-center text-sm text-muted">{error}</p>
        ) : searched && !results.length ? (
          <p className="mt-10 text-center text-sm text-faint">No matching messages you can see.</p>
        ) : (
          <ul className="mx-auto max-w-xl divide-y divide-border overflow-hidden rounded-xl bg-card">
            {results.map((r) => {
              const room = roomLabel(r);
              const who = r.author_id ? names[r.author_id] : undefined;
              return (
                <li key={`${r.source_type}:${r.source_id}`}>
                  <button
                    onClick={() => onOpenResult(r)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-background"
                  >
                    <span className="mt-0.5 text-lg leading-none" aria-hidden>{room.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-primary">{room.label}</span>
                        <span className="shrink-0 text-[11px] text-faint">{timeAgo(r.created_at)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-foreground">{r.content}</span>
                      {who && <span className="mt-0.5 block text-[11px] text-muted">— {who}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
