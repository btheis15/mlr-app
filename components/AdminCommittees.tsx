"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { AdminJoinRequests } from "@/components/AdminJoinRequests";
import { CommitteeMembers } from "@/components/CommitteeMembers";
import {
  fetchCommittees,
  fetchCommitteeAreas,
  createCommittee,
  updateCommittee,
  archiveCommittee,
  restoreCommittee,
  addCommitteeArea,
  renameCommitteeArea,
  archiveCommitteeArea,
  restoreCommitteeArea,
  type CommitteeRow,
  type CommitteeAreaRow,
} from "@/lib/committeeAdmin";

/**
 * App-admin management of the committee TAXONOMY (Profile → Admin → Committees):
 * create / rename / "delete" (archive) committees, add / rename / archive the
 * ROLES inside each (each role is its own chat channel, migration 0063), plus
 * the existing per-committee join-request queue + membership controls.
 *
 * "Delete" is an ARCHIVE (migration 0112): nothing is destroyed — the committee
 * or role drops out of the live app and its chat goes read-only, but the roster
 * stays intact and Restore brings it fully back. Archived committees live in a
 * quiet section at the bottom; the archived chat history itself surfaces under
 * "Archived chats" on the Feed tab.
 */
export function AdminCommittees() {
  const [committees, setCommittees] = useState<CommitteeRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({}); // slug -> pending count
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const rows = await fetchCommittees();
    setCommittees(rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Deep-link from a "X asked to join <committee>" notification
  // (/admin/committees?committee=<slug>) — auto-expand that committee.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const slug = new URLSearchParams(window.location.search).get("committee");
    if (!slug) return;
    setOpen(slug);
    window.setTimeout(
      () => document.getElementById(`committee-${slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      150,
    );
  }, []);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    const loadCounts = async () => {
      const [{ data: cs }, { data: reqs }] = await Promise.all([
        sb.from("committees").select("id, slug"),
        sb.from("committee_join_requests").select("committee_id").eq("status", "pending"),
      ]);
      if (cancelled) return;
      const idToSlug = new Map(((cs ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
      const counts: Record<string, number> = {};
      for (const r of (reqs ?? []) as { committee_id: string }[]) {
        const slug = idToSlug.get(r.committee_id);
        if (slug) counts[slug] = (counts[slug] ?? 0) + 1;
      }
      setPending(counts);
    };
    loadCounts();
    const ch = sb
      .channel("admin-committee-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_join_requests" }, () => loadCounts())
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(ch);
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <p className="px-1 text-xs text-muted">Committee management turns on once the backend is connected.</p>;
  }

  const live = (committees ?? []).filter((c) => !c.archivedAt);
  const archived = (committees ?? []).filter((c) => c.archivedAt);

  return (
    <div className="space-y-4">
      {/* Create a new committee */}
      {creating ? (
        <CommitteeCreate onDone={() => { setCreating(false); void reload(); }} onCancel={() => setCreating(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="press w-full rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-sm font-semibold text-primary"
        >
          ＋ New committee
        </button>
      )}

      <div className="space-y-2">
        {live.map((c) => {
          const isOpen = open === c.slug;
          const count = pending[c.slug] ?? 0;
          const isSeed = c.id === c.slug; // seed fallback row (no real uuid) — can't manage yet
          return (
            <div key={c.slug} id={`committee-${c.slug}`} className="rounded-2xl bg-background ring-1 ring-border">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.slug)}
                aria-expanded={isOpen}
                className="press flex w-full items-center gap-3 p-3 text-left"
              >
                <span className="shrink-0 text-lg" aria-hidden>{c.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                {count > 0 && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                    {count} request{count === 1 ? "" : "s"}
                  </span>
                )}
                <span className={`shrink-0 text-foreground/40 transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${isOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
              </button>
              {isOpen && (
                <div className="space-y-3 px-3 pb-3">
                  {isSeed ? (
                    <p className="rounded-xl bg-card px-3 py-2 text-xs text-muted ring-1 ring-border">
                      Run the migration to manage this committee&rsquo;s details + roles.
                    </p>
                  ) : (
                    <>
                      <CommitteeDetailsEditor committee={c} onSaved={reload} />
                      <RolesManager committeeId={c.id} />
                    </>
                  )}
                  <AdminJoinRequests slug={c.slug} name={c.name} />
                  <CommitteeMembers slug={c.slug} name={c.name} />
                  {!isSeed && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${c.name}"? Its chats become read-only and it moves to Archived — you can restore it anytime. Nobody loses their history.`)) return;
                        const { error } = await archiveCommittee(c.id);
                        if (error) window.alert(error);
                        else { setOpen(null); void reload(); }
                      }}
                      className="press w-full rounded-xl bg-accent/10 py-2 text-xs font-semibold text-accent"
                    >
                      Delete committee (archive)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {committees === null && <p className="px-1 text-xs text-faint">Loading…</p>}
      </div>

      {/* Archived committees — quiet, restorable. */}
      {archived.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-background/60 p-3 ring-1 ring-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">Archived committees</p>
          {archived.map((c) => (
            <div key={c.slug} className="flex items-center gap-2">
              <span aria-hidden>{c.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/60">{c.name}</span>
              <button
                type="button"
                onClick={async () => {
                  const { error } = await restoreCommittee(c.id);
                  if (error) window.alert(error);
                  else void reload();
                }}
                className="press shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
              >
                Restore
              </button>
            </div>
          ))}
          <p className="text-[11px] text-faint">Old chat history stays under &ldquo;Archived chats&rdquo; on the Feed tab. Restore brings the committee fully back, roster and all.</p>
        </div>
      )}
    </div>
  );
}

// ── Create a committee ────────────────────────────────────────────────────────
function CommitteeCreate({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🌲");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await createCommittee(name.trim(), emoji.trim() || "🌲", description.trim());
    setBusy(false);
    if (error) setError(error);
    else onDone();
  };

  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-primary/30">
      <h3 className="text-sm font-semibold">New committee</h3>
      <div className="flex gap-2">
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🌲" className="w-14 rounded-xl bg-background px-3 py-2.5 text-center text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Committee name" className="flex-1 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this committee does (optional)" rows={2} className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      {error && <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="press flex-1 rounded-xl bg-background py-2.5 text-sm font-semibold ring-1 ring-border">Cancel</button>
        <button type="button" onClick={save} disabled={busy || !name.trim()} className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

// ── Edit a committee's name / emoji / description ──────────────────────────────
function CommitteeDetailsEditor({ committee, onSaved }: { committee: CommitteeRow; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(committee.name);
  const [emoji, setEmoji] = useState(committee.emoji);
  const [description, setDescription] = useState(committee.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="press text-xs font-semibold text-primary">
        ✎ Edit committee details
      </button>
    );
  }
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await updateCommittee(committee.id, name.trim(), emoji.trim() || committee.emoji, description.trim());
    setBusy(false);
    if (error) setError(error);
    else { setEditing(false); await onSaved(); }
  };
  return (
    <div className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-border">
      <div className="flex gap-2">
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-14 rounded-lg bg-background px-2 py-2 text-center text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description" className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      {error && <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs font-medium text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => { setEditing(false); setName(committee.name); setEmoji(committee.emoji); setDescription(committee.description); }} className="press flex-1 rounded-lg bg-background py-2 text-xs font-semibold ring-1 ring-border">Cancel</button>
        <button type="button" onClick={save} disabled={busy || !name.trim()} className="press flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── Manage a committee's roles (each role = a chat channel) ────────────────────
function RolesManager({ committeeId }: { committeeId: string }) {
  const [areas, setAreas] = useState<CommitteeAreaRow[] | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const load = useCallback(async () => {
    // We need the committee slug to read areas; committeeAdmin keys areas by
    // slug, so resolve it once from the id.
    const sb = supabase;
    if (!sb) return;
    const { data } = await sb.from("committees").select("slug").eq("id", committeeId).maybeSingle();
    const slug = (data as { slug: string } | null)?.slug;
    if (!slug) { setAreas([]); return; }
    setAreas(await fetchCommitteeAreas(slug, true));
  }, [committeeId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setError(error);
    else { after?.(); await load(); }
  };

  const live = (areas ?? []).filter((a) => !a.archivedAt);
  const archived = (areas ?? []).filter((a) => a.archivedAt);

  return (
    <div className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-border">
      <p className="text-xs font-bold uppercase tracking-wide text-faint">Roles &amp; subcommittees</p>
      <p className="text-[11px] text-faint">Each role is its own chat channel. Add one, put people on it in the roster below, and it becomes joinable.</p>

      {live.map((a) => (
        <div key={a.area} className="flex items-center gap-2">
          {renaming === a.area ? (
            <>
              <input
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                autoFocus
                className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
              />
              <button type="button" disabled={busy || !renameTo.trim()} onClick={() => run(() => renameCommitteeArea(committeeId, a.area, renameTo.trim()), () => setRenaming(null))} className="press shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setRenaming(null)} className="press shrink-0 px-1.5 text-xs text-foreground/50">Cancel</button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm">{a.area}</span>
              <button type="button" onClick={() => { setRenaming(a.area); setRenameTo(a.area); }} className="press shrink-0 rounded-full px-1.5 text-foreground/40 hover:text-primary" aria-label="Rename role">✎</button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete the "${a.area}" role? Its chat becomes read-only and moves to Archived — restore it anytime.`)) return;
                  void run(() => archiveCommitteeArea(committeeId, a.area));
                }}
                className="press shrink-0 rounded-full px-1.5 text-foreground/40 hover:text-accent"
                aria-label="Delete role"
              >🗑</button>
            </>
          )}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add a role…"
          className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          disabled={busy || !adding.trim()}
          onClick={() => run(() => addCommitteeArea(committeeId, adding.trim()), () => setAdding(""))}
          className="press shrink-0 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
        >
          + Add
        </button>
      </div>

      {error && <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs font-medium text-accent">{error}</p>}

      {archived.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/40">Archived roles</p>
          {archived.map((a) => (
            <div key={a.area} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/50">{a.area}</span>
              <button type="button" onClick={() => run(() => restoreCommitteeArea(committeeId, a.area))} className="press shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
