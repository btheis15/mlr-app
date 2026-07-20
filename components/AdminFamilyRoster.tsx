"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { House } from "@/lib/types";
import { fetchHouses } from "@/lib/houses";
import {
  fetchFamilyRoster,
  familyRosterReady,
  saveFamilyRosterEntry,
  setFamilyRosterHouse,
  deleteFamilyRosterEntry,
  type FamilyRosterEntry,
} from "@/lib/familyRoster";
import { inviteByEmailLink } from "@/lib/admin";
import { Avatar } from "@/components/Avatar";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonList } from "@/components/Skeleton";
import { plural } from "@/lib/format";
import { useBusyAction, useSaveStatus } from "@/lib/hooks";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Admin → Houses: the **Family roster** — family who aren't on the app yet. Give
 * each a temporary name + email (+ optional phone), assign them to a house, and
 * they'll be reachable by every house/resort email. When they sign up with that
 * email, their slot auto-links to the new account, carrying the house + temp name
 * onto it (they can rename after). An "Invite" button fires the branded
 * welcome-email that signs them straight in. Writes are admin-gated (migration
 * 0123 RLS); this UI is already behind AdminGuard.
 */
export function AdminFamilyRoster() {
  const [houses, setHouses] = useState<House[]>([]);
  const [people, setPeople] = useState<FamilyRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const { busy: busyId, run } = useBusyAction();
  const invited = useSaveStatus();

  // Add form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [houseId, setHouseId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    if (!isSupabaseConfigured) return;
    const ok = await familyRosterReady();
    setReady(ok);
    setHouses(await fetchHouses());
    if (ok) setPeople(await fetchFamilyRoster());
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const houseName = (hid: string | null) => (hid ? houses.find((h) => h.id === hid)?.name ?? null : null);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setAdding(true);
    const { error } = await saveFamilyRosterEntry({
      name: n,
      email: email.trim() || null,
      phone: phone.trim() || null,
      houseId,
    });
    setAdding(false);
    if (error) { window.alert(error); return; }
    setName(""); setEmail(""); setPhone(""); setHouseId(null);
    load();
  };

  const assign = async (p: FamilyRosterEntry, hid: string | null) => {
    const { error } = await run(p.id, () => setFamilyRosterHouse(p.id, hid));
    if (error) { window.alert(error); return; }
    setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, houseId: hid } : x)));
  };

  const remove = async (p: FamilyRosterEntry) => {
    if (!window.confirm(`Remove ${p.name} from the family roster?\n\nThis only removes the placeholder — it never touches a real account.`)) return;
    const { error } = await deleteFamilyRosterEntry(p.id);
    if (error) { window.alert(error); return; }
    setPeople((prev) => prev.filter((x) => x.id !== p.id));
  };

  const invite = async (p: FamilyRosterEntry) => {
    if (!p.email) return;
    await run(p.id, async () => {
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) { invited.show("Sign in again to send invites.", 4000); return {}; }
      try {
        const r = await inviteByEmailLink([{ email: p.email!, name: p.name }], token);
        const ok = r[0]?.ok;
        invited.show(ok ? `Invite sent to ${p.name} ✓` : `Couldn't invite ${p.name}: ${r[0]?.error ?? "failed"}`, ok ? 3000 : 6000);
      } catch (err) {
        invited.show(err instanceof Error ? err.message : "Couldn't send invite.", 6000);
      }
      return {};
    });
  };

  if (!isSupabaseConfigured) {
    return <p className="px-1 text-xs text-muted">The family roster turns on once the backend is connected.</p>;
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? people.filter((p) => [p.name, p.email, p.phone, houseName(p.houseId)].some((f) => f?.toLowerCase().includes(q)))
    : people;
  const onApp = people.filter((p) => p.linkedUserId).length;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Family roster</h2>
        <span className="ml-auto text-xs text-faint">
          {people.length} {plural(people.length, "person", "people")}{onApp ? ` · ${onApp} on the app` : ""}
        </span>
      </div>

      <p className="text-xs text-muted">
        Family who aren&rsquo;t on the app yet. Add a name + email so they still get house and resort emails, and assign
        them to a house. When they sign up with that email, this links to their new account automatically — carrying their
        house and this name onto it (they can rename after). Use <strong>Invite</strong> to email them a one-tap sign-in.
      </p>

      {/* Add a person */}
      <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
        <p className="text-xs font-semibold text-foreground/70">Add someone</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name to show (e.g. Grandma Kity)"
          className="w-full rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            inputMode="email"
            autoCapitalize="none"
            className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            inputMode="tel"
            className="w-36 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-faint">House:</span>
          <HouseChip label="None" active={!houseId} onClick={() => setHouseId(null)} />
          {houses.map((h) => (
            <HouseChip key={h.id} label={`${h.emoji} ${h.name}`} active={houseId === h.id} onClick={() => setHouseId(h.id)} />
          ))}
        </div>
        {email.trim() && !EMAIL_RE.test(email.trim()) && (
          <p className="text-xs text-accent">That doesn&rsquo;t look like a valid email.</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={add}
            disabled={adding || !name.trim() || (!!email.trim() && !EMAIL_RE.test(email.trim()))}
            className="press shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {adding ? "…" : "Add to roster"}
          </button>
        </div>
      </div>

      {!ready && !loading && (
        <MigrationHint file="0123_family_roster.sql">
          To turn on the family roster,
        </MigrationHint>
      )}

      {invited.status && <p className="text-xs font-medium text-primary">{invited.status}</p>}

      {ready && (
        <>
          {people.length > 5 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the roster…"
              className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          {loading ? (
            <SkeletonList count={2} />
          ) : shown.length === 0 ? (
            <p className="py-3 text-center text-xs text-faint">
              {people.length === 0 ? "No one on the roster yet — add family above." : "No one matches that."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {shown.map((p) =>
                editing === p.id ? (
                  <li key={p.id}>
                    <EditRow entry={p} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
                  </li>
                ) : (
                  <li key={p.id} className="flex flex-col gap-2 rounded-xl bg-background p-2.5 ring-1 ring-border">
                    <div className="flex items-center gap-3">
                      <Avatar name={p.linkedName || p.name} url={p.linkedAvatarUrl} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {p.linkedName || p.name}
                          {p.linkedUserId && (
                            <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary align-middle">
                              ✓ On the app
                            </span>
                          )}
                        </p>
                        {p.email && <p className="truncate text-xs text-faint">{p.email}</p>}
                        {p.phone && <p className="truncate text-xs text-faint">{p.phone}</p>}
                      </div>
                      {!p.linkedUserId && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <button
                            onClick={() => invite(p)}
                            disabled={!p.email || busyId === p.id}
                            title={p.email ? "Send the welcome email" : "Add an email first"}
                            className="press rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            💌 Invite
                          </button>
                          <div className="flex gap-1">
                            <button onClick={() => setEditing(p.id)} className="press rounded-full px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/30">Edit</button>
                            <button onClick={() => remove(p)} className="press rounded-full px-2 py-0.5 text-xs font-semibold text-accent ring-1 ring-accent/30">Remove</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {p.linkedUserId ? (
                      <p className="text-xs text-faint">
                        Signed up — now a real member{houseName(p.houseId) ? ` (pre-set to ${houseName(p.houseId)})` : ""}. Manage them in{" "}
                        <span className="font-medium">Admin → Members</span>.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HouseChip label="None" active={!p.houseId} disabled={busyId === p.id} onClick={() => assign(p, null)} />
                        {houses.map((h) => (
                          <HouseChip
                            key={h.id}
                            label={`${h.emoji} ${h.name}`}
                            active={p.houseId === h.id}
                            disabled={busyId === p.id}
                            onClick={() => assign(p, h.id)}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EditRow({ entry, onCancel, onSaved }: { entry: FamilyRosterEntry; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(entry.name);
  const [email, setEmail] = useState(entry.email ?? "");
  const [phone, setPhone] = useState(entry.phone ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { error } = await saveFamilyRosterEntry({
      id: entry.id,
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
    });
    setSaving(false);
    if (error) { window.alert(error); return; }
    onSaved();
  };

  return (
    <div className="space-y-2 rounded-xl bg-background p-2.5 ring-1 ring-primary/30">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name to show" className="w-full rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      <div className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" autoCapitalize="none" className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" className="w-32 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="press rounded-lg bg-background px-3 py-2 text-xs font-semibold text-muted ring-1 ring-border">Cancel</button>
        <button onClick={save} disabled={saving || !name.trim()} className="press rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "…" : "Save"}</button>
      </div>
    </div>
  );
}

function HouseChip({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors disabled:opacity-50 ${
        active ? "bg-primary text-white ring-primary" : "bg-card text-muted ring-border"
      }`}
    >
      {label}
    </button>
  );
}
