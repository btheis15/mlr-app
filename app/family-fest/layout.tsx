import { Cinzel } from "next/font/google";
import { FamilyFestNav } from "@/components/FamilyFestNav";

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
 * Family Fest is a built-in SECTION of the resort app (no separate app, no
 * "open the full app" hop). This layout gives the whole /family-fest/* subtree
 * its own parchment/Renaissance look (the scoped `.ff-section` theme) and an
 * in-section sub-nav, while the bottom tab bar + announcements stay the resort
 * chrome above it.
 */
export default function FamilyFestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`ff-section ${cinzel.variable} -mx-4 min-h-[70vh] px-4 pt-3 pb-6`}>
      <FamilyFestNav />
      <div className="pt-3">{children}</div>
    </div>
  );
}
