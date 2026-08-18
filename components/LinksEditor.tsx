"use client";

import { FIELD } from "@/components/Sheet";
import type { EventLink } from "@/lib/types";

/** Editing-time shape — plain strings, so the label input stays controlled
 *  without fighting `string | null`. Convert with `cleanLinks()` at submit. */
export interface EditableLink {
  href: string;
  label: string;
}

export function toEditableLinks(links: EventLink[] | undefined): EditableLink[] {
  return (links ?? []).map((l) => ({ href: l.href, label: l.label ?? "" }));
}

/** Drops blank rows and normalizes an empty label to null for storage. */
export function cleanLinks(links: EditableLink[]): EventLink[] {
  return links.filter((l) => l.href.trim()).map((l) => ({ href: l.href.trim(), label: l.label.trim() || null }));
}

/**
 * Repeatable href+label row editor for a `links` jsonb array (migration
 * 0142, mirroring home_callouts' 0093) — lets an event carry more than one
 * click-through link (e.g. a sign-up form AND a separate info doc), each
 * rendering as its own button.
 */
export function LinksEditor({
  links,
  onChange,
  urlPlaceholder = "https://…",
  labelPlaceholder = "Button text, e.g. Sign up sheet",
  addLabel = "+ Add another link",
  showFieldLabels = false,
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
  /** Copy overrides — two bare stacked inputs are ambiguous, and the defaults
   *  here are EVENT wording ("Button text", "Sign up sheet") that reads as
   *  nonsense on, say, a purchase request. Callers outside the Fest planner
   *  should pass their own. */
  urlPlaceholder?: string;
  labelPlaceholder?: string;
  addLabel?: string;
  /** Render a small caption over each input. Worth it wherever people have
   *  reported not knowing which box is which: a placeholder vanishes the moment
   *  you type, so the FIRST field loses its only explanation exactly when the
   *  second one still has its own. Off by default so existing surfaces are
   *  visually unchanged. */
  showFieldLabels?: boolean;
}) {
  const add = () => onChange([...links, { href: "", label: "" }]);
  const update = (i: number, patch: Partial<EditableLink>) =>
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  const caption = "block text-[11px] font-semibold uppercase tracking-wide text-faint";

  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="space-y-1.5 rounded-xl bg-background p-2.5 ring-1 ring-border">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              {showFieldLabels && <span className={caption}>Web address</span>}
              <input
                value={l.href}
                onChange={(e) => update(i, { href: e.target.value })}
                placeholder={urlPlaceholder}
                inputMode="url"
                className={`${FIELD} w-full`}
              />
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove link"
              className="press shrink-0 pb-2.5 text-foreground/40 hover:text-accent"
            >
              ✕
            </button>
          </div>
          <label className="block space-y-1">
            {showFieldLabels && <span className={caption}>Name for it (optional)</span>}
            <input
              value={l.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder={labelPlaceholder}
              className={`${FIELD} w-full`}
            />
          </label>
        </div>
      ))}
      <button type="button" onClick={add} className="press text-xs font-semibold text-primary">
        {addLabel}
      </button>
    </div>
  );
}
