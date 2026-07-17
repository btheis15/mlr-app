"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { useIdentity } from "@/components/IdentityProvider";
import { Protected } from "@/components/Guard";
import { Sheet } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { fetchCommitteeId, fetchJoinState, fetchMyAreas } from "@/lib/roles";
import { fetchLiveAreaNames } from "@/lib/committeeAdmin";
import type { Committee } from "@/lib/types";

/**
 * "Interested in joining?" card on each committee page. Two ways to get in:
 *  - Email / Text the Lead now — works today, no backend, message pre-filled.
 *  - Request to join in the app — the real request → admin-approves → added loop
 *    (Supabase, migration 0012). Approval lets you into the committee's private
 *    chat. With no backend wired, this degrades to a "coming soon" affordance.
 *
 * For role-based committees (Family Fest), tapping "Request to join" opens
 * `RoleRequiredSheet` — the requester must pick at least one area there before
 * the request can actually be sent (migration 0051); there's no way to send
 * the request with zero areas assigned.
 */
type JoinState = "loading" | "none" | "pending" | "member";

/**
 * Stale-while-revalidate cache for the join panel, mirroring `eventsCache` in
 * lib/hooks.ts. This card remounts on every visit to a committee page; without
 * this it resets to "loading" and its body (Request-to-join button vs. "You're
 * on X" + areas editor vs. "Request sent") shifts/reflows before the fetch
 * lands. Holding the last resolved state per committee+viewer lets a return
 * visit paint the right body immediately while the effect refetches in the
 * background. Keyed on committee slug AND the viewer's email so one member's
 * state can't leak to another (or to a guest). Memory-only (per session) and
 * written ONLY inside effects/handlers (client-only) — never at module-eval or
 * during render — so a cold first load starts empty (the original "loading"
 * default), matching the static-export/SSR HTML with no hydration mismatch.
 * Permission revocation is safe: the effect always overwrites state from
 * fetchJoinState (member → none if they've been removed / left elsewhere).
 */
const joinStateCache = new Map<string, { state: JoinState; committeeId: string | null; myAreas: string[] }>();

