"use client";

import { useEffect } from "react";
import { festThemeStyle, type FestTheme } from "@/lib/festTheme";

/**
 * Paints one fest YEAR's look onto everything inside it (migration 0219).
 *
 * The Family Fest section gets its parchment/heraldry appearance from
 * `.ff-section` in globals.css re-declaring the CSS custom properties Tailwind's
 * utilities read. This does the same thing per year, as inline custom properties
 * — which is what makes the archive work: the fest layout wraps the whole
 * section in the CURRENT year's look, and an archived year's page re-wraps its
 * own content in ITS look. Inline styles on a descendant win, so 2026 keeps
 * looking like 2026 after 2027 repaints the hub, with no route-level special
 * casing.
 *
 * `canvas` handles the one thing a wrapper element can't reach: `<html>`'s own
 * viewport background, visible during rubber-band bounce and behind any page
 * shorter than the screen (the same problem FestThemeSync exists to solve for
 * the section as a whole). Only the CURRENT year sets it — an archive page is a
 * view of a past year *inside* the live app, and having the whole browser canvas
 * change colour while browsing history would read as a bug, not as theming.
 */
export function FestThemeScope({
  look,
  canvas = false,
  className,
  children,
}: {
  look: FestTheme | null | undefined;
  /** Also drive `<html>`'s ambient background. Current year only. */
  canvas?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const style = festThemeStyle(look);
  // Serialized so the effect's dependency is the VALUE, not a fresh object
  // identity on every render (festThemeStyle builds a new one each time).
  const canvasVars = JSON.stringify(
    CANVAS_PROPS.map((p) => [p, (style as Record<string, string | undefined>)[p] ?? null]),
  );

  useEffect(() => {
    if (!canvas) return;
    const root = document.documentElement;
    const vars = JSON.parse(canvasVars) as [string, string | null][];
    // Only the properties this year actually overrides are set. Leaving the rest
    // alone is what keeps globals.css's own parchment values in force, rather
    // than us restating them here as a second source of truth.
    const applied = vars.filter(([, v]) => v != null) as [string, string][];
    if (applied.length === 0) return;
    for (const [prop, value] of applied) root.style.setProperty(prop, value);
    return () => {
      for (const [prop] of applied) root.style.removeProperty(prop);
    };
  }, [canvasVars, canvas]);

  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

/** The subset of a year's look that also has to reach `<html>` — the canvas
 *  paints a background, nothing else. */
const CANVAS_PROPS = [
  "--ff-ambient-bg",
  "--ff-ambient-image",
  "--ff-ambient-size",
  "--ff-ambient-repeat",
  "--ff-ambient-position",
] as const;
