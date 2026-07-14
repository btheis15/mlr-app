// A member marking a Home callout "done" (migration 0098) — permanent,
// cross-session, cross-device, unlike CalloutStack's swipe/✕ dismiss (which
// only hides it for the current session; it comes back next time the app
// opens). Own-row RLS does the authorization; no RPC needed.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Callout ids the given (signed-in) user has marked done. Empty for a guest
 *  (nothing to attach it to) or with no backend. */
export async function fetchMyCalloutCompletions(userId?: string | null): Promise<Set<string>> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !userId) return new Set();
  const { data } = await sb.from("home_callout_completions").select("callout_id").eq("user_id", userId);
  return new Set(((data ?? []) as { callout_id: string }[]).map((r) => r.callout_id));
}

/** Mark one done for this user. Upserted (ignoring a duplicate) so a
 *  double-tap before the card disappears can't trip a unique-violation error. */
export async function markCalloutDone(calloutId: string, userId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("home_callout_completions")
    .upsert({ callout_id: calloutId, user_id: userId }, { onConflict: "callout_id,user_id", ignoreDuplicates: true });
  return error ? { error: error.message } : {};
}
