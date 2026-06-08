// Client helpers for the role tiers (see migration 0015):
//   App Admin (profiles.is_admin) > Committee Lead (committee_members.role='Lead') > Member.
// App-admin status comes from useIdentity().isAdmin; these cover the rest.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** The signed-in user's id, or null (no backend / signed out). */
export async function getCurrentUserId(): Promise<string | null> {
  const sb = supabase;
  if (!sb) return null;
  return (await sb.auth.getUser()).data.user?.id ?? null;
}

/** A public profile, name-trimmed and defaulted — the shape feeds avatars,
 *  rosters, author lines, etc. across the social features. */
export interface ProfileLite {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Fetch public profiles as the app's lightweight shape. Pass `ids` to fetch
 * just those (an empty list short-circuits to none); omit it for everyone.
 */
export async function fetchProfiles(ids?: string[]): Promise<ProfileLite[]> {
  const sb = supabase;
  if (!sb) return [];
  if (ids && ids.length === 0) return [];
  let q = sb.from("profiles").select("id, display_name, avatar_url");
  if (ids) q = q.in("id", ids);
  const { data } = await q;
  return ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({
    id: p.id,
    name: p.display_name?.trim() || "Member",
    avatarUrl: p.avatar_url ?? null,
  }));
}

/** Index profiles by id for quick name/avatar lookups. */
export function profileMap(profiles: ProfileLite[]): Map<string, ProfileLite> {
  return new Map(profiles.map((p) => [p.id, p]));
}

/**
 * My standing with a committee: "member", "pending" (requested, awaiting
 * approval), or "none". Pass `userId` to skip the auth round-trip when you
 * already know it.
 */
export async function fetchJoinState(
  committeeId: string,
  userId?: string | null,
): Promise<"member" | "pending" | "none"> {
  const sb = supabase;
  if (!sb) return "none";
  const me = userId ?? (await getCurrentUserId());
  if (!me) return "none";
  const { data: mem } = await sb
    .from("committee_members")
    .select("user_id")
    .eq("committee_id", committeeId)
    .eq("user_id", me)
    .maybeSingle();
  if (mem) return "member";
  const { data: req } = await sb
    .from("committee_join_requests")
    .select("status")
    .eq("committee_id", committeeId)
    .eq("user_id", me)
    .maybeSingle();
  return (req as { status: string } | null)?.status === "pending" ? "pending" : "none";
}

/** Resolve a committee's id from its slug (null if no backend / not found). */
export async function fetchCommitteeId(slug: string): Promise<string | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  const { data } = await sb.from("committees").select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** My role in a committee: "Lead", "member", or null (not a member / signed out). */
export async function fetchMyCommitteeRole(committeeId: string, userId?: string): Promise<"Lead" | "member" | null> {
  const sb = supabase;
  if (!sb) return null;
  // `userId` lets the admin "View as" preview ask about the previewed member's
  // role rather than the real signed-in admin's; omit it for the signed-in user.
  const uid = userId ?? (await sb.auth.getUser()).data.user?.id;
  if (!uid) return null;
  const { data } = await sb
    .from("committee_members")
    .select("role")
    .eq("committee_id", committeeId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!data) return null;
  return (data as { role: string | null }).role === "Lead" ? "Lead" : "member";
}
