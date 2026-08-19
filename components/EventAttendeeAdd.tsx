"use client";

import { useEffect, useState } from "react";
import type { AttendanceStatus, EventAttendance } from "@/lib/types";
import { addEventFamilyMember, addEventGuest } from "@/lib/events";
import { fetchMemberOptions, type FestMemberOption } from "@/lib/festContent";
import { fetchFamilyRoster, type FamilyRosterEntry } from "@/lib/familyRoster";
import { Sheet, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

// Manually add someone to an event's RSVP list (migration 0196) — for the
// event email's "reply here and you'll be added by hand" line. TWO
// deliberately separate entry points, not one "type a name" box:
//
//   "Add someone in the family" — search-and-pick ONLY, never typed. Covers
//   both a real member (has an app account) and a pre-registered
//   family_roster person who doesn't yet — the exact case that was easy to
//   miss when the UI didn't distinguish it.
//
//   "Add a guest" — a typed name, for someone who isn't family at all (a
//   friend brought up to help). There's genuinely nothing to search for here.
//
// Collapsing these into one free-text field is what this component exists to
// avoid: someone already known to the app would silently become a second,
// disconnected "person" instead of their real record.

type Mode = "choose" | "family" | "guest";

export function EventAttendeeAdd({
  eventId,
  existing,
  onClose,
  onAdded,
}: {
  eventId: string;
  /** Current attendance rows — used to exclude people already on the list. */
  existing: EventAttendance[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [mode, setMode] = useState<Mode>("choose");

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="add-attendee-title"
      header={
        <>
          <h2 id="add-attendee-title" className="text-lg font-bold">
            {mode === "choose" ? "Add someone" : mode === "family" ? "👪 Add someone in the family" : "🙋 Add a guest"}
          </h2>
          {mode !== "choose" && (
            <button type="button" onClick={() => setMode("choose")} className="press text-xs font-semibold text-primary">
              ← Back
            </button>
          )}
        </>
      }
    >
      {mode === "choose" && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setMode("family")}
            className="press flex w-full items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">👪 Add someone in the family</span>
              <span className="block text-xs text-muted">
                A real member, or someone already on the family roster without an app account yet.
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-foreground/40">›</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("guest")}
            className="press flex w-full items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">🙋 Add a guest</span>
              <span className="block text-xs text-muted">Someone who isn&rsquo;t family — a friend they&rsquo;re bringing to help.</span>
            </span>
            <span aria-hidden className="shrink-0 text-foreground/40">›</span>
          </button>
        </div>
      )}
      {mode === "family" && <FamilyPicker eventId={eventId} existing={existing} onDone={() => { onAdded(); close(); }} />}
      {mode === "guest" && <GuestForm eventId={eventId} onDone={() => { onAdded(); close(); }} />}
    </Sheet>
  );
}

type FamilyOption =
  | { kind: "member"; id: string; name: string; avatarUrl: string | null }
  | { kind: "roster"; id: string; name: string; avatarUrl: string | null };

