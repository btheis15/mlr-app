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
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
}) {
  const add = () => onChange([...links, { href: "", label: "" }]);
  const update = (i: number, patch: Partial<EditableLink>) =>
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="space-y-1.5 rounded-xl bg-background p-2.5 ring-1 ring-border">
          <div className="flex items-center gap-2">
            <input
              value={l.href}
              onChange={(e) => update(i, { href: e.target.value })}
              placeholder="https://…"
              inputMode="url"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove link"
              className="press shrink-0 text-foreground/40 hover:text-accent"
            >
              ✕
            </button>
          </div>
          <input
            value={l.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Button text, e.g. Sign up sheet"
            className={`${FIELD} w-full`}
          />
        </div>
      ))}
      <button type="button" onClick={add} className="press text-xs font-semibold text-primary">
        + Add another link
      </button>
    </div>
  );
}
