"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { fetchProfiles, fetchGuestProfiles, type ProfileLite } from "@/lib/roles";
import { nameMatches } from "@/lib/committees";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { PrivateName, useGuest } from "@/components/Guard";
import { CommitteeMemberContact } from "@/components/CommitteeMemberContact";
import { FAMILY_FEST_AREAS } from "@/lib/data";
import { fetchCommitteeRoster, saveRosterEntry, deleteRosterEntry, type RosterEntry } from "@/lib/committeeRoster";
import type { Committee } from "@/lib/types";

/**
 * Stale-while-revalidate caches for the committee roster, mirroring `eventsCache`
 * in lib/hooks.ts. `CommitteeRoster` remounts on every visit to a committee page;
 * without these the view resets to the static seed and the linked real-account
 * names/avatars, the profile tap-through, and the contact buttons pop in a beat
 * later (and the "Pending verification" chips flip) on every visit. Holding the
 * last result in memory lets a returning view paint the resolved roster instantly
 * while a background refetch keeps it current. Memory-only (per session) and
 * written ONLY inside effects / `.then` callbacks after a client fetch — never at
 * module top level and never during SSR/render — so a cold load (empty caches)
 * reproduces the original static-seed first paint exactly (matching the
 * server-rendered / static-export HTML) and can't cause a hydration mismatch. The
 * roster is keyed by committee slug; the profile/contact maps are additionally
 * keyed by the viewer's email because contact + link visibility is RLS-gated on
 * the viewer. Display data only, so there's no permission to revoke.
 */
const rosterCache = new Map<string, RosterEntry[]>();
interface RosterProfileSnapshot {
  allProfiles: ProfileLite[];
  byEmail: Record<string, ProfileLite>;
  contactById: Record<string, { phone: string | null; email: string | null }>;
}
const rosterProfileCache = new Map<string, RosterProfileSnapshot>();

/**
 * The committee roster — the single membership list (migration 0057). Each slot
 * links to a real account when one exists (matched by email, auto-stamped on
 * verify), so a placeholder upgrades in place. App admins can add/remove people
 * and edit their roles (a role can have multiple Leads; everyone else is a quiet
 * volunteer). Anyone signed in can email a whole committee or a single role.
 */
