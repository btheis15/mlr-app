"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { FIELD } from "@/components/Sheet";
import { fetchChatPollVoters, type ChatPoll, type ChatPollVoter } from "@/lib/chatPolls";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { formatClock } from "@/lib/format";

// An interactive poll card, rendered INLINE in the message timeline
// (CommitteeChat/HouseChat interleave these with real messages by
// createdAt) — not a pinned bar and not a sheet you have to open. Tapping an
// option votes immediately, same as texting-app polls (iMessage/Messenger).
// Option rows reuse PollsView's PollCard bar-fill visual (a live %-fill
// behind each option), extended for multi-select (every tap toggles that
// option, immediately submitted) and an inline text field for the "Other"
// write-in. When the poll isn't anonymous, a row of small avatars under each
// option shows who picked it (fetched once per card via chat_poll_voters,
// which itself refuses to return anything for an anonymous poll — this card
// never has to trust its own anonymous check).

export function ChatPollCard({
  poll,
  creatorName,
  canManage,
  onVote,
  onClosePoll,
  onDeletePoll,
}: {
  poll: ChatPoll;
  /** Resolved from the room roster; falls back to "Someone". */
  creatorName: string;
  canManage: boolean;
  /** Full-replace my selection; otherText only matters when the Other option
   *  is included in optionIds. */
  onVote: (optionIds: string[], otherText: string | null) => void;
  onClosePoll: () => void;
  onDeletePoll: () => void;
}) {
  const [voters, setVoters] = useState<ChatPollVoter[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherDraft, setOtherDraft] = useState(poll.myOtherText ?? "");

  useEffect(() => {
    if (poll.anonymous) return;
    let live = true;
    void fetchChatPollVoters(poll.id).then((v) => {
      if (live) setVoters(v);
    });
    return () => {
      live = false;
    };
  }, [poll.id, poll.anonymous, poll.respondentCount]);

  const votersByOption = useMemo(() => {
    const m: Record<string, ChatPollVoter[]> = {};
    for (const v of voters) (m[v.optionId] ??= []).push(v);
    return m;
  }, [voters]);

  const otherOption = poll.options.find((o) => o.isOther) ?? null;
  const otherSelected = !!otherOption && poll.myOptionIds.includes(otherOption.id);

  const toggleRegular = (optId: string) => {
    if (poll.isClosed) return;
    const isMine = poll.myOptionIds.includes(optId);
    const next = poll.allowMultiple
      ? isMine
        ? poll.myOptionIds.filter((id) => id !== optId)
        : [...poll.myOptionIds, optId]
      : isMine
        ? []
        : [optId];
    const nextHasOther = !!otherOption && next.includes(otherOption.id);
    onVote(next, nextHasOther ? (poll.myOtherText ?? otherDraft) : null);
  };

  const removeOther = () => {
    if (!otherOption) return;
    onVote(
      poll.myOptionIds.filter((id) => id !== otherOption.id),
      null
    );
  };

  const submitOther = () => {
    if (!otherOption) return;
    const text = otherDraft.trim();
    if (!text) return;
    const next = poll.allowMultiple
      ? [...poll.myOptionIds.filter((id) => id !== otherOption.id), otherOption.id]
      : [otherOption.id];
    onVote(next, text);
    setOtherOpen(false);
  };

  const votesLabel = `${poll.respondentCount} ${poll.respondentCount === 1 ? "response" : "responses"}`;

  return (
    <div className="w-full space-y-3 rounded-2xl bg-card p-3.5 ring-1 ring-border">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">🗳️ Poll · {creatorName}</p>
        <h3 className="mt-0.5 text-base font-bold leading-snug text-foreground">{poll.question}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {votesLabel}
          {poll.allowMultiple ? " · pick any number" : " · pick one"}
          {poll.anonymous ? " · anonymous" : ""}
          {poll.isClosed ? " · closed" : ""} · {formatClock(poll.createdAt)}
        </p>
      </div>

      <div className="space-y-2">
        {poll.options
          .filter((o) => !o.isOther)
          .map((o) => {
            const pct = poll.respondentCount ? Math.round((o.voteCount / poll.respondentCount) * 100) : 0;
            const mine = poll.myOptionIds.includes(o.id);
            const rowVoters = votersByOption[o.id] ?? [];
            return (
              <div key={o.id} className="space-y-1">
                <button
                  type="button"
                  disabled={poll.isClosed}
                  aria-pressed={mine}
                  onClick={() => toggleRegular(o.id)}
                  className={`relative w-full overflow-hidden rounded-xl bg-background px-3 py-3 text-left text-sm ring-1 ${
                    mine ? "ring-2 ring-primary/50" : "ring-border"
                  } ${poll.isClosed ? "" : "press"}`}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative flex items-center justify-between gap-2">
                    <span className="min-w-0 font-medium">
                      {mine && (
                        <span aria-label="Your vote" className="mr-1 text-primary">
                          ✓
                        </span>
                      )}
                      {o.label}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-foreground/55">
                      <AnimatedNumber value={o.voteCount} duration={400} /> ·{" "}
                      <AnimatedNumber value={pct} duration={400} format={(n) => `${Math.round(n)}%`} />
                    </span>
                  </span>
                </button>
                {!poll.anonymous && rowVoters.length > 0 && (
                  <div className="flex items-center gap-1 px-1">
                    {rowVoters.slice(0, 8).map((v) => (
                      <Avatar key={v.userId} name={v.name} url={v.avatarUrl} size={20} />
                    ))}
                    {rowVoters.length > 8 && <span className="text-xs text-muted">+{rowVoters.length - 8}</span>}
                  </div>
                )}
              </div>
            );
          })}

        {otherOption && (
          <div className="space-y-1">
            <button
              type="button"
              disabled={poll.isClosed}
              aria-pressed={otherSelected}
              onClick={() => (otherSelected ? removeOther() : setOtherOpen(true))}
              className={`relative w-full overflow-hidden rounded-xl bg-background px-3 py-3 text-left text-sm ring-1 ${
                otherSelected ? "ring-2 ring-primary/50" : "ring-border"
              } ${poll.isClosed ? "" : "press"}`}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-300"
                style={{
                  width: `${poll.respondentCount ? Math.round((otherOption.voteCount / poll.respondentCount) * 100) : 0}%`,
                }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="min-w-0 font-medium">
                  {otherSelected && (
                    <span aria-label="Your answer" className="mr-1 text-primary">
                      ✓
                    </span>
                  )}
                  Other
                  {otherSelected && poll.myOtherText && (
                    <span className="ml-1 font-normal text-foreground/60">— {poll.myOtherText}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-foreground/55">{otherOption.voteCount}</span>
              </span>
            </button>
            {!poll.anonymous && !!votersByOption[otherOption.id]?.length && (
              <div className="space-y-1 px-1">
                {votersByOption[otherOption.id].map((v) => (
                  <div key={v.userId} className="flex items-center gap-2 text-xs text-foreground/70">
                    <Avatar name={v.name} url={v.avatarUrl} size={18} />
                    <span className="font-medium">{v.name}:</span>
                    <span className="truncate">{v.otherText}</span>
                  </div>
                ))}
              </div>
            )}
            {poll.anonymous && !otherSelected && otherOption.voteCount > 0 && (
              <p className="px-1 text-xs text-muted">
                {otherOption.voteCount} write-in {otherOption.voteCount === 1 ? "answer" : "answers"} (anonymous)
              </p>
            )}
            {otherOpen && !poll.isClosed && (
              <div className="flex gap-2 px-1">
                <input
                  autoFocus
                  value={otherDraft}
                  onChange={(e) => setOtherDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitOther();
                  }}
                  placeholder="Type your answer"
                  maxLength={200}
                  className={`${FIELD} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={submitOther}
                  disabled={!otherDraft.trim()}
                  className="press shrink-0 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Vote
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!poll.isClosed && poll.myOptionIds.length === 0 && (
        <p className="text-xs text-foreground/50">
          {poll.allowMultiple ? "Tap any that apply — you can change your picks any time." : "Tap an option to vote — you can change it any time."}
        </p>
      )}

      {canManage && (
        <div className="flex gap-2 pt-1">
          {!poll.isClosed && (
            <button
              onClick={onClosePoll}
              className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-foreground/70 ring-1 ring-border"
            >
              Close poll
            </button>
          )}
          <button
            onClick={onDeletePoll}
            className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-red-600 ring-1 ring-border"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
