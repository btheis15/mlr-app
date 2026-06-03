// Client helpers for the role tiers (see migration 0015):
//   App Admin (profiles.is_admin) > Committee Lead (committee_members.role='Lead') > Member.
// App-admin status comes from useIdentity().isAdmin; these cover the rest.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Resolve a committee's id from its slug (null if no backend / not found). */
export async function fetchCommitteeId(slug: string): Promise<string | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  const { data } = await sb.from("committees").select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** My role in a committee: "Lead", "member", or null (not a member / signed out). */
export async function fetchMyCommitteeRole(committeeId: string): Promise<"Lead" | "member" | null> {
  const sb = supabase;
  if (!sb) return null;
  const me = (await sb.auth.getUser()).data.user?.id;
  if (!me) return null;
  const { data } = await sb
    .from("committee_members")
    .select("role")
    .eq("committee_id", committeeId)
    .eq("user_id", me)
    .maybeSingle();
  if (!data) return null;
  return (data as { role: string | null }).role === "Lead" ? "Lead" : "member";
}
