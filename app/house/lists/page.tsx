"use client";

import { useState } from "react";
import { HouseListsScreen } from "@/components/HouseListsScreen";

// A house's shared Lists (groceries, checklists, packing lists — migration 0169).
// Resolves the viewer's own house, or a `?house=<slug>` deep-link (read
// client-side — no dynamic route segment needed), same as /house and
// /house/calendar.
export default function HouseListsPage() {
  const [slug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null,
  );
  return <HouseListsScreen slug={slug} />;
}
