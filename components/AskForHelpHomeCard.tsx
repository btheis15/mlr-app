"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { RowLink } from "@/components/RowLink";

// Home entry point for "Ask for Help" (migration 0037). BETA-gated — shows only
// for Beta Testers (and hidden during an admin "view as" preview), like the
// AssistantButton. Self-hides for everyone else so Home stays lean.
export function AskForHelpHomeCard() {
  const { isBetaTester } = useIdentity();
  if (!isBetaTester) return null;
  return (
    <RowLink
      href="/help-requests"
      emoji="🙌"
      tile="bg-primary/12"
      title="Ask for Help"
      subtitle="Need a hand at the resort? Ask — or see who needs help."
    />
  );
}
