import { Cinzel } from "next/font/google";

// Roman-inscription serif for the Renaissance titles in this section. Self-hosted
// by next/font (works in static export + offline PWA); feeds --font-display
// inside `.ff-section` (see globals.css).
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

/**
 * Family Fest is a built-in SECTION of the resort app. This layout gives the
 * whole /family-fest/* subtree its own parchment/Renaissance look (the scoped
 * `.ff-section` theme + Cinzel). The section is one integrated page (today +
 * the week) plus drill-in detail pages, so there's no sub-nav — the bottom tab
 * bar and the in-page back links handle navigation.
 */
export default function FamilyFestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`ff-section ${cinzel.variable} -mx-4 min-h-[70vh] px-4 pt-4 pb-6`}>
      {children}
    </div>
  );
}
