"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { fetchLiveAreaNames, baseArea } from "@/lib/committeeAdmin";
import { fetchCommitteeRoster, type RosterEntry } from "@/lib/committeeRoster";
import type { Committee } from "@/lib/types";

/**
 * Memory-only stale-while-revalidate cache, mirroring the other committee
 * caches (CommitteeRoster/CommitteeJoin): this page remounts on every visit, so
 * holding the last resolved entry per committee+viewer avoids a flash. Written
 * ONLY inside the effect (client-only) — never at module-eval or during render —
 * so a cold first load starts empty (renders nothing), matching the
 * static-export/SSR HTML with no hydration mismatch. Keyed on slug AND the
 * viewer's id so one member's spot can't leak to the next on a shared device.
 */
const myCache = new Map<string, { entry: RosterEntry | null; areas: string[] }>();

const LEAD_SUFFIX = " · Lead";

/**
 * "Your spot on this committee" — a compact, top-of-page summary of the
 * viewer's OWN roles here, with one-tap self-service: change which areas you
 * help with (`set_my_committee_areas`, no admin approval — migration 0073) or
 * leave the committee entirely (`leave_committee` — migrations 0012/0057).
 *
 * Renders nothing for a guest, a non-member, or a seed-only committee (no real
 * DB id, so the RPCs can't run). During an admin "View as" preview it stays
 * read-only — the write affordances are hidden, since preview never acts as the
 * previewed member.
 *
 * Leads are read-only here on purpose: `set_my_committee_areas` strips every
 * " · Lead" suffix and overwrites the role list, so letting a lead self-edit
 * their areas would silently demote them. Their lead roles are admin-managed
 * (Admin → Committees), matching the server rule that a member can't
 * self-appoint a lead.
 */
export function MyCommitteeCard({
  committee,
  committeeId,
}: {
  committee: Committee;
  committeeId: string | null;
}) {
  const { user, effectiveUserId, previewAsId } = useIdentity();
  const isPreview = previewAsId != null;
  const key = `${committee.slug}|${effectiveUserId ?? ""}`;
  const cached = myCache.get(key);

  const [entry, setEntry] = useState<RosterEntry | null>(cached?.entry ?? null);
  const [areaOptions, setAreaOptions] = useState<string[]>(cached?.areas ?? []);
  const [editing, setEditing] = useState(false);
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

  const myRoles = entry?.roles ?? [];
  // Areas the viewer leads (raw " · Lead" entries) vs. plain areas they're on.
  const leadAreas = useMemo(
    () => myRoles.filter((r) => r.endsWith(LEAD_SUFFIX)).map(baseArea),
    [entry], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const myAreas = useMemo(() => myRoles.map(baseArea), [entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to show for a guest, a non-member, or a seed committee with no real
  // DB id (the self-service RPCs key on the committee uuid).
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
  // Leads can self-edit their areas only when they hold NO lead role (see the
  // doc comment): otherwise saving would strip their lead standing.
  const canSelfEdit = !isPreview && areaOptions.length > 0 && leadAreas.length === 0;

  const startEdit = () => {
    setSelection([...myAreas]);
    setErr(null);
    setEditing(true);
  };
  const toggle = (area: string) =>
    setSelection((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));

  const save = async () => {
    if (!supabase || !committeeId) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("set_my_committee_areas", { cid: committeeId, areas: selection });
    setBusy(false);
    if (error) {
      setErr(`Couldn't save your areas: ${error.message}`);
      return;
    }
    const next: RosterEntry = { ...entry, roles: [...selection] };
    setEntry(next);
    myCache.set(key, { entry: next, areas: areaOptions });
    setEditing(false);
  };

  const leave = async () => {
    if (!supabase || !committeeId) return;
    if (!window.confirm(`Leave ${committee.name}? You can always ask to rejoin later.`)) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("leave_committee", { cid: committeeId });
    setBusy(false);
    if (error) {
      setErr(`Couldn't leave: ${error.message}`);
      return;
    }
    myCache.delete(key);
    setLeft(true);
  };

  return (
    <section className="space-y-3 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
      <div className="flex items-center gap-2.5">
        <Avatar name={displayName} url={entry.linkedAvatarUrl} size={34} />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your spot here</p>
          <p className="truncate text-sm font-semibold">{displayName}</p>
        </div>
      </div>

      {/* What you do here — role chips, leads flagged. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {myAreas.length > 0 ? (
          myAreas.map((area) => {
            const lead = leadAreas.includes(area);
            return (
              <span
                key={area}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  lead ? "bg-primary text-white" : "bg-primary/10 text-primary"
                }`}
              >
                {area}
                {lead && " · Lead"}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-muted">On the committee — no specific area yet.</span>
        )}
      </div>

      {/* Self-service area editing (non-leads only). */}
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
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canSelfEdit && (
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
          {leadAreas.length > 0 && (
            <span className="text-[11px] text-faint">Your lead role is set by an admin.</span>
          )}
        </div>
      )}

      {err && <p className="text-xs font-medium text-accent">{err}</p>}
    </section>
  );
}
