// Build-time list of committee slugs for the static-export dynamic routes
// (`/committees/[slug]` + `/committees/[slug]/chat`). Unions the in-code seed
// with the live DB committees so admin-created committees (migration 0112) get a
// prerendered page too. Runs in Node during `next build`; a plain REST fetch (no
// supabase-js browser client) keeps it robust there, and it always falls back to
// the seed so a missing backend / network hiccup can never fail the build.

import { COMMITTEES } from "@/lib/data";

export async function committeeSlugParams(): Promise<{ slug: string }[]> {
  const slugs = new Set<string>(COMMITTEES.map((c) => c.slug));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/committees?select=slug`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const rows = (await res.json()) as { slug: string }[];
        for (const r of rows) if (r?.slug) slugs.add(r.slug);
      }
    } catch {
      /* fall back to the seed slugs — never fail the build */
    }
  }
  return Array.from(slugs).map((slug) => ({ slug }));
}
