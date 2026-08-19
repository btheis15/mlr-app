"use client";

import { FestPastYears } from "@/components/FestPastYears";
import { useUrlParam } from "@/lib/hooks";

// Past Years — the Family Fest archive. One screen switching between the list
// of past fests and one opened year via a `?year=<yyyy>` param read
// client-side (no dynamic route segment, same idiom as /drop's `?box=` and
// /house's `?house=`), so `/family-fest/past?year=2026` is a shareable link.
// Content is public-read like the rest of the fest tables, so a guest can
// browse the archive with locations/contacts masked by Guard, exactly as on the
// live hub.
export default function FestPastYearsPage() {
  const raw = useUrlParam("year");
  const parsed = raw ? Number(raw) : NaN;
  // A junk ?year= (…?year=abc) must read as "no year picked" → the index, not a
  // detail page for NaN.
  const year = Number.isInteger(parsed) ? parsed : null;
  return <FestPastYears year={year} />;
}
