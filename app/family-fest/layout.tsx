import { Cinzel } from "next/font/google";
import { FamilyFestNav } from "@/components/FamilyFestNav";

// Roman-inscription serif for the Renaissance titles in this section. Self-hosted
// by next/font (works offline as a PWA); feeds --font-display inside
// `.ff-section` (see globals.css).
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

/**
 * Family Fest is a built-in SECTION of the resort app. This layout gives the
 * whole /family-fest/* subtree its own parchment/Renaissance look (the scoped
 * `.ff-section` theme + Cinzel) and its own sticky sub-nav (FamilyFestNav:
 * Overview · Schedule · Dinners · Photos · Pay) so every fest page carries the
 * same wayfinding. The nav hides itself on the editor surfaces
 * (/family-fest/planner, /family-fest/master) — see FamilyFestNav.
 */
export default function FamilyFestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`ff-section ${cinzel.variable} -mx-4 min-h-[70vh] px-4 pt-2 pb-6`}>
      <FamilyFestNav />
      {children}
    </div>
  );
}
