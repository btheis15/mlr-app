"use client";

import { useState } from "react";
import { HouseRequestsScreen } from "@/components/HouseRequestsScreen";

// A house's Requests board — ideas, purchase requests and reimbursements, with a
// House Admin's decision on each (migrations 0194–0195). Resolves the viewer's
// own house, or a `?house=<slug>` deep-link (read client-side — no dynamic route
// segment), same as /house, /house/calendar and /house/lists.
export default function HouseRequestsPage() {
  const [slug] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("house") : null,
  );
  return <HouseRequestsScreen slug={slug} />;
}
