"use client";

import { useState } from "react";
import { Lightbox } from "@/components/Lightbox";
import { TSHIRT_VOTE } from "@/lib/data";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatDateLong, relativeDays } from "@/lib/format";

/**
 * The in-app t-shirt vote front door. This is NOT a poll — it's a friendly way
 * to *see* the four designs big (tap any to zoom into the map detail), read who
 * made each, and understand the ranked-choice rules + deadline, before handing
 * off to the family's real Google Form (TSHIRT_VOTE.formUrl) where the vote +
 * RSVP is actually cast. One source of truth for the vote stays Rick's form.
 *
 * Lives under /family-fest so it inherits the parchment/Renaissance .ff-section
 * theme (bg-primary = heraldic wine here, so the CTA reads as the fest's color).
 */
export function ShirtVoteView() {
  const [zoom, setZoom] = useState<string | null>(null);
  const { today } = useDemoDate();

  const closed = today != null && today > TSHIRT_VOTE.deadline;
  const rel = today ? relativeDays(today, TSHIRT_VOTE.deadline) : null;
  const deadlineLong = formatDateLong(TSHIRT_VOTE.deadline);

  return (
    <div className="space-y-5">
      <header className="space-y-2 text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          ⚜ A Royal Decree ⚜
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Vote on the 2026 shirt
        </h1>
        <p className="text-sm text-foreground/70">
          Three family artists made {TSHIRT_VOTE.designs.length} designs for{" "}
          <span className="font-display">Ye Olde Family Feste</span>. Have a look,
          then rank your favorites — and lock in your headcount — in the family poll.
        </p>
      </header>

      {/* Deadline + ranked-choice — the rules, at a glance. */}
      <div className="rounded-2xl bg-primary/10 p-4 text-center ring-1 ring-primary/20">
        {closed ? (
          <p className="text-sm font-semibold text-primary">Voting has closed — thanks for weighing in! 🏆</p>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              🗳️ Ranked choice · poll closes
            </p>
            <p className="mt-1 text-lg font-bold text-primary">{deadlineLong}</p>
            {rel && rel !== "Today" && (
              <p className="text-xs text-foreground/60">{rel} — rank all four in order of favorite</p>
            )}
            {rel === "Today" && (
              <p className="text-xs font-semibold text-accent">Last day to vote!</p>
            )}
          </>
        )}
      </div>

      {/* Top CTA — the hand-off to the real poll. */}
      <VoteButton closed={closed} />

      {/* The gallery — tap any design to see it full-screen. */}
      <ol className="space-y-4">
        {TSHIRT_VOTE.designs.map((d, i) => (
          <li key={d.id}>
            <article className="overflow-hidden rounded-2xl bg-card ring-1 ring-border shadow-sm">
              <button
                type="button"
                onClick={() => setZoom(d.img)}
                className="press group relative block w-full"
                aria-label={`Enlarge ${d.name} by ${d.artist}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.img} alt={`${d.name} t-shirt design by ${d.artist}`} className="block w-full" />
                <span className="absolute left-2 top-2 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
                  Option {i + 1}
                </span>
                <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
                  🔍 Tap to enlarge
                </span>
              </button>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-lg font-bold leading-tight">{d.name}</h2>
                  <span className="shrink-0 text-xs text-foreground/55">by {d.artist}</span>
                </div>
                <p className="mt-1 text-sm text-foreground/70">{d.blurb}</p>
              </div>
            </article>
          </li>
        ))}
      </ol>

      {/* Bottom CTA + fine print — second chance to vote after browsing. */}
      <VoteButton closed={closed} />

      <p className="text-center text-xs text-foreground/55">
        The poll also confirms your <span className="font-medium">final headcount</span> and any{" "}
        <span className="font-medium">dietary restrictions</span>. Children {TSHIRT_VOTE.minVoterAge} and
        up are welcome to vote too. 🛡️
      </p>

      {zoom && <Lightbox key={zoom} url={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** The hand-off to the family's existing Google Form (opens in a new tab). */
function VoteButton({ closed }: { closed: boolean }) {
  if (closed) {
    return (
      <div className="rounded-2xl bg-card p-4 text-center text-sm font-medium text-foreground/55 ring-1 ring-border">
        The poll is closed — see you at the lake. 🏰
      </div>
    );
  }
  return (
    <a
      href={TSHIRT_VOTE.formUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="press block rounded-2xl bg-primary p-4 text-center font-semibold text-white shadow-sm"
    >
      🗳️ Open the poll to vote &amp; RSVP →
      <span className="mt-0.5 block text-xs font-normal text-white/80">
        Opens the family Google Form · rank the designs there
      </span>
    </a>
  );
}
