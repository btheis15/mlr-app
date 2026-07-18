"use client";

import { useState } from "react";
import { HouseCalendarScreen } from "@/components/HouseCalendarScreen";

// The full house calendar (month grid + agenda + resort-event overlay). Resolves
// the viewer's own house, or a `?house=<slug>` deep-link (read client-side —
// no dynamic route segment needed).
export default function HouseCalendarPage() {
  const [slug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null,
  );
  return <HouseCalendarScreen slug={slug} />;
}
