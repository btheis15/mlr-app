// Client helpers for private activities (migration 0150) — a member-created,
// invite-only one-off get-together that lives in the Events tab and is visible
// ONLY to the people it's shared with. Anyone can create one; the creator + any
// co-hosts manage it. It can host the same tournament (lib/tournaments.ts) as a
// Family Fest activity — the tournament just hangs off `private_activity_id`.
//
// Reads go through the Supabase client (RLS scopes rows to the viewer's own
// activities); writes go through SECURITY DEFINER RPCs. Degrades to "none" with
// no backend or pre-migration (42P01) — never throws, the lib/polls.ts idiom.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type ActivityRole = "host" | "player";
export type ActivityRsvp = "going" | "maybe" | "out";

export interface PrivateActivityMember {
  id: string;
  userId: string | null;
  name: string;
  role: ActivityRole;
  rsvp: ActivityRsvp | null;
  addedBy: string | null;
  createdAt: string;
}

export interface PrivateActivity {
  id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tournamentEnabled: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  members: PrivateActivityMember[];
  /** Resolved client-side for the viewer: creator, a host, or an admin. */
  canManage: boolean;
}

type PgError = { code?: string; message?: string } | null;
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface MemberRow {
  id: string;
  user_id: string | null;
  name: string;
  role: ActivityRole;
  rsvp: ActivityRsvp | null;
  added_by: string | null;
  created_at: string;
}
interface ActivityRow {
  id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  tournament_enabled: boolean;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  private_activity_members: MemberRow[] | null;
}

function assemble(row: ActivityRow, viewerId: string | null, isAdmin: boolean): PrivateActivity {
  const members = (row.private_activity_members ?? [])
    .map(
      (m): PrivateActivityMember => ({
        id: m.id,
        userId: m.user_id,
        name: m.name,
        role: m.role,
        rsvp: m.rsvp,
        addedBy: m.added_by,
        createdAt: m.created_at,
      }),
    )
    .sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === "host" ? -1 : 1));
  const iAmHost = !!viewerId && members.some((m) => m.userId === viewerId && m.role === "host");
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tournamentEnabled: row.tournament_enabled,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    members,
    canManage: isAdmin || row.created_by === viewerId || iAmHost,
  };
}

const SELECT = "*, private_activity_members(*)";

/** Every private activity the viewer can see (RLS = creator + invited + admin),
 *  newest first. Empty with no backend / pre-migration / on any error. */
export async function fetchPrivateActivities(
  viewerId: string | null,
  isAdmin = false,
): Promise<PrivateActivity[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("private_activities")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchPrivateActivities: read error", error.message);
      return [];
    }
    return ((data ?? []) as unknown as ActivityRow[]).map((r) => assemble(r, viewerId, isAdmin));
  } catch {
    return [];
  }
}

// ── Write wrappers ────────────────────────────────────────────────────────────

type Res = { error?: string };
type IdRes = { id?: string; error?: string };

async function rpc(name: string, params: Record<string, unknown>): Promise<Res> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(name, params);
  return error ? { error: error.message } : {};
}

export interface MemberInput {
  userId?: string | null;
  name?: string | null;
}

export interface CreatePrivateActivityInput {
  title: string;
  emoji?: string | null;
  description?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  tournamentEnabled?: boolean;
  members?: MemberInput[];
  /** Ping the people added (in-app; push only for anyone who opted into it). */
  notify?: boolean;
}
export async function createPrivateActivity(input: CreatePrivateActivityInput): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_private_activity", {
    p_title: input.title,
    p_emoji: input.emoji ?? null,
    p_description: input.description ?? null,
    p_location: input.location ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_tournament_enabled: input.tournamentEnabled ?? false,
    p_members: (input.members ?? []).map((m) => ({ user_id: m.userId ?? null, name: m.name ?? null })),
    p_notify: input.notify ?? false,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

export interface UpdatePrivateActivityInput {
  title?: string;
  emoji?: string | null;
  description?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  tournamentEnabled?: boolean | null;
  clearStart?: boolean;
}
export function updatePrivateActivity(id: string, input: UpdatePrivateActivityInput): Promise<Res> {
  return rpc("update_private_activity", {
    p_activity: id,
    p_title: input.title ?? null,
    p_emoji: input.emoji ?? null,
    p_description: input.description ?? null,
    p_location: input.location ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_tournament_enabled: input.tournamentEnabled ?? null,
    p_clear_start: input.clearStart ?? false,
  });
}

export function deletePrivateActivity(id: string): Promise<Res> {
  return rpc("delete_private_activity", { p_activity: id });
}
export function setPrivateActivityArchived(id: string, archived: boolean): Promise<Res> {
  return rpc("set_private_activity_archived", { p_activity: id, p_archived: archived });
}

export async function addPrivateActivityMember(
  activityId: string,
  member: MemberInput,
  opts: { role?: ActivityRole; notify?: boolean } = {},
): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_private_activity_member", {
    p_activity: activityId,
    p_user_id: member.userId ?? null,
    p_name: member.name ?? null,
    p_role: opts.role ?? "player",
    p_notify: opts.notify ?? false,
  });
  return error ? { error: error.message } : { id: data as string };
}
export function removePrivateActivityMember(memberId: string): Promise<Res> {
  return rpc("remove_private_activity_member", { p_member: memberId });
}
export function setPrivateActivityMemberRole(memberId: string, role: ActivityRole): Promise<Res> {
  return rpc("set_private_activity_member_role", { p_member: memberId, p_role: role });
}
export function setPrivateActivityRsvp(activityId: string, rsvp: ActivityRsvp | null): Promise<Res> {
  return rpc("set_private_activity_rsvp", { p_activity: activityId, p_rsvp: rsvp });
}
