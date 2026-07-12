"use client";

import { useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { createPoll } from "@/lib/polls";
import { toISODate } from "@/lib/festSeason";

// Bottom-sheet composer for a new family poll (migration 0084): a question,
// 2–10 answer options (add/remove rows), and an optional closes-on date (the
// poll stays open THROUGH that day). Any signed-in member can create one —
// it's a family tool, not admin-only. Mirrors EventComposer's sheet shape.

const MAX_OPTIONS = 10;

export function PollComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called after a successful create (refresh the list). */
  onCreated: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [closesOn, setClosesOn] = useState("");
  const { pending, status, run } = useSaveStatus();

  const setOption = (i: number, v: string) =>
    setOptions((opts) => opts.map((o, idx) => (idx === i ? v : o)));
  const addOption = () =>
    setOptions((opts) => (opts.length < MAX_OPTIONS ? [...opts, ""] : opts));
  const removeOption = (i: number) =>
    setOptions((opts) => (opts.length > 2 ? opts.filter((_, idx) => idx !== i) : opts));

  const submit = () =>
    run(async () => {
      const q = question.trim();
      const labels = options.map((o) => o.trim()).filter(Boolean);
      if (!q) return "Add a question first.";
      if (labels.length < 2) return "Give people at least 2 options.";
      const res = await createPoll({ question: q, options: labels, closesOn: closesOn || null });
      if (res.error) return res.error;
      onCreated();
      close();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="poll-composer-title"
      header={
        <h2 id="poll-composer-title" className="pr-10 text-lg font-bold">
          🗳️ New poll
        </h2>
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
        <SectionLabel>Question</SectionLabel>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Which t-shirt design should we print?"
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
          <button
            type="button"
            onClick={addOption}
            className="press px-0.5 py-1 text-sm font-semibold text-primary"
          >
            + Add option
          </button>
        )}
      </div>

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
