"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { fetchProfiles, type ProfileLite } from "@/lib/roles";
import { nameMatches } from "@/lib/committees";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { PrivateName } from "@/components/Guard";
import { CommitteeBadge } from "@/components/CommitteeBadge";
import { CommitteeMemberContact } from "@/components/CommitteeMemberContact";
import { FAMILY_FEST_AREAS } from "@/lib/data";
import { fetchCommitteeRoster, saveRosterEntry, deleteRosterEntry, type RosterEntry } from "@/lib/committeeRoster";
import type { Committee } from "@/lib/types";

/**
 * The committee roster — the single membership list (migration 0057). Each slot
 * links to a real account when one exists (matched by email, auto-stamped on
 * verify), so a placeholder upgrades in place. App admins can add/remove people
 * and edit their roles (a role can have multiple Leads; everyone else is a quiet
 * volunteer). Anyone signed in can email a whole committee or a single role.
 */
export function CommitteeRoster({ committee }: { committee: Committee }) {
  const { user, isAdmin } = useIdentity();

  const [members, setMembers] = useState<RosterEntry[]>(
    () => (committee.members ?? []).map((m) => ({ ...m, linkedUserId: null, linkedName: null, linkedAvatarUrl: null })),
  );
  const reload = () => fetchCommitteeRoster(committee.slug).then(setMembers);
  useEffect(() => {
    let alive = true;
    fetchCommitteeRoster(committee.slug).then((r) => alive && setMembers(r));
    return () => {
      alive = false;
    };
  }, [committee.slug]);

  const isRoleBased = committee.slug === "family-fest" || members.some((m) => m.roles && m.roles.length > 0);

  const rosterEmails = useMemo(
    () => Array.from(new Set(members.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))),
    [members],
  );

  const [allProfiles, setAllProfiles] = useState<ProfileLite[]>([]);
  const [byEmail, setByEmail] = useState<Record<string, ProfileLite>>({});
  const [sheet, setSheet] = useState<{ id: string; name: string; avatar: string | null } | null>(null);
  const [editing, setEditing] = useState<RosterEntry | "new" | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let alive = true;
    (async () => {
      const all = await fetchProfiles();
      const map: Record<string, ProfileLite> = {};
      if (supabase && rosterEmails.length) {
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, contact_email")
          .in("contact_email", rosterEmails);
        for (const p of (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; contact_email: string | null }[]) {
          const e = (p.contact_email ?? "").toLowerCase();
          if (e) map[e] = { id: p.id, name: p.display_name?.trim() || "Member", avatarUrl: p.avatar_url ?? null };
        }
      }
      if (alive) {
        setAllProfiles(all);
        setByEmail(map);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rosterEmails]);

  const linkFor = (m: RosterEntry): ProfileLite | null => {
    if (m.linkedUserId) {
      return { id: m.linkedUserId, name: m.linkedName ?? m.name, avatarUrl: m.linkedAvatarUrl ?? null };
    }
    const e = m.email?.toLowerCase();
    if (e && byEmail[e]) return byEmail[e];
    return allProfiles.find((p) => nameMatches(m.name, p.name)) ?? null;
  };

  /** Build a mailto: link (bcc keeps addresses private) for a set of people. */
  const mailtoFor = (entries: RosterEntry[], subject: string): string | null => {
    const emails = Array.from(new Set(entries.map((e) => e.email?.trim()).filter((e): e is string => !!e)));
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
        <CommitteeBadge name={display} />
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
          <CommitteeMemberContact email={m.email} phone={m.phone} />
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

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {/* Link to a real account */}
        {linkedUserId ? (
          <div className="flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2 text-sm ring-1 ring-primary/20">
            <span className="font-medium text-primary">🔗 {linkedName ?? "Linked account"}</span>
            <button type="button" onClick={() => { setLinkedUserId(null); setLinkedName(null); }} className="press text-xs font-semibold text-accent">Unlink</button>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="🔗 Link a member account — search…"
              className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            {matches.length > 0 && (
              <ul className="overflow-hidden rounded-xl ring-1 ring-border">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { setLinkedUserId(p.id); setLinkedName(p.name); if (!name.trim()) setName(p.name); setPickQuery(""); }}
                      className="press flex w-full items-center gap-2 bg-card px-3 py-2 text-left text-sm hover:bg-background"
                    >
                      <Avatar name={p.name} url={p.avatarUrl} size={22} />
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
