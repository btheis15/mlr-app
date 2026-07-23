"use client";

import { useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { createChatPoll, type ChatPollScope } from "@/lib/chatPolls";
import { toISODate } from "@/lib/festSeason";

// Bottom-sheet composer for a quick poll in a committee/house chat (migration
// 0149) — question, 2–10 options (add/remove rows, same UX as the family
// PollComposer), single- vs multi-select, an optional "Other" write-in slot,
// an anonymous-results toggle, and an optional closes-on date. Any room member
// can start one (the family-polls doctrine, not the meeting-organizer one).

const MAX_OPTIONS = 10;

export function ChatPollComposer({
  scope,
  roomLabel,
  onClose,
  onCreated,
}: {
  scope: ChatPollScope;
  /** e.g. "Meals" or "MJT House" — shown in the header for context. */
  roomLabel: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [allowOther, setAllowOther] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [closesOn, setClosesOn] = useState("");
  const { pending, status, run } = useSaveStatus();

  const setOption = (i: number, v: string) => setOptions((opts) => opts.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((opts) => (opts.length < MAX_OPTIONS ? [...opts, ""] : opts));
  const removeOption = (i: number) => setOptions((opts) => (opts.length > 2 ? opts.filter((_, idx) => idx !== i) : opts));

  const submit = () =>
    run(async () => {
      const q = question.trim();
      const labels = options.map((o) => o.trim()).filter(Boolean);
      if (!q) return "Add a question first.";
      if (labels.length < 2) return "Give people at least 2 options.";
      const res = await createChatPoll({
        scope,
        question: q,
        options: labels,
        allowMultiple,
        anonymous,
        allowOther,
        closesOn: closesOn || null,
      });
      if (res.error) return res.error;
      onCreated();
      close();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="chat-poll-composer-title"
      header={
        <div className="pr-10">
          <h2 id="chat-poll-composer-title" className="text-lg font-bold">
            🗳️ New poll
          </h2>
          <p className="mt-0.5 text-xs text-muted">For {roomLabel}</p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {status && <p className="text-sm font-medium text-red-600">{status}</p>}
          <button
            onClick={submit}
            disabled={pending}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Creating…" : "Start the poll"}
          </button>
        </div>
      }
    >
      <div className="space-y-1.5">
        <SectionLabel>What's this poll for?</SectionLabel>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Pizza or tacos for the work weekend?"
          maxLength={300}
          className={`${FIELD} w-full`}
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Options (2–{MAX_OPTIONS})</SectionLabel>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                maxLength={100}
                className={`${FIELD} min-w-0 flex-1`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label={`Remove option ${i + 1}`}
                  className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/45 hover:bg-foreground/5 hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button type="button" onClick={addOption} className="press px-0.5 py-1 text-sm font-semibold text-primary">
            + Add option
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1 ring-1 ring-border">
        {(
          [
            { v: false, label: "Pick one", sub: "Single choice" },
            { v: true, label: "Pick multiple", sub: "Choose any number" },
          ] as const
        ).map(({ v, label, sub }) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setAllowMultiple(v)}
            aria-pressed={allowMultiple === v}
            className={`press rounded-lg px-2 py-2 text-center ${allowMultiple === v ? "bg-primary text-white" : "text-foreground/60"}`}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className={`block text-[11px] ${allowMultiple === v ? "text-white/80" : "text-muted"}`}>{sub}</span>
          </button>
        ))}
      </div>

      <label className="flex items-start gap-2.5 rounded-xl bg-background p-3 ring-1 ring-border">
        <input
          type="checkbox"
          checked={allowOther}
          onChange={(e) => setAllowOther(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">✏️ Include an "Other" option</span>
          <span className="block text-xs text-muted">Lets someone write in their own answer instead of picking one of yours.</span>
        </span>
      </label>

      <label className="flex items-start gap-2.5 rounded-xl bg-background p-3 ring-1 ring-border">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">🙈 Anonymous results</span>
          <span className="block text-xs text-muted">Everyone sees the totals, but not who picked what.</span>
        </span>
      </label>

      <div className="space-y-1.5">
        <SectionLabel>Closes on (optional)</SectionLabel>
        <input
          type="date"
          value={closesOn}
          min={toISODate(new Date())}
          onChange={(e) => setClosesOn(e.target.value)}
          className={`${FIELD} w-full`}
        />
        <p className="px-0.5 text-xs text-foreground/50">
          Voting stays open through that day. Leave it blank to close the poll yourself later.
        </p>
      </div>
    </Sheet>
  );
}
