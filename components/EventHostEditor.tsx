"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionLabel } from "@/components/Sheet";
import { MemberPickerSheet } from "@/components/FestPlanner";
import { PrivateName } from "@/components/Guard";
import { fetchMemberOptions, type FestMemberOption } from "@/lib/festContent";
import { fetchCommittees, type CommitteeRow } from "@/lib/committeeAdmin";
import { addEventHost, fetchEventHosts, removeEventHost, type EventHost } from "@/lib/eventHosts";

/**
 * Who's hosting an event (migration 0209) — a person, several people, a whole
 * committee, or any mix. Shown inside EventSheet to whoever can already manage
 * the event.
 *
 * Hosts are what decide who may change the event and RSVP other people to it:
 *
 *   • no hosts            → any signed-in member
 *   • person host(s)      → those people
 *   • committee with leads → its LEADS only
 *   • committee, no leads  → any member of it
 *
 * …always plus an app admin and the event's creator. The copy below states the
 * live consequence rather than describing the rule abstractly, because the
 * important case is counter-intuitive: naming a host NARROWS access, and
 * removing the last one hands the event back to everybody.
 *
 * ⚠️ Editing hosts lives here rather than in EventComposer on purpose. The
 * composer creates events, and a brand-new event has no id to attach a host row
 * to — which would mean staging hosts and flushing them after the first save
 * (the FestPlanner `flushPendingSlots` dance) for no real gain. Create the event,
 * then hand it to whoever is running it.
 */
