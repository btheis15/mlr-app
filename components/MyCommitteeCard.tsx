"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { fetchLiveAreaNames, baseArea } from "@/lib/committeeAdmin";
import { fetchCommitteeRoster, saveRosterEntry, type RosterEntry } from "@/lib/committeeRoster";
import type { Committee } from "@/lib/types";

/**
 * Memory-only stale-while-revalidate cache, mirroring the other committee
 * caches (CommitteeRoster/CommitteeJoin): this page remounts on every visit, so
 * holding the last resolved entry per committee+viewer avoids a flash. Written
 * ONLY inside effects/handlers (client-only) — never at module-eval or during
 * render — so a cold first load starts empty (renders nothing), matching the
 * static-export/SSR HTML with no hydration mismatch. Keyed on slug AND the
 * viewer's id so one member's spot can't leak to the next on a shared device.
 */
const myCache = new Map<string, { entry: RosterEntry | null; areas: string[] }>();

const LEAD_SUFFIX = " · Lead";

/**
 * "Your spot on this committee" — a compact, top-of-page summary of the
 * viewer's OWN roles here, with one-tap self-service:
 *  - change which areas you help with,
 *  - step yourself down from a Lead role (you stay on the role as a volunteer),
 *  - leave the committee entirely (`leave_committee`).
 *
 * Renders nothing for a guest, a non-member, or a seed-only committee (no real
 * DB id, so the writes can't run). Read-only during an admin "View as" preview.
 *
 * Leads and admins edit through the roster directly (`saveRosterEntry`, which
 * migration 0172 opens to a committee's leads), so a lead editing their areas
 * KEEPS their "· Lead" standing on areas they still hold. A plain member uses
 * `set_my_committee_areas` (which can't touch lead status at all).
 */
