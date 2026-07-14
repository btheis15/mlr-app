"use client";

import type { ReactNode } from "react";

/**
 * An iOS-Settings-style grouped list: one ringed card per topic, rows
 * separated by a hairline instead of each row being its own floating card.
 * Pairs with `SettingsRow`/`SettingsToggleRow` (and `CollapsibleSection`'s
 * `bare` mode) for the rows themselves — this just supplies the card + the
 * optional uppercase group label above it.
 */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>}
      <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        {children}
      </div>
    </section>
  );
}
