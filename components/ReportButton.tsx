"use client";

import { useState } from "react";
import { reportContent, REPORT_REASONS, type ReportEntity } from "@/lib/moderation";

/**
 * A small "Report" affordance for a post or comment. Tapping opens a short list
 * of reasons; choosing one calls the `report_content` RPC (which dedups and
 * auto-holds an item once enough members flag it). Guests are routed to sign-in
 * first — reporting is tied to identity so it can't be abused anonymously.
 *
 * `variant="post"` is a labeled pill (post action row); `variant="comment"` is
 * a quiet ⚑ icon (inline with a comment).
 */
export function ReportButton({
  entity,
  entityId,
  needsSignIn,
  variant = "post",
}: {
  entity: ReportEntity;
  entityId: string;
  needsSignIn: () => boolean; // returns true if it handled a guest (stop)
  variant?: "post" | "comment";
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const choose = async (reason: string) => {
    setBusy(true);
    setErr(null);
    const msg = await reportContent(entity, entityId, reason);
    setBusy(false);
    if (msg) {
      setErr(msg);
      return;
    }
    setOpen(false);
    setDone(true);
  };

  if (done) {
    return (
      <span className={variant === "comment" ? "shrink-0 text-[11px] text-foreground/40" : "px-3 py-1.5 text-xs text-foreground/45"}>
        Reported ✓
      </span>
    );
  }

  const trigger = (
    <button
      type="button"
      onClick={() => {
        if (needsSignIn()) return;
        setOpen((o) => !o);
      }}
      aria-label="Report this"
      className={
        variant === "comment"
          ? "press shrink-0 text-foreground/30 hover:text-accent"
          : "press rounded-full px-3 py-1.5 text-xs font-medium text-foreground/45 hover:text-accent"
      }
    >
      {variant === "comment" ? "⚑" : "⚑ Report"}
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="relative inline-block">
      {trigger}
      <div className="absolute right-0 z-10 mt-1 w-52 space-y-1 rounded-xl bg-card p-1.5 text-left shadow-lg ring-1 ring-border">
        <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Report — why?</p>
        {REPORT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            disabled={busy}
            onClick={() => choose(r)}
            className="press block w-full rounded-lg px-2 py-1.5 text-left text-xs text-foreground/75 hover:bg-background disabled:opacity-50"
          >
            {r}
          </button>
        ))}
        {err && <p className="px-2 py-1 text-[11px] text-accent">{err}</p>}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="press block w-full rounded-lg px-2 py-1.5 text-left text-xs text-foreground/45"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
