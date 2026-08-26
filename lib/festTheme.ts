// Per-year Family Fest LOOK — the palette, the section background, and the
// display font, as data instead of CSS (migration 0219).
//
// The Family Fest section has always had its own look: `.ff-section` in
// app/globals.css re-declares the same CSS custom properties Tailwind's
// utilities read, so every `bg-`, `text-`, `ring-` and `border-` class inside
// the section renders parchment + heraldry while the rest of the resort app
// stays forest-green. That's still the DEFAULT — and the fallback — but it was
// also the only possibility, which is wrong for a gathering whose whole
// identity changes every year ("Ye Olde Family Feste" is a 2026 idea).
//
// So a fest year may override any of those variables. The rules that make this
// safe to hand to a non-designer:
//
//  * **Null means "use the built-in look".** Every field is optional and an
//    unset one emits NOTHING — not a copy of the default hex. That keeps one
//    source of truth for the default (the stylesheet), lets the Display-P3
//    `@supports` upgrade in globals.css keep applying to unstyled years, and
//    means a year that only picks a primary colour still gets a coherent theme.
//  * **Applied as INLINE custom properties on a wrapper element**, so it
//    cascades to everything inside and nests: the fest layout applies the
//    CURRENT year's theme, and an archive page re-applies its OWN year's over
//    the top (inline styles on a descendant win). That's what lets 2026 keep
//    looking like 2026 after 2027 repaints the hub.
//  * **Hex is validated here as well as in SQL.** These strings end up inside a
//    style attribute; `#8b2e2e; background: url(evil)` must never survive the
//    trip. The DB has a matching CHECK (0219) — this half also guards the render
//    of a row written before that constraint existed.
//
// ⚠️ Colours are LIGHT-MODE values. The whole app is light (there is no dark
// theme), and `.ff-section` is documented as light-only because parchment is a
// light surface. A palette editor that let someone pick a near-black background
// would produce dark cards with dark text, so `contrastWarnings()` below is
// surfaced in the Planner rather than clamping the choice: the family gets to
// pick, but it tells them when a pair is unreadable.

import type { CSSProperties } from "react";

/** A fest year's look. Every field optional — null/undefined = the built-in. */
export interface FestTheme {
  primary?: string | null;
  accent?: string | null;
  background?: string | null;
  card?: string | null;
  border?: string | null;
  ink?: string | null;
  bgStyle?: FestBgStyle | null;
  bgImageUrl?: string | null;
  bgImageMode?: FestBgImageMode | null;
  bgImageOpacity?: number | null;
  font?: FestFont | null;
}

export type FestBgStyle = "default" | "flat" | "image";
export type FestBgImageMode = "cover" | "tile";
export type FestFont = "cinzel" | "playfair" | "sans";

/**
 * The built-in values, mirrored from `.ff-section` in app/globals.css.
 *
 * ⚠️ These are for the EDITOR ONLY — the swatch a colour input has to show
 * before anything is picked (`<input type="color">` has no "unset" state), and
 * the baseline the contrast check reads. Nothing renders from them: an unset
 * field emits no custom property at all, so the stylesheet stays the single
 * source of truth for what the default actually is. If you change a hex in
 * globals.css, change it here too — the only cost of drift is a colour picker
 * opening on a slightly stale swatch.
 */
export const FEST_LOOK_DEFAULTS = {
  primary: "#8b2e2e", // heraldic wine (gules)
  accent: "#1e3a8a", // heraldic azure
  background: "#f4ecd8", // aged parchment
  card: "#fdfaf1", // light vellum
  border: "#d8c7a3", // tan / vellum hairline
  ink: "#3a2a18", // sepia ink
} as const;

/** The parchment ambient wash `.ff-section` paints by default — reproduced here
 *  so a year that overrides its background colour but keeps `bgStyle: default`
 *  gets the same layered gradient tinted to ITS colour rather than snapping to
 *  a flat fill. */
function ambientWash(bg: string): string {
  return [
    "radial-gradient(120% 80% at 50% 0%, rgba(0, 0, 0, 0.04), transparent 55%)",
    "radial-gradient(125% 90% at 50% 100%, rgba(0, 0, 0, 0.09), transparent 55%)",
    `linear-gradient(180deg, ${bg} 0%, ${bg} 100%)`,
  ].join(", ");
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A usable six-digit hex, or null. The gate for anything reaching a style. */
export function hexOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return HEX.test(s) ? s : null;
}

/** A URL safe to drop in `url(...)`: http(s) only, and no quote/paren/backslash
 *  that could break out of the CSS function. Rejects `javascript:` and `data:`
 *  outright — a fest backdrop is always an uploaded file with an http(s) URL,
 *  so nothing legitimate is lost by refusing the schemes that aren't. */