export function CommitteeRoster({ committee }: { committee: Committee }) {
  const { user, isAdmin } = useIdentity();
  const { guest } = useGuest();
  // Contact/link visibility is RLS-gated on the viewer, so the profile/contact
  // caches key on the viewer's email as well as the slug. `user` is null during
  // prerender ⇒ key `${slug}|`, matching the guest first paint.
  const profileCacheKey = `${committee.slug}|${user?.email ?? ""}`;

  const [members, setMembers] = useState<RosterEntry[]>(
    () =>
      rosterCache.get(committee.slug) ??
      (committee.members ?? []).map((m) => ({ ...m, linkedUserId: null, linkedName: null, linkedAvatarUrl: null })),
  );
  const reload = () =>
    fetchCommitteeRoster(committee.slug).then((r) => {
      rosterCache.set(committee.slug, r);
      setMembers(r);
    });
  useEffect(() => {
    let alive = true;
    fetchCommitteeRoster(committee.slug).then((r) => {
      rosterCache.set(committee.slug, r);
      if (alive) setMembers(r);
    });
    return () => {
      alive = false;
    };
  }, [committee.slug]);

  const isRoleBased = committee.slug === "family-fest" || members.some((m) => m.roles && m.roles.length > 0);

  const rosterEmails = useMemo(
    () => Array.from(new Set(members.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))),
    [members],
  );

  const cachedProfiles = rosterProfileCache.get(profileCacheKey);
  const [allProfiles, setAllProfiles] = useState<ProfileLite[]>(cachedProfiles?.allProfiles ?? []);
  const [byEmail, setByEmail] = useState<Record<string, ProfileLite>>(cachedProfiles?.byEmail ?? {});
  const [sheet, setSheet] = useState<{ id: string; name: string; avatar: string | null } | null>(null);
  const [editing, setEditing] = useState<RosterEntry | "new" | null>(null);
  // Phone/email of the linked accounts (by profile id), so a linked person's own
  // profile contact info wins over whatever's on the roster row.
  const [contactById, setContactById] = useState<Record<string, { phone: string | null; email: string | null }>>(
    cachedProfiles?.contactById ?? {},
  );

  // The two profile-loading effects below each fill part of the snapshot at
  // different times; merge so a cache entry keeps whichever half is fresher.
  const patchProfileCache = (patch: Partial<RosterProfileSnapshot>) => {
    const prev = rosterProfileCache.get(profileCacheKey) ?? { allProfiles: [], byEmail: {}, contactById: {} };
    rosterProfileCache.set(profileCacheKey, { ...prev, ...patch });
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    // Guests never see the contact buttons (Protected) — and under the 0081 RLS
    // lockdown `profiles` is members-only anyway — so don't fetch phone/email
    // for them at all.
    const ids = guest ? [] : Array.from(new Set(members.map((m) => m.linkedUserId).filter((i): i is string => !!i)));
    if (!ids.length) {
      setContactById({});
      patchProfileCache({ contactById: {} });
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase!.from("profiles").select("id, phone, contact_email").in("id", ids);
      const map: Record<string, { phone: string | null; email: string | null }> = {};
      for (const p of (data ?? []) as { id: string; phone: string | null; contact_email: string | null }[]) {
        map[p.id] = { phone: p.phone, email: p.contact_email };
      }
      patchProfileCache({ contactById: map });
      if (alive) setContactById(map);
    })();
    return () => {
      alive = false;
    };
  }, [members, guest]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let alive = true;
    (async () => {
      // Guests read the `public_profiles` view (first name + avatar only,
      // migration 0081) so the roster still shows faces next to the seed names;
      // it self-falls-back to the old `profiles` read pre-migration. The
      // email-link lookup below needs `profiles.contact_email` (members-only),
      // so guests skip it — their linking is the display-only nameMatches path.
      const all = guest ? await fetchGuestProfiles() : await fetchProfiles();
      const map: Record<string, ProfileLite> = {};
      if (supabase && !guest && rosterEmails.length) {
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, contact_email")
          .in("contact_email", rosterEmails);
        for (const p of (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; contact_email: string | null }[]) {
          const e = (p.contact_email ?? "").toLowerCase();
          if (e) map[e] = { id: p.id, name: p.display_name?.trim() || "Member", avatarUrl: p.avatar_url ?? null };
        }
      }
      patchProfileCache({ allProfiles: all, byEmail: map });
      if (alive) {
        setAllProfiles(all);
        setByEmail(map);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rosterEmails, guest]);

  const linkFor = (m: RosterEntry): ProfileLite | null => {
    if (m.linkedUserId) {
      return { id: m.linkedUserId, name: m.linkedName ?? m.name, avatarUrl: m.linkedAvatarUrl ?? null };
    }
    const e = m.email?.toLowerCase();
    if (e && byEmail[e]) return byEmail[e];
    return allProfiles.find((p) => nameMatches(m.name, p.name)) ?? null;
  };

  /** Contact info to use for an entry: the linked account's profile wins, else
   *  the roster row's own fields. */
  const effectiveContact = (m: RosterEntry): { phone?: string; email?: string } => {
    const link = linkFor(m);
    const c = link ? contactById[link.id] : undefined;
    return {
      phone: (c?.phone || m.phone) ?? undefined,
      email: (c?.email || m.email) ?? undefined,
    };
  };

  /** Build a mailto: link (bcc keeps addresses private) for a set of people. */
  const mailtoFor = (entries: RosterEntry[], subject: string): string | null => {
    const emails = Array.from(new Set(entries.map((e) => effectiveContact(e).email?.trim()).filter((e): e is string => !!e)));
    if (!emails.length) return null;
    return `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(subject)}`;
  };

  const Row = ({ m, isLead }: { m: RosterEntry; isLead?: boolean }) => {
    const link = linkFor(m);
    const display = link?.name ?? m.name;
    const pending = !link && !!m.email;
    return (
      <li className="flex items-center gap-2">
        {link ? (
          <button
            type="button"
            onClick={() => setSheet({ id: link.id, name: link.name, avatar: link.avatarUrl })}
            className="press flex min-w-0 items-center gap-2 text-left"
          >
            <Avatar name={link.name} url={link.avatarUrl} size={26} />
            <span className="truncate text-sm font-medium"><PrivateName name={display} /></span>
          </button>
        ) : (
          <span className="truncate text-sm"><PrivateName name={display} /></span>
        )}
        {isLead && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Lead</span>
        )}
        {pending && (
          <span
            className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground/55"
            title="Invited — hasn't signed in to claim their account yet"
          >
            Pending verification
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <CommitteeMemberContact {...effectiveContact(m)} />
          {isAdmin && (
            <button
              type="button"
              onClick={() => setEditing(m)}
              className="press rounded-full px-1.5 text-foreground/40 hover:text-primary"
              aria-label="Edit member"
            >
              ✎
            </button>
          )}
        </span>
      </li>
    );
  };

  const adminBar = isAdmin && (
    <button
      type="button"
      onClick={() => setEditing("new")}
      className="press w-full rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-sm font-semibold text-primary"
    >
      ＋ Add a member
    </button>
  );

  const everyoneMail = mailtoFor(members, `${committee.name} — Muskellunge Lake Resort`);

  return (
    <>
      {user && everyoneMail && (
        <a
          href={everyoneMail}
          className="press block rounded-2xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
        >
          ✉️ Email everyone on this committee
        </a>
      )}

      {isRoleBased ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Roles &amp; who&rsquo;s on them</h2>
          {adminBar}
          {FAMILY_FEST_AREAS.map((area) => {
            const inArea = members
              .map((m) => ({ m, lead: m.roles?.includes(`${area} · Lead`) ?? false }))
              .filter(({ m }) => m.roles?.some((r) => r === area || r === `${area} · Lead`))
              .sort((a, b) => Number(b.lead) - Number(a.lead));
            if (!inArea.length) return null;
            const mail = user ? mailtoFor(inArea.map((x) => x.m), `${area} — ${committee.name}`) : null;
            return (
              <div key={area} className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{area}</h3>
                  {mail && (
                    <a href={mail} className="press shrink-0 text-[11px] font-semibold text-primary">✉️ Email</a>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {inArea.map(({ m, lead: isLead }) => (
                    <Row key={m.name} m={m} isLead={isLead} />
                  ))}
                </ul>
              </div>
            );
          })}
          {/* Anyone on the committee with no area yet. */}
          {(() => {
            const none = members.filter((m) => !m.roles || m.roles.length === 0);
            if (!none.length) return null;
            return (
              <div className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
                <h3 className="text-sm font-semibold">On the committee</h3>
                <ul className="space-y-1.5">
                  {none.map((m) => <Row key={m.name} m={m} />)}
                </ul>
              </div>
            );
          })()}
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Members</h2>
          {adminBar}
          <ul className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
            {members.map((m) => <Row key={m.name} m={m} />)}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-foreground/40">
        Contact buttons + profile links appear as members link their accounts.
      </p>

      {sheet && (
        <MemberSheet
          key={sheet.id}
          id={sheet.id}
          name={sheet.name}
          avatarUrl={sheet.avatar}
          onClose={() => setSheet(null)}
        />
      )}

      {editing && (
        <RosterEditor
          committee={committee}
          entry={editing === "new" ? null : editing}
          roleBased={isRoleBased}
          profiles={allProfiles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

// ── Admin add/edit modal ──────────────────────────────────────────────────────

function RosterEditor({
  committee,
  entry,
  roleBased,
  profiles,
  onClose,
  onSaved,
}: {
  committee: Committee;
  entry: RosterEntry | null;
  roleBased: boolean;
  profiles: ProfileLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = entry == null;
  const [name, setName] = useState(entry?.name ?? "");
  const [email, setEmail] = useState(entry?.email ?? "");
  const [phone, setPhone] = useState(entry?.phone ?? "");
  const [linkedUserId, setLinkedUserId] = useState<string | null>(entry?.linkedUserId ?? null);
  const [linkedName, setLinkedName] = useState<string | null>(entry?.linkedName ?? null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((entry?.roles ?? []).map((r) => (r.endsWith(" · Lead") ? r.slice(0, -" · Lead".length) : r))),
  );
  const [leads, setLeads] = useState<Set<string>>(
    () => new Set((entry?.roles ?? []).filter((r) => r.endsWith(" · Lead")).map((r) => r.slice(0, -" · Lead".length))),
  );
  const [pickQuery, setPickQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = () =>
    FAMILY_FEST_AREAS.filter((a) => selected.has(a)).map((a) => (leads.has(a) ? `${a} · Lead` : a));

  /** Link an existing account — and auto-fill their phone + email from their
   *  profile so the roster row carries their contact info (mirrors iOS). */
  const pickMember = async (p: ProfileLite) => {
    setLinkedUserId(p.id);
    setLinkedName(p.name);
    setName(p.name);
    setPickQuery("");
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("profiles")
      .select("phone, contact_email")
      .eq("id", p.id)
      .single();
    const prof = data as { phone: string | null; contact_email: string | null } | null;
    if (prof?.contact_email) setEmail(prof.contact_email);
    if (prof?.phone) setPhone(prof.phone);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await saveRosterEntry({
      id: entry?.id,
      committeeSlug: committee.slug,
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      roles: roleBased ? roles() : [],
      linkedUserId,
    });
    setBusy(false);
    if (error) setError(error);
    else onSaved();
  };

  const remove = async () => {
    if (!entry?.id) return;
    setBusy(true);
    setError(null);
    const { error } = await deleteRosterEntry(entry.id);
    setBusy(false);
    if (error) setError(error);
    else onSaved();
  };

  const matches = pickQuery.trim()
    ? profiles.filter((p) => p.name.toLowerCase().includes(pickQuery.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[88dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-background p-5 ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{isNew ? "Add member" : "Edit member"}</h2>

        {/* Primary path: pick someone who already has an app account. */}
        {linkedUserId ? (
          <div className="flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2 text-sm ring-1 ring-primary/20">
            <span className="font-medium text-primary">✓ {linkedName ?? "Linked account"}</span>
            <button type="button" onClick={() => { setLinkedUserId(null); setLinkedName(null); }} className="press text-xs font-semibold text-accent">Change</button>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="🔎 Choose a member — search by name…"
              className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            {matches.length > 0 && (
              <ul className="overflow-hidden rounded-xl ring-1 ring-border">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void pickMember(p)}
                      className="press flex w-full items-center gap-2 bg-card px-3 py-2 text-left text-sm hover:bg-background"
                    >
                      <Avatar name={p.name} url={p.avatarUrl} size={22} />
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="px-0.5 text-[11px] text-foreground/45">
              Pick someone with an account — that brings their name, photo, and chat access. Only fill in the fields below for someone not in the app yet (a one-off).
            </p>
          </div>
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (for invite / contact)"
          className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {roleBased && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-foreground/45">Roles</p>
            {FAMILY_FEST_AREAS.map((area) => {
              const on = selected.has(area);
              const lead = leads.has(area);
              return (
                <div key={area} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(area)) { n.delete(area); setLeads((l) => { const k = new Set(l); k.delete(area); return k; }); }
                        else n.add(area);
                        return n;
                      });
                    }}
                    className="press flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  >
                    <span className={on ? "text-primary" : "text-foreground/40"}>{on ? "☑︎" : "☐"}</span>
                    <span className="truncate">{area}</span>
                  </button>
                  {on && (
                    <button
                      type="button"
                      onClick={() => setLeads((l) => { const n = new Set(l); n.has(area) ? n.delete(area) : n.add(area); return n; })}
                      className={`press shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${lead ? "bg-primary/15 text-primary" : "bg-foreground/10 text-foreground/55"}`}
                    >
                      {lead ? "★ Lead" : "☆ Lead"}
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-foreground/45">Tap ★ Lead to make them a lead of that area (a role can have more than one lead); everyone else is a volunteer.</p>
          </div>
        )}

        {error && <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="press flex-1 rounded-xl bg-card py-2.5 text-sm font-semibold ring-1 ring-border">Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim()}
            className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>

        {!isNew && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="press w-full rounded-xl bg-accent/10 py-2.5 text-sm font-semibold text-accent disabled:opacity-50"
          >
            Remove from committee
          </button>
        )}
      </div>
    </div>
  );
}
