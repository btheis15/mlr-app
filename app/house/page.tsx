"use client";

import { useState } from "react";
import { HouseHub } from "@/components/HouseHub";

// The House Hub — everything about your house (calendar, chat, to-do list) in one
// place. A member has exactly one house, so this resolves "your house" by default;
// a `?house=<slug>` deep-link opens a specific one (read client-side so the static
// export doesn't need a dynamic route segment).
export default function HousePage() {
  const [slug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null,
  );
  return <HouseHub slug={slug} />;
}
