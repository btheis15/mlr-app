"use client";

// Client helpers for "quick polls" in committee/house chat rooms (migration
// 0149). Any room member can start one: a question, 2-10 options (single- or
// multi-select), an optional write-in "Other", and a choice of anonymous
// (counts only) or attributed (counts + who picked what) results. Polls
// render INLINE in the message timeline (ChatPollCard, sorted in by
// createdAt alongside real messages) rather than a separate pinned bar — a
// pinned "0 responses · tap to vote" bar at the top of the room was too easy
// to miss.
//
// Reads go through two SECURITY DEFINER RPCs rather than a plain table
// select: fetchChatPollsForRoom() (the room's poll list + your own vote —
// enough to render every card) and fetchChatPollVoters() (per-voter
// identity, called once per poll card mount, and only ever populated when
// the poll isn't anonymous). chat_poll_votes itself has no select grant at
// all — see the migration header — so there is no client path that can read
// raw vote rows. Writes go through set_chat_poll_votes/create_chat_poll/etc.
//
// Everything degrades to safe no-ops with no backend, and a missing table/
// function (42P01/42883 — the 0149 migration hasn't run yet) reads as "no
// polls" — the same idiom as lib/meetings.ts / lib/polls.ts.

import { useEffect } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { useDebouncedCallback } from "@/lib/hooks";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";

/** Which room a poll lives in — drives both the fetch filter and create args. */
export type ChatPollScope =
  | { type: "committee"; committeeId: string; slug: string; area: string | null }
  | { type: "house"; houseId: string; slug: string };

export interface ChatPollOption {
  id: string;
  label: string;
  position: number;
  isOther: boolean;
  voteCount: number;
}

export interface ChatPoll {
  id: string;
  question: string;
  allowMultiple: boolean;
  anonymous: boolean;
  allowOther: boolean;
  createdBy: string | null;
  createdByMe: boolean;
  createdAt: string;
  closesOn: string | null;
  isClosed: boolean;
  respondentCount: number;
  options: ChatPollOption[];
  /** My own selected option ids — safe to read, it's the caller's own vote. */
  myOptionIds: string[];
  myOtherText: string | null;
}

export interface ChatPollVoter {
  optionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  otherText: string | null;
}

export interface CreateChatPollInput {
  scope: ChatPollScope;
  question: string;
  options: string[];
  allowMultiple?: boolean;
  anonymous?: boolean;
  allowOther?: boolean;
  closesOn?: string | null;
}

type PgError = { code?: string; message?: string } | null;

/** Missing relation/function ⇒ the 0149 migration hasn't run yet. */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42883" ||
    /relation .* does not exist/i.test(error.message ?? "") ||
    /function .* does not exist/i.test(error.message ?? "")
  );
}

interface ChatPollRow {
  id: string;
  question: string;
  allow_multiple: boolean;
  anonymous: boolean;
  allow_other: boolean;
  created_by: string | null;
  created_by_me: boolean;
  created_at: string;
  closes_on: string | null;
  is_closed: boolean;
  respondent_count: number;
  options: { id: string; label: string; position: number; is_other: boolean; vote_count: number }[];
  my_option_ids: string[];
  my_other_text: string | null;
}

function mapRow(r: ChatPollRow): ChatPoll {
  return {
    id: r.id,
    question: r.question,
    allowMultiple: r.allow_multiple,
    anonymous: r.anonymous,
    allowOther: r.allow_other,
    createdBy: r.created_by,
    createdByMe: r.created_by_me,
    createdAt: r.created_at,
    closesOn: r.closes_on,
    isClosed: r.is_closed,
    respondentCount: r.respondent_count,
    options: (r.options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label, position: o.position, isOther: o.is_other, voteCount: o.vote_count })),
    myOptionIds: r.my_option_ids ?? [],
    myOtherText: r.my_other_text,
  };
}

/** Every poll in a room (newest first), with options/counts + the caller's
 *  own selections. Empty with no backend, pre-migration, or on any read
 *  failure — never throws. */