export function MyCommitteeCard({
  committee,
  committeeId,
  onLeadChange,
}: {
  committee: Committee;
  committeeId: string | null;
  /** Reports whether the viewer leads this committee, so the page can put the
   *  Leads-chat tile in its action grid instead of a full-width bar in here. */
  onLeadChange?: (amLead: boolean) => void;
}) {
  const { user, isAdmin, effectiveUserId, previewAsId } = useIdentity();
  const isPreview = previewAsId != null;
  const key = `${committee.slug}|${effectiveUserId ?? ""}`;
  const cached = myCache.get(key);

  const [entry, setEntry] = useState<RosterEntry | null>(cached?.entry ?? null);
  const [areaOptions, setAreaOptions] = useState<string[]>(cached?.areas ?? []);
  const [editing, setEditing] = useState(false);
  // The self-service controls (edit areas / leave) are collapsed by default —
  // they're rare actions, and two always-visible buttons here cost a chunk of
  // the first screen that the roster should own.
  const [manageOpen, setManageOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !effectiveUserId) return;
    let alive = true;
    Promise.all([fetchCommitteeRoster(committee.slug), fetchLiveAreaNames(committee.slug)]).then(
      ([roster, areas]) => {
        if (!alive) return;
        const mine = roster.find((r) => r.linkedUserId && r.linkedUserId === effectiveUserId) ?? null;
        setEntry(mine);
        setAreaOptions(areas);
        myCache.set(key, { entry: mine, areas });
      },
    );
    return () => {
      alive = false;
    };
  }, [committee.slug, effectiveUserId, key]);

  // Lead standing, reported up for the page's Leads-chat tile. Computed here
  // (not below the early returns) so the effect obeys the rules of hooks.
  const iLeadHere =
    !!user && !!committeeId && !!entry && (entry.isLead || (entry.roles ?? []).some((r) => r.endsWith(LEAD_SUFFIX)));
  useEffect(() => {
    onLeadChange?.(iLeadHere);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iLeadHere]);

  const myRoles = entry?.roles ?? [];
  // Areas the viewer leads (raw "· Lead" entries) vs. plain areas they're on.
  const leadAreas = useMemo(
    () => myRoles.filter((r) => r.endsWith(LEAD_SUFFIX)).map(baseArea),
    [entry], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const myAreas = useMemo(() => myRoles.map(baseArea), [entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to show for a guest, a non-member, or a seed committee with no real
  // DB id (the self-service writes key on the committee uuid).
  if (!user || !committeeId) return null;

  if (left) {
    return (
      <section className="rounded-2xl bg-card p-4 text-center text-sm text-muted ring-1 ring-border">
        You&rsquo;ve left {committee.name}.
      </section>
    );
  }

  if (!entry) return null;

  const displayName = entry.linkedName || entry.name;
  // Am I a lead of this committee — committee-level (is_lead, 0177) OR an area
  // lead (any "· Lead" role, 0172)? Gates the "You're a lead"/Leads-chat surface.
  const amLead = entry.isLead || leadAreas.length > 0;
  // A lead (or admin) writes the roster row directly, so their edits preserve
  // their "· Lead" standing; a plain member goes through set_my_committee_areas.
  const canManageRoster = !isPreview && entry.id != null && (isAdmin || amLead);

  const startEdit = () => {
    setSelection([...myAreas]);
    setErr(null);
    setEditing(true);
  };
  const toggle = (area: string) =>
    setSelection((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));

  const persist = (nextRoles: string[]) => {
    const next: RosterEntry = { ...entry, roles: [...nextRoles] };
    setEntry(next);
    myCache.set(key, { entry: next, areas: areaOptions });
  };

  const save = async () => {
    if (!supabase || !committeeId) return;
    setBusy(true);
    setErr(null);
    if (canManageRoster && entry.id) {
      // Keep "· Lead" on any area I still lead AND still have selected.
      const roles = selection.map((a) => (leadAreas.includes(a) ? `${a}${LEAD_SUFFIX}` : a));
      const { error } = await saveRosterEntry({
        id: entry.id,
        committeeSlug: committee.slug,
        name: entry.name,
        email: entry.email ?? null,
        phone: entry.phone ?? null,
        roles,
        linkedUserId: entry.linkedUserId,
      });
      setBusy(false);
      if (error) return setErr(`Couldn't save your areas: ${error}`);
      persist(roles);
    } else {
      const { error } = await supabase.rpc("set_my_committee_areas", { cid: committeeId, areas: selection });
      setBusy(false);
      if (error) return setErr(`Couldn't save your areas: ${error.message}`);
      persist(selection);
    }
    setEditing(false);
  };

  // Step down as Lead of one area — you stay on it as a regular volunteer.
  const stepDown = async (area: string) => {
    if (!supabase || !entry.id) return;
    const roles = (entry.roles ?? []).map((r) => (r === `${area}${LEAD_SUFFIX}` ? area : r));
    setBusy(true);
    setErr(null);
    const { error } = await saveRosterEntry({
      id: entry.id,
      committeeSlug: committee.slug,
      name: entry.name,
      email: entry.email ?? null,
      phone: entry.phone ?? null,
      roles,
      linkedUserId: entry.linkedUserId,
    });
    setBusy(false);
    if (error) return setErr(`Couldn't step down: ${error}`);
    persist(roles);
  };

  const leave = async () => {
    if (!supabase || !committeeId) return;
    if (!window.confirm(`Leave ${committee.name}? You can always ask to rejoin later.`)) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("leave_committee", { cid: committeeId });
    setBusy(false);
    if (error) return setErr(`Couldn't leave: ${error.message}`);
    myCache.delete(key);
    setLeft(true);
  };

  return (
    <section className="space-y-2 rounded-2xl bg-primary/5 p-3 ring-1 ring-primary/20">
      <div className="flex items-center gap-2.5">
        <Avatar name={displayName} url={entry.linkedAvatarUrl} size={30} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Your spot here</p>
          <p className="truncate text-sm font-semibold">{displayName}</p>
        </div>
        {/* Rare self-service actions live behind this toggle instead of two
            permanently-visible full-width buttons. */}
        {!isPreview && (
          <button
            type="button"
            onClick={() => setManageOpen((v) => !v)}
            aria-expanded={manageOpen}
            className="press shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
          >
            {manageOpen ? "Done" : "⋯ Manage"}
          </button>
        )}
      </div>

      {/* What you do here — role chips, leads flagged with a one-tap step-down. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Committee-level Lead standing (independent of any area). */}
        {entry.isLead && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-white">
            ★ Lead of this committee
          </span>
        )}
        {myAreas.length > 0 ? (
          myAreas.map((area) => {
            const lead = leadAreas.includes(area);
            return (
              <span
                key={area}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  lead ? "bg-primary text-white" : "bg-primary/10 text-primary"
                }`}
              >
                {area}
                {lead && (
                  <>
                    <span className="opacity-80">· Lead</span>
                    {!isPreview && (
                      <button
                        type="button"
                        onClick={() => stepDown(area)}
                        disabled={busy}
                        aria-label={`Step down as Lead of ${area}`}
                        title={`Step down as Lead of ${area} (stay on as a volunteer)`}
                        className="press -mr-0.5 ml-0.5 rounded-full px-1 text-white/80 hover:text-white disabled:opacity-50"
                      >
                        ✕
                      </button>
                    )}
                  </>
                )}
              </span>
            );
          })
        ) : entry.isLead ? null : (
          <span className="text-xs text-muted">On the committee — no specific area yet.</span>
        )}
      </div>

      {/* The Leads chat is a primary DESTINATION, so it's rendered as a tile in
          the page's action grid (CommitteeDetail) rather than a full-width bar
          inside this card — this card reports lead standing up via onLeadChange. */}

      {/* Self-service area editing. */}
      {editing ? (
        <div className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-border">
          <p className="text-xs font-medium text-foreground/60">Pick the areas you want to help with:</p>
          <div className="flex flex-wrap gap-1.5">
            {areaOptions.map((area) => {
              const on = selection.includes(area);
              return (
                <button
                  key={area}
                  type="button"
                  onClick={() => toggle(area)}
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
              onClick={save}
              disabled={busy}
              className="press rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="press px-3 py-1.5 text-xs font-medium text-foreground/50">
              Cancel
            </button>
          </div>
        </div>
      ) : manageOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          {!isPreview && areaOptions.length > 0 && (
            <button
              type="button"
              onClick={startEdit}
              className="press rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
            >
              ✎ Edit my areas
            </button>
          )}
          {!isPreview && (
            <button
              type="button"
              onClick={leave}
              disabled={busy}
              className="press rounded-xl bg-background px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
            >
              {busy ? "Leaving…" : `Leave ${committee.name}`}
            </button>
          )}
        </div>
      ) : null}

      {err && <p className="text-xs font-medium text-accent">{err}</p>}
    </section>
  );
}
