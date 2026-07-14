"use client";

import { useState, type ReactNode } from "react";

/**
 * A titled "window" that collapses to just its header — used on the Profile
 * tab to tame the growing stack of sections. The header is the card bar; the
 * children (which bring their own cards) reveal below it when open.
 *
 * Children stay mounted while collapsed (toggled with `hidden`, not unmounted),
 * so an in-progress alert draft or unsaved contact/pay edit survives a toggle.
 * Matches the resort accordion idiom (FestWeek): press header + a chevron that
 * rotates open. Light theme only — no dark surface tints.
 *
 * `bare` drops the header's own rounded/ring/bg so it can sit as one row
 * inside a `SettingsGroup` (whose card + divider supply that instead).
 */
export function CollapsibleSection({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  bare = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: string;
  defaultOpen?: boolean;
  bare?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`press flex w-full items-center gap-3 p-4 text-left ${bare ? "" : "rounded-2xl bg-card ring-1 ring-border"}`}
      >
        {icon && (
          <span className="shrink-0 text-lg" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className={bare ? "text-sm font-medium" : "text-sm font-semibold text-accent"}>{title}</h2>
          {subtitle && (
            <p className="truncate text-xs text-muted">{subtitle}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-foreground/40 transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>

      {/* Smooth auto-height expand/collapse via the grid-rows 0fr→1fr technique
          (the one CSS-only way to animate to/from content height). The inner
          wrapper keeps overflow:hidden so content is clipped as it grows. */}
      <div
        className={`grid transition-[grid-template-rows] duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            inert={!open}
            className={`min-h-0 space-y-2 transition-opacity duration-[var(--dur-collapse)] ease-[var(--ease-ios)] motion-reduce:transition-none ${bare ? "px-4 pb-4 pt-1" : "pt-2"} ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
