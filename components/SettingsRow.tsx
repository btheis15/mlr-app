"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Switch } from "@/components/Switch";

/**
 * A single row inside a `SettingsGroup` — no ring/rounded/shadow of its own
 * (the group's card + divider supply that), just the leading emoji, a
 * title/subtitle, and trailing content (a chevron by default, or whatever's
 * passed). Renders as a `<Link>` when `href` is given, otherwise a `<button>`
 * (pass `onClick`), or a plain row when neither is given (e.g. the trailing
 * slot is itself the interactive control, like `SettingsToggleRow` below).
 */
export function SettingsRow({
  icon,
  title,
  subtitle,
  href,
  onClick,
  trailing,
  chevron = true,
}: {
  icon?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  const content = (
    <>
      {icon && (
        <span className="shrink-0 text-lg" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {subtitle && <span className="mt-0.5 block text-xs text-muted">{subtitle}</span>}
      </span>
      {trailing ?? (chevron && (href || onClick) ? (
        <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>
          ›
        </span>
      ) : null)}
    </>
  );

  const rowClass = "flex w-full items-center gap-3 p-4 text-left";

  if (href) {
    return (
      <Link href={href} className={`press ${rowClass}`}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`press ${rowClass}`}>
        {content}
      </button>
    );
  }
  return <div className={rowClass}>{content}</div>;
}

/** A `SettingsRow` whose trailing control is a `Switch` — the on/off row shape used for Email alerts, Willing to help, push categories, etc. */
export function SettingsToggleRow({
  icon,
  title,
  subtitle,
  on,
  busy,
  onToggle,
}: {
  icon?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      trailing={<Switch on={on} busy={busy} onClick={onToggle} label={typeof title === "string" ? title : "Toggle"} />}
    />
  );
}
