"use client";

import { useMemo, useState } from "react";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { Avatar } from "@/components/Avatar";
import { TournamentSection } from "@/components/TournamentView";
import { useSheetDismiss } from "@/lib/hooks";
import type { MemberOption } from "@/components/PrivateActivityComposer";
import {
  addPrivateActivityMember,
  removePrivateActivityMember,
  setPrivateActivityMemberRole,
  setPrivateActivityRsvp,
  setPrivateActivityArchived,
  deletePrivateActivity,
  updatePrivateActivity,
  type PrivateActivity,
  type ActivityRsvp,
} from "@/lib/privateActivities";

const RSVP_LABEL: Record<ActivityRsvp, string> = { going: "Going", maybe: "Maybe", out: "Can't" };

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

/**
 * A private activity's detail — roster + RSVP, the tournament (if it is one), and
 * host controls (add/remove people, edit, archive when it's over, delete). Only
 * shown to people who can see the activity (RLS already guarantees that).
 */
export function PrivateActivitySheet({
  activity,
  members,
  myId,
  onClose,
  onChanged,
}: {
  activity: PrivateActivity;
  members: MemberOption[];
  myId: string | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const canManage = activity.canManage;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState("");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  // edit-details fields
  const [title, setTitle] = useState(activity.title);
  const [location, setLocation] = useState(activity.location ?? "");

  const myRow = useMemo(() => activity.members.find((m) => m.userId === myId) ?? null, [activity.members, myId]);
  const alreadyIn = useMemo(() => new Set(activity.members.map((m) => m.userId).filter(Boolean) as string[]), [activity.members]);
  const invitable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => !alreadyIn.has(m.id))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, alreadyIn, search]);

  const refresh = async () => {
    await onChanged();
  };

  const addMember = async (member: { userId?: string; name?: string }) => {
    setBusy(true);
    await addPrivateActivityMember(activity.id, member, { notify: false });
    await refresh();
    setBusy(false);
  };
  const addTyped = async () => {
    const name = typing.trim();
    if (!name) return;
    setTyping("");
    await addMember({ name });
  };

  const when = whenLabel(activity.startsAt);
  const going = activity.members.filter((m) => m.rsvp === "going");
  const other = activity.members.filter((m) => m.rsvp !== "going");

  const saveEdit = async () => {
    setBusy(true);
    await updatePrivateActivity(activity.id, { title: title.trim() || activity.title, location: location.trim() || null });
    await refresh();
    setBusy(false);
    setEditing(false);
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="activity-detail-title"
      header={
        <div className="flex items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <h2 id="activity-detail-title" className="truncate text-lg font-bold">
              {activity.emoji ? `${activity.emoji} ` : ""}{activity.title}
            </h2>
            <p className="text-xs text-foreground/55">
              <span className="font-medium text-primary">Private</span>
              {when ? ` · ${when}` : " · No set time"}
              {activity.location ? ` · ${activity.location}` : ""}
            </p>
          </div>
          {canManage && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-border">
              Edit
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {editing && (
          <section className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
            <div>
              <SectionLabel>Name</SectionLabel>
              <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <SectionLabel>Where</SectionLabel>
              <input className={FIELD} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={saveEdit} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-xl bg-background px-4 text-sm font-medium text-foreground/60 ring-1 ring-border">Cancel</button>
            </div>
          </section>
        )}

        {activity.description && <p className="text-sm text-foreground/70">{activity.description}</p>}

        {/* My RSVP */}
        {myRow && (
          <section>
            <SectionLabel>Are you in?</SectionLabel>
            <div className="flex gap-2">
              {(["going", "maybe", "out"] as ActivityRsvp[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={async () => {
                    await setPrivateActivityRsvp(activity.id, myRow.rsvp === r ? null : r);
                    await refresh();
                  }}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ring-1 ${
                    myRow.rsvp === r ? "bg-primary text-white ring-primary" : "bg-card text-foreground/70 ring-border"
                  }`}
                >
                  {RSVP_LABEL[r]}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Tournament (if this activity is one) */}
        <TournamentSection
          host={{ kind: "activity", id: activity.id }}
          canManage={canManage}
          itemTitle={activity.title}
          enabled={activity.tournamentEnabled}
        />

        {/* Roster */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Who&rsquo;s in ({activity.members.length})</SectionLabel>
            {canManage && (
              <button type="button" onClick={() => setAdding((v) => !v)} className="text-xs font-semibold text-primary">
                {adding ? "Done" : "＋ Add people"}
              </button>
            )}
          </div>

          {adding && canManage && (
            <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
              <div className="flex gap-2">
                <input className={FIELD} value={typing} onChange={(e) => setTyping(e.target.value)} placeholder="Type a name (no app needed)" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTyped())} />
                <button type="button" disabled={busy || !typing.trim()} onClick={addTyped} className="shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">Add</button>
              </div>
              {members.length > 0 && (
                <>
                  <input className={FIELD} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search family…" />
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {invitable.map((m) => (
                      <li key={m.id}>
                        <button type="button" disabled={busy} onClick={() => addMember({ userId: m.id })} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ring-1 ring-border disabled:opacity-50">
                          <Avatar name={m.name} url={m.avatarUrl ?? undefined} size={28} />
                          <span className="flex-1 truncate text-sm">{m.name}</span>
                          <span className="text-xs font-semibold text-primary">Add</span>
                        </button>
                      </li>
                    ))}
                    {invitable.length === 0 && <li className="px-1 py-2 text-xs text-foreground/50">Everyone&rsquo;s already in.</li>}
                  </ul>
                </>
              )}
            </div>
          )}

          <ul className="space-y-1.5">
            {[...going, ...other].map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                <Avatar name={m.name} size={28} />
                <span className="flex-1 truncate text-sm">
                  {m.name}
                  {!m.userId && <span className="ml-1 text-[11px] text-foreground/40">(not on app)</span>}
                </span>
                {m.role === "host" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Organizer</span>}
                {m.rsvp && <span className="text-[11px] font-medium text-foreground/50">{RSVP_LABEL[m.rsvp]}</span>}
                {canManage && m.userId !== activity.createdBy && (
                  <div className="flex items-center gap-1.5">
                    {/* Only app members can be organizers (they need an account to
                        log in and manage) — a typed-in name can't. */}
                    {m.userId && (
                      <button
                        type="button"
                        onClick={async () => { await setPrivateActivityMemberRole(m.id, m.role === "host" ? "player" : "host"); await refresh(); }}
                        className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-border"
                      >
                        {m.role === "host" ? "Remove organizer" : "Make organizer"}
                      </button>
                    )}
                    <button type="button" onClick={async () => { await removePrivateActivityMember(m.id); await refresh(); }} className="grid h-6 w-6 place-items-center rounded-full text-accent" aria-label={`Remove ${m.name}`}>×</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <p className="px-0.5 text-[11px] text-foreground/45">
              Organizers can score, invite, and edit. Add someone on the app, then tap <span className="font-medium text-primary">Make organizer</span> to share control. People not on the app can play, but can&rsquo;t be organizers.
            </p>
          )}
        </section>

        {/* Host controls: archive / delete */}
        {canManage && (
          <section className="space-y-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={async () => { setBusy(true); await setPrivateActivityArchived(activity.id, !activity.archivedAt); await refresh(); setBusy(false); }}
              className="w-full rounded-xl bg-card py-2.5 text-sm font-medium ring-1 ring-border"
            >
              {activity.archivedAt ? "♻︎ Unarchive" : "🗄️ Archive (game's over)"}
            </button>
            {confirmDelete ? (
              <div className="rounded-xl bg-accent/10 p-3 ring-1 ring-accent/30">
                <p className="mb-2 text-sm font-medium">Delete this activity for everyone? This can&rsquo;t be undone.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={async () => { setBusy(true); await deletePrivateActivity(activity.id); await refresh(); close(); }} className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-40">Delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-xl bg-background px-4 text-sm font-medium text-foreground/60 ring-1 ring-border">Keep</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="w-full text-center text-xs font-medium text-accent">
                Delete activity
              </button>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
