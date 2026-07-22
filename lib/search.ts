// Semantic conversation search — client seam.
//
// Talks to the Mac-mini media-server's POST /search (see media-server/server.js).
// The mini embeds the query on-device (Apple NLContextualEmbedding) and runs an
// RLS-scoped similarity search AS this member (it forwards the Supabase access
// token we send here), so results are exactly what the member can already see in
// the Feed / their chats — no client-side filtering needed, and nothing leaks.
//
// "Find it without the exact words": the query is matched by meaning, so a search
// for "the plumbing problem upstairs" surfaces "leak in the second-floor
// bathroom" even with no shared words.

import { MEDIA_URL } from "@/lib/media";
import { supabase } from "@/lib/supabase";

export type SearchSourceType = "post" | "post_comment" | "committee_message" | "house_message";

export interface SearchResult {
  source_type: SearchSourceType;
  source_id: string;
  content: string;
  created_at: string;
  similarity: number;
  committee_id: string | null;
  area: string | null;
  house_id: string | null;
  post_id: string | null;
  author_id: string | null;
}

/**
 * Search everything the signed-in member can see. Returns [] when not signed in,
 * the query is too short, or search isn't reachable — callers show an empty/error
 * state, never crash. Throws only on an unexpected server error so the UI can
 * distinguish "no matches" from "search is down".
 */
export async function searchConversations(query: string, limit = 20): Promise<SearchResult[]> {
  const q = (query || "").trim();
  if (q.length < 2 || !supabase) return [];
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return [];

  const res = await fetch(`${MEDIA_URL}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ q, limit }),
  });
  if (res.status === 401) return []; // session expired mid-search — treat as no results
  if (!res.ok) {
    const msg = (await res.text().catch(() => "")).slice(0, 160);
    throw new Error(msg || `Search is unavailable (${res.status}).`);
  }
  const j = (await res.json()) as { results?: SearchResult[] };
  return Array.isArray(j.results) ? j.results : [];
}
