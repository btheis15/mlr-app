import { Cinzel, Playfair_Display } from "next/font/google";
import { FamilyFestNav } from "@/components/FamilyFestNav";
import { FestSectionTheme } from "@/components/FestSectionTheme";

// Roman-inscription serif for the Renaissance titles in this section. Self-hosted
// by next/font (works offline as a PWA); feeds --font-display inside
// `.ff-section` (see globals.css).
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

// The alternative display serif a fest year can pick instead (migration 0219 —
// `fest_config.theme_font`). Loaded here rather than fetched per theme because
// next/font self-hosts at build time, which is what makes the whole section work
// offline as a PWA; a runtime Google Fonts <link> chosen from a DB column would
// give up that guarantee, and be a third-party request on every fest page. Two
// display faces plus the app's own sans is enough range for a themed year
// without turning the font list into a download.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

/**
 * Family Fest is a built-in SECTION of the resort app. This layout gives the
 * whole /family-fest/* subtree its own parchment/Renaissance look (the scoped
 * `.ff-section` theme + Cinzel) and its own sticky sub-nav (FamilyFestNav:
 * Overview · Schedule · Dinners · Photos · Pay) so every fest page carries the
 * same wayfinding. The nav hides itself on the editor surfaces
 * (/family-fest/planner, /family-fest/master) — see FamilyFestNav.
 *
 * Since migration 0219 the palette/background/font are per-YEAR data layered on
 * top by `FestSectionTheme`, so a fest editor can restyle the section from the
 * Planner. Everything unset falls through to the `.ff-section` CSS below, which
 * remains the default look — so this file needs no per-year knowledge beyond
 * loading the fonts a year might choose.
 */
export default function FamilyFestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <FestSectionTheme
      className={`ff-section ${cinzel.variable} ${playfair.variable} -mx-4 min-h-[70vh] px-4 pt-2 pb-6`}
    >
      <FamilyFestNav />
      {children}
    </FestSectionTheme>
  );
}