export function cssUrlOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s || !/^https?:\/\//i.test(s)) return null;
  if (/["'()\\\s]/.test(s)) return null;
  return s;
}

/**
 * The inline style for a fest year's look — only the properties it actually
 * overrides. Spread onto the element that wraps the fest content.
 *
 * `--ff-*` are this module's own variables (read by the CSS below); the
 * `--color-*` / `--font-display` ones are the SAME variables Tailwind's
 * utilities read, which is what makes a single object repaint the whole section.
 */
export function festThemeStyle(t: FestTheme | null | undefined): CSSProperties {
  if (!t) return {};
  const style: Record<string, string> = {};
  const bg = hexOrNull(t.background);
  const set = (prop: string, hex: string | null) => {
    if (hex) style[prop] = hex;
  };

  set("--color-primary", hexOrNull(t.primary));
  set("--color-accent", hexOrNull(t.accent));
  set("--color-card", hexOrNull(t.card));
  set("--color-border", hexOrNull(t.border));
  set("--color-foreground", hexOrNull(t.ink));
  set("--color-background", bg);

  const style_ = t.bgStyle ?? "default";
  const url = cssUrlOrNull(t.bgImageUrl);

  if (style_ === "image" && url) {
    // The photo sits UNDER a wash of the background colour, at the chosen
    // strength — a full-bleed photo behind body text is unreadable at any
    // opacity, and letting someone dial it to 100% is the point where "custom
    // background" stops being usable. The colour layer is what keeps the cards
    // legible; the photo is atmosphere.
    const strength = clampOpacity(t.bgImageOpacity);
    const veil = bg ?? FEST_LOOK_DEFAULTS.background;
    style["--ff-ambient-image"] =
      `linear-gradient(${rgbaVeil(veil, 1 - strength)}, ${rgbaVeil(veil, 1 - strength)}), url("${url}")`;
    style["--ff-ambient-size"] = t.bgImageMode === "tile" ? "auto, 320px" : "auto, cover";
    style["--ff-ambient-repeat"] = t.bgImageMode === "tile" ? "no-repeat, repeat" : "no-repeat, no-repeat";
    style["--ff-ambient-position"] = "center, center";
    if (bg) style["--ff-ambient-bg"] = bg;
  } else if (style_ === "flat") {
    style["--ff-ambient-image"] = "none";
    if (bg) style["--ff-ambient-bg"] = bg;
  } else if (bg) {
    // Keep the layered wash, retinted to this year's colour.
    style["--ff-ambient-image"] = ambientWash(bg);
    style["--ff-ambient-bg"] = bg;
  }

  if (t.font === "playfair") style["--font-display"] = "var(--font-playfair), Georgia, serif";
  else if (t.font === "sans") style["--font-display"] = "var(--font-sans, ui-sans-serif), system-ui, sans-serif";
  // "cinzel" (and null) leave the stylesheet's own --font-display alone.

  return style as CSSProperties;
}

/** 0–100 → 0–1, defaulting to a legible 35% when unset. */
function clampOpacity(v: number | null | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 35;
  return Math.min(100, Math.max(0, n)) / 100;
}

/** `#rrggbb` + alpha → `rgba(...)`, for the veil over a backdrop photo. */
function rgbaVeil(hex: string, alpha: number): string {
  const h = hexOrNull(hex) ?? FEST_LOOK_DEFAULTS.background;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
}

// ── Presets ───────────────────────────────────────────────────────────────────
// One tap has to produce something that looks deliberate, because the person
// setting up next year's fest is a family volunteer, not a designer — and
// "customizable" that only works if you already know which six hexes go
// together isn't customizable. Each preset is a complete, contrast-checked set;
// the individual pickers are there for tuning afterwards.

export interface FestPreset {
  key: string;
  name: string;
  blurb: string;
  theme: FestTheme;
}

export const FEST_PRESETS: FestPreset[] = [
  {
    key: "parchment",
    name: "Parchment & Heraldry",
    blurb: "The Renaissance look from 2026 — aged parchment, heraldic wine and azure.",
    // All-null on purpose: this preset IS the built-in look, and writing the
    // hexes out would opt the year out of the wide-gamut upgrade for nothing.
    theme: { bgStyle: "default", font: "cinzel" },
  },
  {
    key: "northwoods",
    name: "Northwoods Pine",
    blurb: "The resort's own forest green and campfire orange, on birch.",
    theme: {
      primary: "#15503a",
      accent: "#c2410c",
      background: "#f4f1e8",
      card: "#ffffff",
      border: "#ddd6c4",
      ink: "#26301f",
      bgStyle: "default",
      font: "sans",
    },
  },
  {
    key: "lakeside",
    name: "Lakeside Summer",
    blurb: "Lake teal and sun-bleached dock, bright and warm.",
    theme: {
      primary: "#0f6d80",
      accent: "#b45309",
      background: "#eef7f8",
      card: "#ffffff",
      border: "#c9dfe3",
      ink: "#173038",
      bgStyle: "default",
      font: "playfair",
    },
  },
  {
    key: "campfire",
    name: "Campfire Dusk",
    blurb: "Deep violet dusk with an ember glow — the late-evening look.",
    theme: {
      primary: "#5b2a86",
      accent: "#c2410c",
      background: "#f6f1fa",
      card: "#ffffff",
      border: "#ddd0e8",
      ink: "#2b1f38",
      bgStyle: "default",
      font: "playfair",
    },
  },
  {
    key: "carnival",
    name: "Carnival Stripes",
    blurb: "Big-top red and gold — loud, for a fair-themed year.",
    theme: {
      primary: "#b91c1c",
      accent: "#0f766e",
      background: "#fff8ec",
      card: "#ffffff",
      border: "#f0dcbb",
      ink: "#3b2415",
      bgStyle: "default",
      font: "cinzel",
    },
  },
];

// ── Readability check ─────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const n = parseInt((hexOrNull(hex) ?? "#000000").slice(1), 16);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** WCAG contrast ratio between two hexes (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Plain-English warnings for a palette — shown live in the Planner, never
 * enforced. The family picks the look; this only makes sure nobody ships a year
 * whose text they can't read, which is the one failure mode a colour picker
 * invites and a preview alone doesn't catch (the editor's own screen, at full
 * brightness, is the best case).
 *
 * 4.5:1 is the WCAG AA floor for body text; 3:1 is the large-text/UI floor,
 * which is the right bar for a button fill or a heading.
 */