export function CommitteeJoin({ committee }: { committee: Committee }) {
  const { user, promptSignIn } = useIdentity();
  const configured = isSupabaseConfigured;
  const key = `${committee.slug}|${user?.email ?? "self"}`;
  const cached = joinStateCache.get(key);
  const [committeeId, setCommitteeId] = useState<string | null>(cached?.committeeId ?? null);
  const [state, setState] = useState<JoinState>(cached?.state ?? "loading");
  const [busy, setBusy] = useState(false);
  // Inline error for join/leave/areas actions (styled text near the button —
  // the app never surfaces raw errors via window.alert).
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [myAreas, setMyAreas] = useState<string[]>(cached?.myAreas ?? []);
  const [editingMyAreas, setEditingMyAreas] = useState(false);
  const [myAreaSelection, setMyAreaSelection] = useState<string[]>([]);
  // Role-based committees (Family Fest) require at least one area before the
  // request can go out — this sheet is the "pick one before you can join"
  // gate so nobody lands on the committee with zero areas assigned.
  const [showRoleRequired, setShowRoleRequired] = useState(false);

  // The Lead is the contact for join requests; fall back to the first member.
  const lead = committee.members.find((m) => m.role === "Lead") ?? committee.members[0];
  const leadFirst = lead?.name.split(" ")[0] ?? "the lead";
  const subject = `${committee.name} committee — interested in joining`;
  const message = `Hi ${leadFirst}, I'm interested in joining the ${committee.name} committee. How can I get involved?`;
  const mailto = lead?.email ? `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;
  const smsto = lead?.phone ? `sms:${lead.phone}?&body=${encodeURIComponent(message)}` : null;
  const canContactLead = Boolean(mailto || smsto);

  // The joinable areas come from the DB allow-list (admin-managed, migration
  // 0112), so a brand-new role is immediately joinable even before anyone holds
  // it. Non-empty only for role-based committees (e.g. Family Fest). Seeds from
  // the roster's current role data so it isn't empty for the first paint.
  const [areaOptions, setAreaOptions] = useState<string[]>(() =>
    Array.from(new Set(committee.members.flatMap((m) => (m.roles ?? []).map((r) => r.replace(/ · Lead$/, ""))))),
  );
  useEffect(() => {
    let alive = true;
    fetchLiveAreaNames(committee.slug).then((a) => {
      if (alive && a.length) setAreaOptions(a);
    });
    return () => {
      alive = false;
    };
  }, [committee.slug]);

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
      if (cancelled) return;
      setState(s);
      if (s === "member") {
        const areas = await fetchMyAreas(cid);
        if (!cancelled) {
          setMyAreas(areas);
          joinStateCache.set(key, { state: s, committeeId: cid, myAreas: areas });
        }
      } else {
        joinStateCache.set(key, { state: s, committeeId: cid, myAreas: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [committee.slug, configured, user]);

  const requestToJoin = async () => {
    if (!supabase || !committeeId) return;
    setBusy(true);
    setErrMsg(null);
    const { error } = await supabase.rpc("request_to_join", {
      cid: committeeId,
      msg: message,
      requested_areas: selectedAreas,
    });
    setBusy(false);
    if (error) {
      setErrMsg(`Couldn't send the request: ${error.message}`);
      return;
    }
    setState("pending");
    joinStateCache.set(key, { state: "pending", committeeId, myAreas });
  };

  const startEditMyAreas = () => {
    setMyAreaSelection([...myAreas]);
    setEditingMyAreas(true);
  };
  const toggleMyArea = (area: string) =>
    setMyAreaSelection((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));
  const saveMyAreas = async () => {
    if (!supabase || !committeeId) return;
    setBusy(true);
    setErrMsg(null);
    const { error } = await supabase.rpc("set_my_committee_areas", {
      cid: committeeId,
      areas: myAreaSelection,
    });
    setBusy(false);
    if (error) {
      setErrMsg(`Couldn't save your areas: ${error.message}`);
      return;
    }
    setMyAreas(myAreaSelection);
    setEditingMyAreas(false);
    joinStateCache.set(key, { state, committeeId, myAreas: myAreaSelection });
  };

  const leaveSelf = async () => {
    if (!supabase || !committeeId) return;
    if (!window.confirm(`Leave ${committee.name}?`)) return;
    setBusy(true);
    setErrMsg(null);
    const { error } = await supabase.rpc("leave_committee", { cid: committeeId });
    setBusy(false);
    if (error) {
      setErrMsg(`Couldn't leave: ${error.message}`);
    } else {
      setState("none");
      joinStateCache.set(key, { state: "none", committeeId, myAreas: [] });
    }
  };

  // No seeded lead is fine — the in-app request flow doesn't need one (only the
  // optional "email/text the lead" shortcut does, which self-hides). DB-created
  // committees have an empty seed roster, so we must NOT bail here.

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
          <p className="text-center text-xs text-muted">
            Just your name &amp; email — no password.
          </p>
        </div>
      ) : state === "member" ? (
        <div className="space-y-2">
          <p className="rounded-2xl border border-dashed border-primary/30 bg-card px-4 py-3 text-center text-sm font-medium text-primary">
            ✓ You&rsquo;re on {committee.name} — open the chat above.
          </p>

          {areaOptions.length > 0 && (
            <div className="space-y-1.5 rounded-xl bg-card p-3 ring-1 ring-border">
              <p className="text-xs font-medium text-foreground/60">Your areas — change anytime, no approval needed</p>
              {editingMyAreas ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {areaOptions.map((area) => {
                      const on = myAreaSelection.includes(area);
                      return (
                        <button
                          key={area}
                          type="button"
                          onClick={() => toggleMyArea(area)}
                          className={`press rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${
                            on ? "bg-primary text-white ring-primary" : "bg-background ring-border text-foreground/60"
                          }`}
                        >
                          {area}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveMyAreas}
                      disabled={busy}
                      className="press rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingMyAreas(false)} className="press px-3 py-1.5 text-xs font-medium text-foreground/50">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  {myAreas.length > 0 ? (
                    myAreas.map((a) => (
                      <span key={a} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-faint">No area yet</span>
                  )}
                  <button type="button" onClick={startEditMyAreas} className="press ml-0.5 text-[10px] font-semibold text-primary">
                    {myAreas.length > 0 ? "· Edit" : "+ Add"}
                  </button>
                </div>
              )}
            </div>
          )}

          {errMsg && <p className="text-center text-xs font-medium text-accent">{errMsg}</p>}

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
          <button
            onClick={() => (areaOptions.length > 0 ? setShowRoleRequired(true) : requestToJoin())}
            disabled={busy || state === "loading"}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : `📝 Request to join ${committee.name}`}
          </button>
          {errMsg && <p className="text-center text-xs font-medium text-accent">{errMsg}</p>}
        </div>
      )}

      {showRoleRequired && (
        <RoleRequiredSheet
          committeeName={committee.name}
          areaOptions={areaOptions}
          selectedAreas={selectedAreas}
          onToggleArea={(area) =>
            setSelectedAreas((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]))
          }
          busy={busy}
          onClose={() => setShowRoleRequired(false)}
          onConfirm={async () => {
            await requestToJoin();
            setShowRoleRequired(false);
          }}
        />
      )}
    </section>
  );
}

/** The only way to send a join request for a role-based committee (Family
 * Fest): picking an area happens here, in this sheet, not on the card behind
 * it — so there's one single path in, and it can't be skipped. */
function RoleRequiredSheet({
  committeeName,
  areaOptions,
  selectedAreas,
  onToggleArea,
  busy,
  onClose,
  onConfirm,
}: {
  committeeName: string;
  areaOptions: string[];
  selectedAreas: string[];
  onToggleArea: (area: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const canConfirm = selectedAreas.length > 0 && !busy;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="role-required-title"
      header={
        <h2 id="role-required-title" className="text-lg font-bold text-foreground">
          Pick at least one area
        </h2>
      }
      footer={
        <button
          onClick={onConfirm}
          disabled={!canConfirm}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      }
    >
      <p className="text-sm text-foreground/70">
        {committeeName} is organized by area, so pick at least one thing you&rsquo;d like to help
        with before we send your request — the lead will know right away where you fit in.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {areaOptions.map((area) => {
          const on = selectedAreas.includes(area);
          return (
            <button
              key={area}
              type="button"
              onClick={() => onToggleArea(area)}
              className={`press rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${
                on ? "bg-primary text-white ring-primary" : "bg-background ring-border text-foreground/60"
              }`}
            >
              {area}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