function FamilyPicker({
  eventId,
  existing,
  onDone,
}: {
  eventId: string;
  existing: EventAttendance[];
  onDone: () => void;
}) {
  const [options, setOptions] = useState<FamilyOption[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("going");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const alreadyUserIds = new Set(existing.map((e) => e.userId).filter(Boolean));
    const alreadyRosterIds = new Set(existing.map((e) => e.rosterId).filter(Boolean));
    Promise.all([fetchMemberOptions(), fetchFamilyRoster()]).then(([members, roster]: [FestMemberOption[], FamilyRosterEntry[]]) => {
      const memberOpts: FamilyOption[] = members
        .filter((m) => !alreadyUserIds.has(m.id))
        .map((m) => ({ kind: "member", id: m.id, name: m.name, avatarUrl: m.avatarUrl }));
      // Only people with NO account yet — someone already linked shows up in
      // `members` above via their real profile, so listing them again here
      // (as a roster row) would offer two ways to add the same person.
      const rosterOpts: FamilyOption[] = roster
        .filter((r) => !r.linkedUserId && !alreadyRosterIds.has(r.id))
        .map((r) => ({ kind: "roster", id: r.id, name: r.name, avatarUrl: null }));
      setOptions([...memberOpts, ...rosterOpts].sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, [existing]);

  const filtered = (options ?? []).filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));

  const pick = async (opt: FamilyOption) => {
    setPendingId(opt.id);
    setError(null);
    // ⚠️ try/finally, not a bare await: if the call throws rather than returning
    // an error, `pendingId` would stay set and EVERY row in the list would be
    // left permanently disabled — a dead sheet with nothing explaining why.
    try {
      const { error: err } =
        opt.kind === "member"
          ? await addEventFamilyMember(eventId, { userId: opt.id }, status)
          : await addEventFamilyMember(eventId, { rosterId: opt.id }, status);
      if (err) {
        setError(err);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add them. Try again.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <StatusPicker value={status} onChange={setStatus} />
      {/* ⚠️ THE ERROR BELONGS UP HERE, not under the list. It used to render
          after a ~40-person scrolling list, i.e. far below the fold — so a
          failed add was indistinguishable from the button doing nothing at all.
          Feedback has to appear where the person is actually looking. */}
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the family…"
        className={`${FIELD} w-full`}
      />
      {options === null ? (
        <p className="py-6 text-center text-xs text-faint">Loading…</p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((opt) => (
            <li key={`${opt.kind}:${opt.id}`}>
              <button
                type="button"
                onClick={() => pick(opt)}
                disabled={pendingId !== null}
                className="press flex w-full items-center justify-between gap-2 rounded-xl bg-card px-3 py-2.5 text-left ring-1 ring-border disabled:opacity-50"
              >
                <span className="text-sm font-medium">{opt.name}</span>
                {/* Per-row feedback, so a tap visibly does something even on a
                    slow connection — the list is long and the sheet only closes
                    once the write lands. */}
                {pendingId === opt.id ? (
                  <span className="shrink-0 text-xs font-semibold text-primary">Adding…</span>
                ) : (
                  opt.kind === "roster" && (
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
                      Not on the app yet
                    </span>
                  )
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-6 text-center text-xs text-foreground/50">
              {options.length === 0 ? "Everyone's already on this event's list." : "No one found."}
            </li>
          )}
        </ul>
      )}
      {/* (The error for this picker is rendered ABOVE the list — see the note
          there. Deliberately not repeated down here, below the fold.) */}
    </>
  );
}

function GuestForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sponsorId, setSponsorId] = useState("");
  const [members, setMembers] = useState<FestMemberOption[] | null>(null);
  const [status, setStatus] = useState<AttendanceStatus>("going");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMemberOptions().then(setMembers);
  }, []);

  const canSubmit = name.trim() && sponsorId && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const { error: err } = await addEventGuest(eventId, name, sponsorId, status, email);
    setPending(false);
    if (err) { setError(err); return; }
    onDone();
  };

  return (
    <>
      <p className="text-xs text-muted">
        For someone who isn&rsquo;t family — they won&rsquo;t get an app account or show up anywhere else, just on this
        event&rsquo;s list.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Guest's name"
        className={`${FIELD} w-full`}
        autoFocus
      />
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-foreground/70">Who do they know?</label>
        <select
          value={sponsorId}
          onChange={(e) => setSponsorId(e.target.value)}
          className={`${FIELD} w-full`}
        >
          <option value="">{members === null ? "Loading members…" : "Select a member…"}</option>
          {members?.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <p className="text-[11px] text-faint">
          Picked the wrong person? Just choose a different one from the list — nothing&rsquo;s locked in until you tap
          Add guest.
        </p>
      </div>
      <div className="space-y-1">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their email (optional)"
          type="email"
          className={`${FIELD} w-full`}
        />
        <p className="text-[11px] text-faint">
          Since they&rsquo;re not on the app, an email is the only way to keep them in the loop — they&rsquo;ll get
          updates about just THIS event (new tasks, notes, changes), and nothing else.
        </p>
      </div>
      <StatusPicker value={status} onChange={setStatus} />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add guest"}
      </button>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
    </>
  );
}

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "not_going", label: "Can't make it" },
];

function StatusPicker({ value, onChange }: { value: AttendanceStatus; onChange: (s: AttendanceStatus) => void }) {
  return (
    <div className="flex gap-1.5">
      {STATUS_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`press flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
            value === o.value ? "bg-primary text-white ring-primary" : "bg-card text-foreground/65 ring-border"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
