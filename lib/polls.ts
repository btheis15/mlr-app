// Client helpers for the family polls feature (migration 0084). Any member can
// ask the family a question (fest merch designs, meal choices, dates); every
// member gets one changeable vote per poll. Reads go through the Supabase
// client (members-only tables under RLS); writes go through SECURITY DEFINER
// RPCs so the one-vote / closed-poll / creator-or-admin rules live server-side.
// Everything degrades to safe no-ops with no backend, and a missing table
// (42P01 — the 0084 migration hasn't run yet) reads as "no polls", the same
// idiom as lib/resortConfig.ts / lib/roles.ts.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toISODate } from "@/lib/festSeason";

export interface PollOption {
  id: string;
  label: string;
  position: number;
  /** Live tally, computed from the poll_votes read. */
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  createdBy: string | null;
  /** True when the viewer created this poll (drives the Close/Delete buttons). */
  createdByMe: boolean;
  createdAt: string;
  /** Optional auto-close date (open THROUGH that day), ISO YYYY-MM-DD. */
  closesOn: string | null;
  /** Effective closed state: the is_closed flag OR closes_on has passed —
   *  mirrors the server check in cast_poll_vote. */
  isClosed: boolean;
  options: PollOption[];
  totalVotes: number;
  /** The option the viewer voted for, or null. */
  myOptionId: string | null;
}

type PgError = { code?: string; message?: string } | null;

/** Missing relation ⇒ the 0084 migration hasn't run yet (same 42P01 check as
 *  NotificationsView / lib/resortConfig.ts). */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface PollRow {
  id: string;
  question: string;
  created_by: string | null;
  created_at: string;
  closes_on: string | null;
  is_closed: boolean;
  poll_options: { id: string; label: string; position: number }[] | null;
}

interface VoteRow {
  poll_id: string;
  option_id: string;
  user_id: string;
}

/**
 * Every poll (newest first) with its options, live vote counts, and the
 * viewer's own pick — counts + `myOptionId` are computed client-side from one
 * poll_votes read (members-only under RLS, so a guest simply gets []). Empty
 * with no backend, pre-migration (42P01), or on any read failure — never throws.
 */
export async function fetchPolls(): Promise<Poll[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const [pollsRes, votesRes, userRes] = await Promise.all([
      sb
        .from("polls")
        .select("id, question, created_by, created_at, closes_on, is_closed, poll_options(id, label, position)")
        .order("created_at", { ascending: false }),
      sb.from("poll_votes").select("poll_id, option_id, user_id"),
      sb.auth.getUser(),
    ]);
    if (pollsRes.error) {
      if (!isMissingTable(pollsRes.error)) {
        console.warn("fetchPolls: read error", pollsRes.error.message);
      }
      return [];
    }
    const votes = (votesRes.error ? [] : (votesRes.data ?? [])) as VoteRow[];
    const uid = userRes.data.user?.id ?? null;

    // Tally per option + the viewer's pick per poll, from the one votes read.
    const countByOption: Record<string, number> = {};
    const mineByPoll: Record<string, string> = {};
    for (const v of votes) {
      countByOption[v.option_id] = (countByOption[v.option_id] ?? 0) + 1;
      if (uid && v.user_id === uid) mineByPoll[v.poll_id] = v.option_id;
    }

    const today = toISODate(new Date());
    return ((pollsRes.data ?? []) as PollRow[]).map((r) => {
      const options = (r.poll_options ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((o) => ({
          id: o.id,
          label: o.label,
          position: o.position,
          votes: countByOption[o.id] ?? 0,
        }));
      return {
        id: r.id,
        question: r.question,
        createdBy: r.created_by,
        createdByMe: !!uid && r.created_by === uid,
        createdAt: r.created_at,
        closesOn: r.closes_on,
        // Mirrors cast_poll_vote: closed by hand, or the closes-on day passed
        // (a poll stays open THROUGH its closes-on date).
        isClosed: r.is_closed || (!!r.closes_on && r.closes_on < today),
        options,
        totalVotes: options.reduce((n, o) => n + o.votes, 0),
        myOptionId: mineByPoll[r.id] ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** A poll with the viewer's vote moved to `optionId` — the optimistic local
 *  update PollsView paints before `cast_poll_vote` confirms. */
export function applyMyVote(poll: Poll, optionId: string): Poll {
  const hadVote = !!poll.myOptionId;
  const options = poll.options.map((o) => {
    let votes = o.votes;
    if (o.id === poll.myOptionId) votes = Math.max(0, votes - 1);
    if (o.id === optionId) votes += 1;
    return { ...o, votes };
  });
  return {
    ...poll,
    options,
    myOptionId: optionId,
    totalVotes: hadVote ? poll.totalVotes : poll.totalVotes + 1,
  };
}

export interface PollInput {
  question: string;
  options: string[];
  closesOn?: string | null;
}

/** Create a poll (any signed-in member; 2–10 options). Returns the new id, or
 *  an error message. */
export async function createPoll(input: PollInput): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_poll", {
    p_question: input.question,
    p_options: input.options,
    p_closes_on: input.closesOn ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Cast (or change) my vote — upserts my own row; the server rejects closed polls. */
export async function castVote(pollId: string, optionId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("cast_poll_vote", { p_poll: pollId, p_option: optionId });
  return error ? { error: error.message } : {};
}

/** Close a poll (freeze the results) — creator or admin. */
export async function closePoll(pollId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("close_poll", { p_poll: pollId });
  return error ? { error: error.message } : {};
}

/** Delete a poll (options + votes cascade) — creator or admin. */
export async function deletePoll(pollId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_poll", { p_poll: pollId });
  return error ? { error: error.message } : {};
}
