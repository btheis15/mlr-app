"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { useIdentity } from "@/components/IdentityProvider";
import { Protected } from "@/components/Guard";
import { fetchCommitteeId, fetchJoinState } from "@/lib/roles";
import type { Committee } from "@/lib/types";

/**
 * "Interested in joining?" card on each committee page. Two ways to get in:
 *  - Email / Text the Lead now — works today, no backend, message pre-filled.
 *  - Request to join in the app — the real request → admin-approves → added loop
 *    (Supabase, migration 0012). Approval lets you into the committee's private
 *    chat. With no backend wired, this degrades to a "coming soon" affordance.
 *
 * For role-based committees (Family Fest) an optional area picker appears so the
 * requester can signal which area they'd like to help with (migration 0051).
 */
type JoinState = "loading" | "none" | "pending" | "member";

export function CommitteeJoin({ committee }: { committee: Committee }) {
  const { user, promptSignIn } = useIdentity();
  const configured = isSupabaseConfigured;
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [state, setState] = useState<JoinState>("loading");
  const [busy, setBusy] = useState(false);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);

  // The Lead is the contact for join requests; fall back to the first member.
  const lead = committee.members.find((m) => m.role === "Lead") ?? committee.members[0];
  const leadFirst = lead?.name.split(" ")[0] ?? "the lead";
  const subject = `${committee.name} committee — interested in joining`;
  const message = `Hi ${leadFirst}, I'm interested in joining the ${committee.name} committee. How can I get involved?`;
  const mailto = lead?.email ? `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;
  const smsto = lead?.phone ? `sms:${lead.phone}?&body=${encodeURIComponent(message)}` : null;
  const canContactLead = Boolean(mailto || smsto);

  // Derive available areas from the committee roster's role data.
  // Non-empty only for role-based committees (e.g. Family Fest).
  const areaOptions = Array.from(
    new Set(committee.members.flatMap((m) => (m.roles ?? []).map((r) => r.replace(/ · Lead$/, "")))),
  );

  useEffect(() => {
    if (!configured || !supabase || !user) {
      setState("none");
      return;
    }
    let cancelled = false;
    (async () => {
      const cid = await fetchCommitteeId(committee.slug);
      if (!cid || cancelled) {
        setState("none");
        return;
      }
      setCommitteeId(cid);
      const s = await fetchJoinState(cid);
      if (!cancelled) setState(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [committee.slug, configured, user]);

  const requestToJoin = async () => {
    if (!supabase || !committeeId) return;
    setBusy(true);
    const { error } = await supabase.rpc("request_to_join", {
      cid: committeeId,
      msg: message,
      requested_areas: selectedAreas,
    });
    setBusy(false);
    if (!error) setState("pending");
  };

  const leaveSelf = async () => {
    if (!supabase || !committeeId) return;
    if (!window.confirm(`Leave ${committee.name}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("leave_committee", { cid: committeeId });
    setBusy(false);
    if (error) window.alert(error.message);
    else setState("none");
  };

  if (!lead) return null;

  return (
    <section className="space-y-3 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
      <div>
        <h2 className="text-sm font-semibold text-primary">🙌 Interested in joining?</h2>
        <p className="mt-0.5 text-xs text-foreground/60">
          {committee.name} is always glad to have more hands.{" "}
          {canContactLead
            ? <>Message {leadFirst} — your note&rsquo;s already written — or request to join right in the app.</>
            : <>Request to join right in the app.</>}
        </p>
      </div>

      {canContactLead && (
        <Protected label="Sign in to contact the lead" className="w-full justify-center py-2.5">
          <div className="grid grid-cols-2 gap-2">
            {mailto && <a href={mailto} className="press rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary">✉️ Email {leadFirst}</a>}
            {smsto && <a href={smsto} className="press rounded-xl bg-accent/10 py-3 text-center text-sm font-semibold text-accent">💬 Text {leadFirst}</a>}
          </div>
        </Protected>
      )}

      {!configured ? (
        <ComingSoonCTA
          icon="📝"
          title="Request to join in the app — coming soon"
          note={`Soon you'll tap to request, an admin approves you, and you're in the ${committee.name} chat.`}
        />
      ) : !user ? (
        <div className="space-y-2">
          <button onClick={promptSignIn} className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white">
            Sign in to request to join
          </button>
          <p className="text-center text-xs text-foreground/55">
            Just your name &amp; email — no password.
          </p>
        </div>
      ) : state === "member" ? (
        <div className="space-y-2">
          <p className="rounded-2xl border border-dashed border-primary/30 bg-card px-4 py-3 text-center text-sm font-medium text-primary">
            ✓ You&rsquo;re on {committee.name} — open the chat above.
          </p>
          <button onClick={leaveSelf} disabled={busy} className="press w-full rounded-xl bg-background py-2.5 text-xs font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50">
            {busy ? "Leaving…" : `Leave ${committee.name}`}
          </button>
        </div>
      ) : state === "pending" ? (
        <p className="rounded-2xl border border-dashed border-primary/30 bg-card px-4 py-3 text-center text-sm font-medium text-primary">
          ✓ Request sent — an admin will review it.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Area picker for role-based committees */}
          {areaOptions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground/60">Which areas are you interested in? (optional — pick any)</p>
              <div className="flex flex-wrap gap-1.5">
                {areaOptions.map((area) => {
                  const on = selectedAreas.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      onClick={() =>
                        setSelectedAreas((prev) =>
                          on ? prev.filter((a) => a !== area) : [...prev, area],
                        )
                      }
                      className={`press rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${
                        on
                          ? "bg-primary text-white ring-primary"
                          : "bg-background ring-border text-foreground/60"
                      }`}
                    >
                      {area}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            onClick={requestToJoin}
            disabled={busy || state === "loading"}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : `📝 Request to join ${committee.name}`}
          </button>
        </div>
      )}
    </section>
  );
}
