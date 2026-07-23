"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { ChatPollSheet } from "@/components/ChatPollSheet";
import { useDebouncedCallback } from "@/lib/hooks";
import {
  closeChatPoll,
  deleteChatPoll,
  fetchChatPollsForRoom,
  setChatPollVotes,
  type ChatPoll,
  type ChatPollScope,
} from "@/lib/chatPolls";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";

// The poll bar pinned at the top of a committee/house chat room (migration
// 0149), alongside MeetingSection. Unlike MeetingSection's "one featured
// meeting," polls are lighter-weight and more frequent, so every OPEN poll
// gets its own tappable pill — nothing is silently hidden — plus a collapsed
// "Past polls" disclosure for closed ones (same idiom as the app's existing
// "Archived chats"/"Previously sent" disclosures). Creating a new poll lives
// in the composer's "+" menu (CommitteeChat/HouseChat), not here; a poll
// created there shows up here on the next realtime tick.

function roomKeyOf(scope: ChatPollScope): string {
  return scope.type === "committee" ? `c:${scope.slug}|${scope.area ?? ""}` : `h:${scope.houseId}`;
}

export function ChatPollSection({ scope }: { scope: ChatPollScope }) {
  const { userId, isAdmin, previewAsId } = useIdentity();
  const roomKey = roomKeyOf(scope);

  const uidForKey = previewAsId ?? userId;
  const { data: polls, reload } = useCachedResource<ChatPoll[]>(
    uidForKey ? `chatPolls.${uidForKey}.${roomKey}` : null,
    [],
    () => fetchChatPollsForRoom(scope),
    { persist: previewAsId ? undefined : "local" }
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [schedule] = useDebouncedCallback(250);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
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

  if (!isSupabaseConfigured) return null;

  const open = polls.filter((p) => !p.isClosed);
  const past = polls.filter((p) => p.isClosed);
  const openPoll = openId ? (polls.find((p) => p.id === openId) ?? null) : null;

  if (open.length === 0 && past.length === 0 && !openPoll) return null;

  const vote = async (poll: ChatPoll, optionIds: string[], otherText: string | null) => {
    const { error } = await setChatPollVotes(poll.id, optionIds, otherText);
    if (!error) await reload();
  };

  const onClosePoll = async (poll: ChatPoll) => {
    if (!window.confirm(`Close "${poll.question}"? Voting stops and the results freeze.`)) return;
    const { error } = await closeChatPoll(poll.id);
    if (!error) await reload();
  };

  const onDeletePoll = async (poll: ChatPoll) => {
    if (!window.confirm(`Delete "${poll.question}"? This removes everyone's votes for good.`)) return;
    const { error } = await deleteChatPoll(poll.id);
    if (!error) {
      setOpenId(null);
      await reload();
    }
  };

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border bg-card px-3 py-2">
      {open.map((poll) => (
        <button
          key={poll.id}
          type="button"
          onClick={() => setOpenId(poll.id)}
          className="press flex w-full items-center gap-2.5 rounded-xl bg-primary/5 px-3 py-2 text-left ring-1 ring-primary/20"
        >
          <span aria-hidden className="text-lg">
            🗳️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{poll.question}</span>
            <span className="block truncate text-xs text-muted">
              {poll.respondentCount} {poll.respondentCount === 1 ? "response" : "responses"} · tap to vote
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-primary">
            ›
          </span>
        </button>
      ))}

      {past.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPastOpen((v) => !v)}
            className="press flex w-full items-center gap-1.5 px-1 py-1 text-xs font-semibold text-foreground/50"
          >
            <span aria-hidden>{pastOpen ? "▾" : "▸"}</span>
            Past polls ({past.length})
          </button>
          {pastOpen && (
            <div className="space-y-1.5">
              {past.map((poll) => (
                <button
                  key={poll.id}
                  type="button"
                  onClick={() => setOpenId(poll.id)}
                  className="press flex w-full items-center gap-2.5 rounded-xl bg-background px-3 py-2 text-left ring-1 ring-border"
                >
                  <span aria-hidden className="text-lg opacity-60">
                    🗳️
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground/70">{poll.question}</span>
                    <span className="block truncate text-xs text-muted">
                      {poll.respondentCount} {poll.respondentCount === 1 ? "response" : "responses"} · closed
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {openPoll && (
        <ChatPollSheet
          key={openPoll.id}
          poll={openPoll}
          canManage={isAdmin || openPoll.createdByMe}
          onClose={() => setOpenId(null)}
          onVote={(optionIds, otherText) => void vote(openPoll, optionIds, otherText)}
          onClosePoll={() => void onClosePoll(openPoll)}
          onDeletePoll={() => void onDeletePoll(openPoll)}
        />
      )}
    </div>
  );
}
