"use client";

import { useMemo, useState } from "react";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { Avatar } from "@/components/Avatar";
import { useSheetDismiss } from "@/lib/hooks";
import { createPrivateActivity, type MemberInput } from "@/lib/privateActivities";

export interface MemberOption {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const EMOJI_PICKS = ["🏓", "🎯", "🎲", "🏆", "🃏", "⛳️", "🏀", "🎱", "🥏", "🎳"];

/**
 * "Create an Activity" — a member sets up a private, invite-only get-together
 * (often a quick tournament) shared with only the people they add. Nobody else
 * sees it, and nobody is notified unless the organizer ticks "Let them know".
 */
export function PrivateActivityComposer({
  members,
  myId,
  onClose,
  onCreated,
}: {
  /** The member directory to invite from (the Events page already loads it). */
  members: MemberOption[];
  myId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🏓");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isTournament, setIsTournament] = useState(true);
  const [noTime, setNoTime] = useState(true);
  const [when, setWhen] = useState("");
  const [notify, setNotify] = useState(false);

  // Invite list: linked members (by id) + free-typed names for people not on the app.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState<string[]>([]);
  const [typing, setTyping] = useState("");
  const [search, setSearch] = useState("");

  const invitable = useMemo(
    () => members.filter((m) => m.id !== myId).sort((a, b) => a.name.localeCompare(b.name)),
    [members, myId],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? invitable.filter((m) => m.name.toLowerCase().includes(q)) : invitable;
  }, [invitable, search]);
  const inviteCount = picked.size + typed.length;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addTyped = () => {
    const name = typing.trim();
    if (!name) return;
    setTyped((cur) => (cur.some((n) => n.toLowerCase() === name.toLowerCase()) ? cur : [...cur, name]));
    setTyping("");
  };

  const create = async () => {
    if (!title.trim()) {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const memberInputs: MemberInput[] = [
      ...Array.from(picked).map((id) => ({ userId: id })),
      ...typed.map((name) => ({ name })),
    ];
    let startsAt: string | null = null;
    if (!noTime && when) {
      const d = new Date(when);
      if (!Number.isNaN(d.getTime())) startsAt = d.toISOString();
    }
    const { id, error: err } = await createPrivateActivity({
      title: title.trim(),
      emoji: emoji || null,
      location: location.trim() || null,
      description: description.trim() || null,
      startsAt,
      tournamentEnabled: isTournament,
      members: memberInputs,
      notify,
    });
    if (err || !id) {
      setError(err ?? "Couldn't create it.");
      setBusy(false);
      return;
    }
    setBusy(false);
    onCreated(id);
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="activity-create-title"
      header={<h2 id="activity-create-title" className="text-lg font-bold">Create an activity</h2>}
      footer={
        <div className="space-y-2">
          {error && <p className="text-center text-sm text-accent">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="w-full rounded-2xl bg-primary py-3.5 font-semibold text-white disabled:opacity-40"
          >
            {inviteCount > 0 ? `Create & share with ${inviteCount}` : "Create activity"}
          </button>
          <p className="text-center text-[11px] text-foreground/45">
            Private — only the people you add can see it.
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <SectionLabel>What is it?</SectionLabel>
          <div className="flex gap-2">
            <input
              className={`${FIELD} w-14 shrink-0 text-center text-xl`}
              value={emoji}
              onChange={(e) => setEmoji([...e.target.value].slice(-2).join(""))}
              aria-label="Emoji"
            />
            <input
              className={FIELD}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ping-pong tournament"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EMOJI_PICKS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={`grid h-8 w-8 place-items-center rounded-full text-lg ring-1 ${
                  emoji === e ? "bg-primary/10 ring-primary/30" : "ring-border"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>When</SectionLabel>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noTime} onChange={(e) => setNoTime(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            No set time — we&rsquo;ll just play
          </label>
          {!noTime && (
            <input
              type="datetime-local"
              className={`${FIELD} mt-2`}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          )}
        </div>

        <div>
          <SectionLabel>Where (optional)</SectionLabel>
          <input className={FIELD} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Garage / dock / rec room" />
        </div>

        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
          <span>
            <span className="block text-sm font-semibold">🏆 Make it a tournament</span>
            <span className="block text-xs text-foreground/55">A bracket, round-robin, or pools — scores &amp; standings live</span>
          </span>
          <input type="checkbox" checked={isTournament} onChange={(e) => setIsTournament(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
        </label>

        <div>
          <SectionLabel>Who&rsquo;s playing</SectionLabel>
          <p className="mb-2 text-xs text-foreground/55">
            Only the people you add can see this activity. Add family on the app, or type a name for anyone who isn&rsquo;t.
          </p>
          <div className="flex gap-2">
            <input className={FIELD} value={typing} onChange={(e) => setTyping(e.target.value)} placeholder="Type a name (no app needed)" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTyped())} />
            <button type="button" disabled={!typing.trim()} onClick={addTyped} className="shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">Add</button>
          </div>
          {typed.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {typed.map((name) => (
                <span key={name} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs ring-1 ring-border">
                  {name}
                  <button type="button" onClick={() => setTyped((cur) => cur.filter((n) => n !== name))} className="text-accent" aria-label={`Remove ${name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          {invitable.length > 0 && (
            <>
              <input className={`${FIELD} mt-3`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search family…" />
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {filtered.map((m) => {
                  const on = picked.has(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => toggle(m.id)}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ring-1 ${on ? "bg-primary/10 ring-primary/30" : "ring-border"}`}
                      >
                        <Avatar name={m.name} url={m.avatarUrl ?? undefined} size={28} />
                        <span className="flex-1 truncate text-sm">{m.name}</span>
                        <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${on ? "bg-primary text-white" : "ring-1 ring-border"}`}>{on ? "✓" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
          <span>
            <span className="block text-sm font-semibold">🔔 Let them know</span>
            <span className="block text-xs text-foreground/55">Send a notification to the people you added (only them). Off = no one is pinged.</span>
          </span>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
        </label>
      </div>
    </Sheet>
  );
}
