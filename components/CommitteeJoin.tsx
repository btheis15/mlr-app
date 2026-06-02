"use client";

import { useState } from "react";
import { READ_ONLY } from "@/lib/features";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { useIdentity } from "@/components/IdentityProvider";
import type { Committee } from "@/lib/types";

/**
 * "Interested in joining?" card on each committee page. Two ways to reach the
 * Lead, both pre-filled with a ready-to-send message so it's one tap:
 *  - Email / Text the Lead now — works today, no backend.
 *  - Request to join in the app — the in-app request → Lead-approves → added
 *    loop. That needs cross-device state (Supabase), so under READ_ONLY it
 *    shows a "coming soon" affordance; the gated branch below is the seam where
 *    the real join request + the Lead's approval queue wire in (NEXT-STEPS §5c).
 */
export function CommitteeJoin({ committee }: { committee: Committee }) {
  const { user, promptSignIn } = useIdentity();
  const [requested, setRequested] = useState(false);

  // The Lead is the contact for join requests; fall back to the first member.
  const lead =
    committee.members.find((m) => m.role === "Lead") ?? committee.members[0];
  if (!lead) return null;

  const leadFirst = lead.name.split(" ")[0];
  const subject = `${committee.name} committee — interested in joining`;
  const message = `Hi ${leadFirst}, I'm interested in joining the ${committee.name} committee. How can I get involved?`;
  const mailto = `mailto:${lead.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(message)}`;
  // `?&body=` is the cross-platform form that pre-fills the text on iOS & Android.
  const smsto = `sms:${lead.phone}?&body=${encodeURIComponent(message)}`;

  return (
    <section className="space-y-3 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
      <div>
        <h2 className="text-sm font-semibold text-primary">
          🙌 Interested in joining?
        </h2>
        <p className="mt-0.5 text-xs text-foreground/60">
          {committee.name} is always glad to have more hands. Message {lead.name}{" "}
          (Lead) — your note&rsquo;s already written — or request to join right
          in the app.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={mailto}
          className="press rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
        >
          ✉️ Email {leadFirst}
        </a>
        <a
          href={smsto}
          className="press rounded-xl bg-accent/10 py-3 text-center text-sm font-semibold text-accent"
        >
          💬 Text {leadFirst}
        </a>
      </div>

      {READ_ONLY ? (
        <ComingSoonCTA
          icon="📝"
          title="Request to join in the app — coming soon"
          note={`Soon you'll tap to request, and ${leadFirst} can approve you right here.`}
        />
      ) : requested ? (
        <p className="rounded-2xl border border-dashed border-primary/30 bg-card px-4 py-3 text-center text-sm font-medium text-primary">
          ✓ Request sent — {leadFirst} will review it.
        </p>
      ) : user ? (
        <button
          // SEAM (NEXT-STEPS §5c): wire to a Supabase committee_join_requests
          // insert + the Lead's approval queue. Local acknowledgement for now.
          onClick={() => setRequested(true)}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
        >
          📝 Request to join {committee.name}
        </button>
      ) : (
        <button
          onClick={promptSignIn}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
        >
          Sign in to request to join
        </button>
      )}
    </section>
  );
}
