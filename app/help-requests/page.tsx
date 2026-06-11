"use client";

import { BackLink } from "@/components/BackLink";
import { HelpRequestsView } from "@/components/HelpRequestsView";
import { useIdentity } from "@/components/IdentityProvider";

// /help-requests — the "Ask for Help" log. BETA-gated: only Beta Testers
// (profiles.beta_tester) see it, matching the AssistantButton gate. Everyone
// else gets a gentle "in beta" note. Drop the gate (render HelpRequestsView for
// all signed-in members) to take it resort-wide.
export default function HelpRequestsPage() {
  const { isBetaTester } = useIdentity();

  if (!isBetaTester) {
    return (
      <div className="space-y-4 pt-6">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl" aria-hidden>🙌</p>
          <p className="mt-2 text-sm font-semibold">Ask for Help is in beta</p>
          <p className="mt-0.5 text-xs text-foreground/55">
            We&rsquo;re testing this with a small group right now. It&rsquo;ll open up to everyone soon.
          </p>
        </div>
      </div>
    );
  }

  return <HelpRequestsView />;
}