export function contrastWarnings(t: FestTheme): string[] {
  const v = (k: keyof typeof FEST_LOOK_DEFAULTS) => hexOrNull(t[k]) ?? FEST_LOOK_DEFAULTS[k];
  const out: string[] = [];
  const pairs: [string, string, number, string][] = [
    [v("ink"), v("card"), 4.5, "Body text on cards is hard to read — darken the text colour or lighten the card."],
    [v("ink"), v("background"), 4.5, "Text on the background is hard to read — try a lighter background."],
    [v("primary"), v("card"), 3, "Headings and buttons barely show against cards — deepen the main colour."],
    [v("accent"), v("card"), 3, "The accent colour barely shows against cards — deepen it."],
    ["#ffffff", v("primary"), 3, "White button text won't read on the main colour — pick a darker main colour."],
  ];
  for (const [a, b, floor, message] of pairs) {
    if (contrastRatio(a, b) < floor) out.push(message);
  }
  return out;
}

/**
 * Whether a year has been through the Look editor at all — ANY field written,
 * including the ones whose value happens to match the built-in.
 *
 * Distinct from `hasCustomLook` on purpose, and the distinction is what keeps
 * the hub's set-up checklist finishable. "Parchment & Heraldry" — the 2026 look
 * — is a legitimate choice for a new year, and it's stored as all-nulls-plus-
 * `bgStyle: 'default'` because writing today's hexes out would freeze the year
 * onto sRGB and duplicate the stylesheet. Judged by `hasCustomLook` that choice
 * is indistinguishable from never having looked, so the checklist row would
 * never tick and the card would become permanent furniture on the hub.
 */
export function hasChosenLook(t: FestTheme | null | undefined): boolean {
  if (!t) return false;
  return Boolean(
    hexOrNull(t.primary) ||
      hexOrNull(t.accent) ||
      hexOrNull(t.background) ||
      hexOrNull(t.card) ||
      hexOrNull(t.border) ||
      hexOrNull(t.ink) ||
      t.bgStyle ||
      cssUrlOrNull(t.bgImageUrl) ||
      t.font,
  );
}

/** Whether a year's look actually DIFFERS from the built-in — drives the
 *  Planner's "using the built-in look" note and its reset button. */
export function hasCustomLook(t: FestTheme | null | undefined): boolean {
  if (!t) return false;
  return Boolean(
    hexOrNull(t.primary) ||
      hexOrNull(t.accent) ||
      hexOrNull(t.background) ||
      hexOrNull(t.card) ||
      hexOrNull(t.border) ||
      hexOrNull(t.ink) ||
      (t.bgStyle && t.bgStyle !== "default") ||
      cssUrlOrNull(t.bgImageUrl) ||
      (t.font && t.font !== "cinzel"),
  );
}
