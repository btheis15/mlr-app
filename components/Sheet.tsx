"use client";

import type { ReactNode } from "react";

// Shared bottom-sheet scaffolding: the dimmed scrim, the slide-up panel (desktop
// pop variant), the grab handle, the round close button, and the safe-area-aware
// footer. Pair it with useSheetDismiss (lib/hooks.ts) so every sheet animates
// out the same way:
//
//   const { closing, close } = useSheetDismiss(onClose);
//   <Sheet closing={closing} onDismiss={close} labelledBy="my-title"
//          header={<h2 id="my-title">…</h2>} footer={<button>…</button>}>
//     …scrollable body…
//   </Sheet>

/** Shared field styling for inputs/selects/textareas inside sheet forms. */
export const FIELD =
  "rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";

/** The uppercase mini-label that titles each group of fields/content. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">
      {children}
    </p>
  );
}

export function Sheet({
  closing,
  onDismiss,
  labelledBy,
  header,
  footer,
  children,
}: {
  /** From useSheetDismiss — true while the close animation plays. */
  closing: boolean;
  /** Close (scrim tap, ✕, Escape is wired by useSheetDismiss). */
  onDismiss: () => void;
  /** id of the heading element inside `header` (aria-labelledby). */
  labelledBy: string;
  /** Title block — rendered in the fixed (non-scrolling) header zone. */
  header: ReactNode;
  /** Optional pinned footer (actions); gets safe-area bottom padding. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onDismiss}
    >
      <div className={`absolute inset-0 bg-black/50 ${closing ? "scrim-out" : "scrim-in"}`} aria-hidden />

      <div
        className={`relative flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl bg-background ring-1 ring-border sm:max-w-sm sm:rounded-3xl ${
          closing ? "sheet-close sm:pop-close" : "sheet-panel sm:pop-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-foreground/20 sm:hidden" aria-hidden />
          <button
            onClick={onDismiss}
            aria-label="Close"
            className="press absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-foreground/45 hover:bg-foreground/5 hover:text-foreground"
          >
            ✕
          </button>
          {header}
        </div>

        {/* Body scrolls; when there's no pinned footer the safe-area padding
            lands here so the last item clears the iPhone home indicator. */}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pt-4"
          style={{ paddingBottom: footer ? "0.5rem" : "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-border px-5 pt-3"
            style={{ paddingBottom: "max(0.85rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