export function EventHostEditor({
  eventId,
  hosts: seedHosts,
  onChanged,
}: {
  eventId: string;
  /** First-paint seed only — see `hosts` below. */
  hosts: EventHost[];
  /** Tell the parent to re-fetch too (its own chips, and permissions — removing
   *  the last host WIDENS who can manage the event). */
  onChanged: () => void;
}) {
  // ⚠️⚠️ THIS OWNS ITS OWN LIST, and the prop is only the first paint.
  //
  // It used to render the prop directly, which meant the list was only ever as
  // fresh as whatever the parent happened to thread through — and EventSheet
  // renders on THREE surfaces with three different data setups. On /events the
  // parent refetches; on Home (UpcomingEvents) and the house calendar it never
  // passed hosts at all. So picking "Resort Maintenance" wrote the row, the
  // picker closed, and the panel still said "Nobody yet": the click looked like
  // it did nothing while the database said otherwise.
  //
  // This is the SECOND time this exact shape has bitten this one sheet — PR #572
  // fixed "Add someone to an event does nothing", whose own commit message says
  // it: "One sheet, three surfaces, three different data setups; the only thing
  // that works everywhere is asking the parent to refetch." The lesson didn't
  // hold, because it relies on every future parent remembering. Owning the fetch
  // here cannot be got wrong by a caller.
  const [hosts, setHosts] = useState<EventHost[]>(seedHosts);
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [committees, setCommittees] = useState<CommitteeRow[]>([]);
  const [picking, setPicking] = useState<"person" | "committee" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const map = await fetchEventHosts([eventId]);
    return map.get(eventId) ?? [];
  }, [eventId]);

  // Authoritative load on mount, so the panel is right regardless of what the
  // parent passed (or didn't).
  useEffect(() => {
    let cancelled = false;
    void refresh().then((rows) => {
      if (!cancelled) setHosts(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    void fetchMemberOptions().then(setMembers);
    void fetchCommittees().then((rows) =>
      setCommittees(
        rows.filter(
          (c) =>
            !c.archivedAt &&
            // ⚠️ fetchCommittees falls back to a SEED whose `id` is the slug, not
            // a uuid (see lib/committeeAdmin.ts). Passing one to add_event_host
            // would fail on the uuid cast, so only real DB rows are offerable.
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id),
        ),
      ),
    );
  }, []);

  const run = async (fn: () => Promise<{ error?: string }>, expect: "more" | "fewer") => {
    setBusy(true);
    setError(null);
    setNote(null);
    const before = hosts.length;
    const { error: e } = await fn();
    if (e) {
      setBusy(false);
      setError(e);
      return;
    }
    const rows = await refresh();
    setHosts(rows);
    setBusy(false);
    // ⚠️ A write that returns no error but changes nothing is the failure mode
    // that started this whole investigation — it renders as a click that "did
    // nothing", with no way to tell a silent success from a silent failure. If
    // the list didn't move the way it should have, say so out loud.
    if (expect === "more" && rows.length <= before) {
      setNote("That didn’t seem to save — pull down to refresh and check.");
    } else if (expect === "fewer" && rows.length >= before) {
      setNote("That didn’t seem to save — pull down to refresh and check.");
    }
    onChanged();
  };

  const alreadyHosting = (id: string) =>
    hosts.some((h) => h.userId === id || h.committeeId === id);

  return (
    <div className="space-y-2">
      <SectionLabel>Who&rsquo;s hosting</SectionLabel>

      {hosts.length === 0 ? (
        // ⚠️ NO HOST IS A COMPLETE ANSWER, not an unfinished form — plenty of
        // events genuinely have nobody running them (a holiday weekend, or one
        // somebody put on the calendar without hosting it themselves), and this
        // is also the DEFAULT for every event. So this reads as a statement of
        // how the event currently works, with naming a host offered as the
        // optional narrowing it is. An earlier version said "Nobody yet … Name a
        // host to narrow that", which framed blank as a gap to be filled and
        // quietly nagged on events that should never have one.
        <p className="rounded-xl bg-card p-3 text-xs text-muted ring-1 ring-border">
          <strong className="text-foreground/80">No host — and that&rsquo;s fine.</strong> Anyone in
          the family can change this event and add people to it. Leave it this way for something
          like a holiday weekend, or name a host if one person or committee is running it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {hosts.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-2 rounded-xl bg-card p-2.5 ring-1 ring-border"
            >
              <span aria-hidden className="text-base">
                {h.committeeId ? (h.emoji ?? "🤝") : "🙋"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {h.committeeId ? h.displayName : <PrivateName name={h.displayName} />}
                {h.committeeId && (
                  <span className="ml-1.5 text-xs font-normal text-faint">committee</span>
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeEventHost(h.id), "fewer")}
                aria-label={`Remove ${h.displayName} as host`}
                className="press shrink-0 rounded-full px-2 py-1 text-xs text-foreground/45 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking("person")}
          className="press flex-1 rounded-xl bg-card py-2 text-xs font-semibold text-primary ring-1 ring-border disabled:opacity-50"
        >
          ＋ A person
        </button>
        <button
          type="button"
          disabled={busy || committees.length === 0}
          onClick={() => setPicking("committee")}
          className="press flex-1 rounded-xl bg-card py-2 text-xs font-semibold text-primary ring-1 ring-border disabled:opacity-50"
        >
          ＋ A committee
        </button>
      </div>

      {hosts.some((h) => h.committeeId) && (
        <p className="text-xs text-faint">
          A committee host means its <strong>Leads</strong> can change this event and add people — or
          any member of it, if that committee has no leads.
        </p>
      )}
      {hosts.length > 0 && (
        // Says what removing the last one DOES, so clearing it back to blank
        // reads as a deliberate option rather than something to avoid.
        <p className="text-xs text-faint">
          Remove them all to hand this event back to the whole family.
        </p>
      )}
      {error && <p className="text-xs font-semibold text-accent">{error}</p>}
      {note && <p className="text-xs font-semibold text-accent">{note}</p>}

      {picking === "person" && (
        <MemberPickerSheet
          members={members.filter((m) => !alreadyHosting(m.id))}
          onPick={(m) => {
            setPicking(null);
            void run(() => addEventHost(eventId, { userId: m.id }), "more");
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === "committee" && (
        <CommitteePickerSheet
          committees={committees.filter((c) => !alreadyHosting(c.id))}
          onPick={(c) => {
            setPicking(null);
            void run(() => addEventHost(eventId, { committeeId: c.id }), "more");
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** Committee equivalent of FestPlanner's MemberPickerSheet — same shape, so the
 *  two pickers read identically. */
function CommitteePickerSheet({
  committees,
  onPick,
  onClose,
}: {
  committees: CommitteeRow[];
  onPick: (c: CommitteeRow) => void;
  onClose: () => void;
}) {
  return (
    <MemberPickerSheet
      // Reuse the member picker's search + list chrome by mapping committees
      // onto its option shape — one picker component, no second search box to
      // keep in step. `id` carries the committee uuid straight through.
      members={committees.map((c) => ({
        id: c.id,
        name: `${c.emoji ?? "🤝"} ${c.name}`,
        avatarUrl: null,
      }))}
      onPick={(m) => {
        const match = committees.find((c) => c.id === m.id);
        if (match) onPick(match);
      }}
      onClose={onClose}
    />
  );
}