export async function fetchChatPollsForRoom(scope: ChatPollScope): Promise<ChatPoll[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb.rpc("fetch_chat_polls_for_room", {
      p_scope: scope.type,
      p_committee_id: scope.type === "committee" ? scope.committeeId : null,
      p_area: scope.type === "committee" ? scope.area : null,
      p_house_id: scope.type === "house" ? scope.houseId : null,
    });
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchChatPollsForRoom: read error", error.message);
      return [];
    }
    return ((data as ChatPollRow[] | null) ?? []).map(mapRow);
  } catch {
    return [];
  }
}

/** Per-voter identity for a poll's results sheet — only ever populated when
 *  the poll isn't anonymous (enforced server-side, not just by this call). */
export async function fetchChatPollVoters(pollId: string): Promise<ChatPollVoter[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb.rpc("chat_poll_voters", { p_poll: pollId });
    if (error) return [];
    return (
      (data as { option_id: string; user_id: string; name: string; avatar_url: string | null; other_text: string | null }[] | null) ?? []
    ).map((v) => ({ optionId: v.option_id, userId: v.user_id, name: v.name, avatarUrl: v.avatar_url, otherText: v.other_text }));
  } catch {
    return [];
  }
}

/** Start a poll — any room member. Returns the new id or an error message. */
export async function createChatPoll(input: CreateChatPollInput): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { scope } = input;
  const { data, error } = await sb.rpc("create_chat_poll", {
    p_scope: scope.type,
    p_committee_id: scope.type === "committee" ? scope.committeeId : null,
    p_area: scope.type === "committee" ? scope.area : null,
    p_house_id: scope.type === "house" ? scope.houseId : null,
    p_question: input.question,
    p_options: input.options,
    p_allow_multiple: input.allowMultiple ?? false,
    p_anonymous: input.anonymous ?? false,
    p_allow_other: input.allowOther ?? false,
    p_closes_on: input.closesOn ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Set (or change/clear) my votes — full-replace in one call. `otherText` is
 *  only used when the "Other" option is included in `optionIds`. */
export async function setChatPollVotes(
  pollId: string,
  optionIds: string[],
  otherText?: string | null
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_chat_poll_votes", {
    p_poll: pollId,
    p_option_ids: optionIds,
    p_other_text: otherText ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Close a poll (freeze the results) — its creator or an app admin. */
export async function closeChatPoll(pollId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("close_chat_poll", { p_poll: pollId });
  return error ? { error: error.message } : {};
}

/** Delete a poll (options + votes cascade) — its creator or an app admin. */
export async function deleteChatPoll(pollId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_chat_poll", { p_poll: pollId });
  return error ? { error: error.message } : {};
}

/** Stable per-room cache/channel segment, mirroring lib/meetings.ts's roomKeyOf. */
function roomKeyOf(scope: ChatPollScope): string {
  return scope.type === "committee" ? `c:${scope.slug}|${scope.area ?? ""}` : `h:${scope.houseId}`;
}

/**
 * Every poll in a room, kept live via realtime + the shared SWR cache — the
 * data source for the inline poll cards in CommitteeChat/HouseChat. `scope`
 * may be null while the room id hasn't resolved yet (or the room is
 * archived/read-only); the hook just no-ops in that case, so it's still safe
 * to call unconditionally (React's rules-of-hooks — the caller can't skip
 * calling this hook itself, only vary what it's given).
 */
export function useChatPolls(scope: ChatPollScope | null): { polls: ChatPoll[]; reload: () => Promise<void> } {
  const { userId, previewAsId } = useIdentity();
  const roomKey = scope ? roomKeyOf(scope) : null;
  const uidForKey = previewAsId ?? userId;

  const { data: polls, reload } = useCachedResource<ChatPoll[]>(
    scope && uidForKey ? `chatPolls.${uidForKey}.${roomKey}` : null,
    [],
    () => (scope ? fetchChatPollsForRoom(scope) : Promise.resolve([])),
    { persist: previewAsId ? undefined : "local" }
  );

  const [schedule] = useDebouncedCallback(250);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !roomKey) return;
    let channel: ReturnType<typeof sb.channel> | null = null;
    try {
      channel = sb
        .channel(`chat-polls-${roomKey}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_polls" }, () => schedule(reload))
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_poll_options" }, () => schedule(reload))
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [reload, schedule, roomKey]);

  return { polls, reload };
}
