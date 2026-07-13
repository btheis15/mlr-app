"use client";

import { useState } from "react";
import { MjtHouseDuesScreen } from "@/components/MjtHouseDuesScreen";

// The MJT House's "calculate & pay" dues screen. Resolves the viewer's own
// house, or a `?house=<slug>` deep-link (read client-side, so the static
// export needs no dynamic route segment) — same shape as /house/calendar.
export default function HouseDuesPage() {
  const [slug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null,
  );
  return <MjtHouseDuesScreen slug={slug} />;
}
