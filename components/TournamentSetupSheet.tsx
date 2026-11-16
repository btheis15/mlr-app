"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useSheetDismiss } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";
import {
  createTournamentForHost,
  importEntrantsForHost,
  generateTeams,
  ungroupTeams,
  generateBracket,
  generateRoundRobin,
  resetBracket,
  fetchTournamentSnapshots,
  restoreTournamentSnapshot,
  playedMatchCount,
  type TournamentSnapshot,
  addParticipant,
  removeParticipant,
  removeEntrant,
  updateTournament,
  generatePools,
  setTournamentFormat,
  bracketSummary,
  firstRoundPreview,
  type Tournament,
  type TournamentHost,
  type EntrantType,
  type ByeStrategy,
  type TournamentFormat,
} from "@/lib/tournaments";

/**
 * Manager surface for a tournament. Two modes:
 *  • create (tournament == null): name it, pick individual vs. team-of-N.
 *  • manage (tournament in "setup"): import sign-ups, auto-make teams, hand-order
 *    the seeds, pick the bye framing, and generate the bracket.
 * Once live, everything is driven from the bracket itself (scoring/override).
 */
export function TournamentSetupSheet({
  tournament,
  host,
  itemTitle,
  onChanged,
  onClose,
}: {
  tournament: Tournament | null;
  host: TournamentHost;
  itemTitle: string;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // create-mode fields
  const [title, setTitle] = useState(tournament?.title ?? `${itemTitle} tournament`);
  const [format, setFormat] = useState<TournamentFormat>(tournament?.format ?? "single_elim");
  const [entrantType, setEntrantType] = useState<EntrantType>(tournament?.entrantType ?? "individual");
  const [teamSize, setTeamSize] = useState<number>(tournament?.teamSize ?? 2);
  const [poolCount, setPoolCount] = useState<number>(tournament?.poolCount ?? 2);
  const [advance, setAdvance] = useState<number>(tournament?.advancePerPool ?? 1);

  // manage-mode fields
  const [byeStrategy, setByeStrategy] = useState<ByeStrategy>(tournament?.byeStrategy ?? "byes");
  const [order, setOrder] = useState<string[]>([]);
  const [newName, setNewName] = useState("");

  // Keep the local seed order while the sheet is open. A realtime refetch must
  // not discard an unsaved reorder, so only re-sync when the SET of entrants
  // actually changed: keep the current order for ids still present, append new
  // ones in server order.
  const entrantSet = tournament ? tournament.entrants.map((e) => e.id).sort().join(",") : "";
  useEffect(() => {
    if (!tournament) return;
    setOrder((cur) => {
      const serverIds = tournament.entrants.map((e) => e.id);
      const present = new Set(serverIds);
      const kept = cur.filter((id) => present.has(id));
      const keptSet = new Set(kept);
      return [...kept, ...serverIds.filter((id) => !keptSet.has(id))];
    });
  }, [entrantSet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety: start over + saved copies (migration 0224)
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [snapshots, setSnapshots] = useState<TournamentSnapshot[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<TournamentSnapshot | null>(null);
  const tournamentId = tournament?.id ?? null;
  const loadSnapshots = useCallback(async () => {
    if (!tournamentId) return;
    const res = await fetchTournamentSnapshots(tournamentId);
    setSnapshots(res.available ? res.snapshots : []);
  }, [tournamentId]);
  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);
  useEffect(() => {
    if (tournament) setByeStrategy(tournament.byeStrategy);
  }, [tournament?.byeStrategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<{ error?: string }>, okNote?: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const { error: err } = await fn();
    if (err) {
      setError(err);
      setBusy(false);
      return false;
    }
    await onChanged();
    setBusy(false);
    if (okNote) setNote(okNote);
    return true;
  };

  // ── Create mode ─────────────────────────────────────────────────────────────
  if (!tournament) {
    const create = async () => {
      if (!title.trim()) {
        setError("Give it a title.");
        return;
      }
      setBusy(true);
      setError(null);
      const { error: err } = await createTournamentForHost(host, {
        title: title.trim(),
        format,
        entrantType,
        teamSize: entrantType === "team" ? teamSize : null,
      });
      if (err) {
        setError(err);
        setBusy(false);
        return;
      }
      await onChanged();
      setBusy(false);
      close();
    };
    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="tourn-setup-title"
        header={<h2 id="tourn-setup-title" className="text-lg font-bold">Set up a tournament</h2>}
        footer={
          <div className="space-y-2">
            {error && <p className="text-center text-sm text-accent">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={create}
              className="w-full rounded-2xl bg-primary py-3.5 font-semibold text-white disabled:opacity-40"
            >
              Create tournament
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <SectionLabel>Name</SectionLabel>
            <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cornhole tournament" />
          </div>
          <div>
            <SectionLabel>Format</SectionLabel>
            <SegmentedControl<TournamentFormat>
              segments={[
                { value: "single_elim", label: "Bracket" },
                { value: "round_robin", label: "Round-robin" },
                { value: "pools_bracket", label: "Pools" },
              ]}
              value={format}
              onChange={setFormat}
            />
            <p className="mt-1 text-xs text-foreground/50">
              {format === "single_elim"
                ? "Single elimination — lose and you're out."
                : format === "round_robin"
                  ? "Everyone plays everyone; ranked by a standings table."
                  : "Group play in pools, then the top of each pool advance to a knockout."}
            </p>
          </div>
          <div>
            <SectionLabel>Who competes</SectionLabel>
            <SegmentedControl<EntrantType>
              segments={[
                { value: "individual", label: "Individuals" },
                { value: "team", label: "Teams" },
              ]}
              value={entrantType}
              onChange={setEntrantType}
            />
          </div>
          {entrantType === "team" && (
            <div>
              <SectionLabel>People per team</SectionLabel>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setTeamSize((n) => Math.max(2, n - 1))} className="grid h-9 w-9 place-items-center rounded-full bg-card text-lg ring-1 ring-border">−</button>
                <span className="w-8 text-center text-lg font-bold tabular-nums">{teamSize}</span>
                <button type="button" onClick={() => setTeamSize((n) => Math.min(6, n + 1))} className="grid h-9 w-9 place-items-center rounded-full bg-card text-lg ring-1 ring-border">+</button>
                <span className="text-sm text-foreground/50">e.g. 2 for cornhole doubles</span>
              </div>
            </div>
          )}
          <p className="text-xs text-foreground/50">
            After creating, you&rsquo;ll pull in everyone who signed up and generate the bracket.
          </p>
        </div>
      </Sheet>
    );
  }

  // ── Manage mode (setup status) ──────────────────────────────────────────────
  const isTeam = tournament.entrantType === "team";
  const isRR = tournament.format === "round_robin";
  const isPools = tournament.format === "pools_bracket";
  const entrantsById = new Map(tournament.entrants.map((e) => [e.id, e]));
  const orderedEntrants = order.map((id) => entrantsById.get(id)).filter(Boolean) as Tournament["entrants"];
  const n = orderedEntrants.length;
  // Individuals sit in the POOL until "Generate" promotes each to a solo entrant
  // (server-side, all three formats do this). So the number that will actually
  // compete = entrants + pool for individuals; for teams only formed teams count.
  const readyCount = tournament.entrantType === "individual" ? n + tournament.pool.length : n;
  const preview = firstRoundPreview(orderedEntrants.map((e) => e.displayName), byeStrategy);

  const locked = tournament.status !== "setup";
  const playedCount = playedMatchCount(tournament);

  const startOver = async () => {
    const ok = await run(() => resetBracket(tournament.id, true), "Started over. The earlier copy is saved under Restore.");
    setConfirmStartOver(false);
    if (ok) await loadSnapshots();
  };
  const restore = async (snap: TournamentSnapshot) => {
    const ok = await run(() => restoreTournamentSnapshot(snap.id), "Restored the earlier copy.");
    setConfirmRestore(null);
    if (ok) await loadSnapshots();
  };

  const startOverBlock = (
    <section className="space-y-2 border-t border-border pt-4">
      <SectionLabel>Start over</SectionLabel>
      {confirmStartOver ? (
        <div className="rounded-xl bg-accent/10 p-3 ring-1 ring-accent/30">
          <p className="mb-2 text-sm font-medium">
            {playedCount > 0
              ? `This erases ${playedCount} recorded result${playedCount === 1 ? "" : "s"} and clears the seeding and bracket. A saved copy is kept so you can restore it.`
              : "This clears the seeding and bracket. Nothing has been played yet."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={startOver}
              className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={() => setConfirmStartOver(false)}
              className="rounded-xl bg-background px-4 text-sm font-medium text-foreground/60 ring-1 ring-border"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmStartOver(true)}
          className="w-full rounded-xl bg-card py-2.5 text-sm font-medium text-accent ring-1 ring-accent/30"
        >
          Start over (clear seeding &amp; bracket)
        </button>
      )}
    </section>
  );

  const restoreBlock =
    snapshots.length > 0 ? (
      <section className="space-y-2 border-t border-border pt-4">
        <SectionLabel>Restore an earlier copy</SectionLabel>
        <ul className="space-y-1.5">
          {snapshots.map((snap) => (
            <li key={snap.id} className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm capitalize">{snap.reason}</p>
                  <p className="text-[11px] text-foreground/50">
                    {timeAgo(snap.takenAt) === "just now" ? "just now" : `${timeAgo(snap.takenAt)} ago`} · {snap.playedMatches} game{snap.playedMatches === 1 ? "" : "s"} played
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRestore(snap)}
                  className="shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-border"
                >
                  Restore
                </button>
              </div>
              {confirmRestore?.id === snap.id && (
                <div className="mt-2 rounded-xl bg-accent/10 p-3 ring-1 ring-accent/30">
                  <p className="mb-2 text-sm font-medium">
                    Replace the tournament as it is now with this copy ({snap.playedMatches} game
                    {snap.playedMatches === 1 ? "" : "s"} played)? The current state is saved first, so this can be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restore(snap)}
                      className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      Restore this copy
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRestore(null)}
                      className="rounded-xl bg-background px-4 text-sm font-medium text-foreground/60 ring-1 ring-border"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((cur) => {
      const next = cur.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const doGenerate = async () => {
    const seed = order.length === n && n > 1 ? order : null;
    const ok = await run(() =>
      isPools
        ? generatePools(tournament.id, poolCount, advance, seed)
        : isRR
          ? generateRoundRobin(tournament.id, seed)
          : generateBracket(tournament.id, seed),
    );
    if (ok) close();
  };

  if (locked) {
    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="tourn-manage-title"
        header={
          <div>
            <h2 id="tourn-manage-title" className="text-lg font-bold">{tournament.title}</h2>
            <p className="text-xs text-foreground/50">{isTeam ? `Teams of ${tournament.teamSize}` : "Individuals"}</p>
          </div>
        }
        footer={
          error || note ? (
            <div className="space-y-2">
              {error && <p className="text-center text-sm text-accent">{error}</p>}
              {note && <p className="text-center text-sm text-primary">{note}</p>}
            </div>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <p className="rounded-xl bg-card p-3 text-sm text-foreground/70 ring-1 ring-border">
            This tournament is under way. The bracket is locked so nothing gets reshuffled by accident.
          </p>
          {restoreBlock}
          {startOverBlock}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="tourn-manage-title"
      header={
        <div>
          <h2 id="tourn-manage-title" className="text-lg font-bold">{tournament.title}</h2>
          <p className="text-xs text-foreground/50">{isTeam ? `Teams of ${tournament.teamSize}` : "Individuals"}</p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {error && <p className="text-center text-sm text-accent">{error}</p>}
          {note && <p className="text-center text-sm text-primary">{note}</p>}
          <button
            type="button"
            disabled={busy || readyCount < 2}
            onClick={doGenerate}
            className="w-full rounded-2xl bg-primary py-3.5 font-semibold text-white disabled:opacity-40"
          >
            {readyCount < 2 ? "Add at least 2 players" : isPools ? "Generate pools" : isRR ? "Generate schedule" : "Generate bracket"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Format — switchable while still in setup (before generating). */}
        {tournament.status === "setup" && (
          <section className="space-y-2">
            <SectionLabel>Format</SectionLabel>
            <SegmentedControl<TournamentFormat>
              segments={[
                { value: "single_elim", label: "Bracket" },
                { value: "round_robin", label: "Round-robin" },
                { value: "pools_bracket", label: "Pools" },
              ]}
              value={tournament.format}
              onChange={(f) => {
                if (f !== tournament.format) void run(() => setTournamentFormat(tournament.id, f));
              }}
            />
            <p className="text-xs text-foreground/50">
              {isRR
                ? "Everyone plays everyone; ranked by a standings table."
                : isPools
                  ? "Group play in pools, then the top of each pool advance to a knockout."
                  : "Single elimination — lose and you're out."}
            </p>
          </section>
        )}

        {/* Players. For a private activity the roster IS the player list (auto-added
            on creation) — this button just re-syncs if you added people since. */}
        <section className="space-y-2">
          <SectionLabel>Players</SectionLabel>
          {host.kind === "activity" && (
            <p className="text-[11px] text-foreground/45">Everyone in this activity is already a player. Added someone since? Re-sync below.</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              const { count, error: err } = await importEntrantsForHost(host, tournament.id);
              return err ? { error: err } : (setNote(`${host.kind === "activity" ? "Synced" : "Imported"} ${count ?? 0} ${host.kind === "activity" ? "from the activity" : "from sign-ups"}`), {});
            })}
            className="w-full rounded-xl bg-card py-2.5 text-sm font-medium ring-1 ring-border"
          >
            {host.kind === "activity" ? "↻ Re-sync players from activity" : "⬇︎ Pull in everyone who signed up"}
          </button>
          {isTeam && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => {
                  const { teamsCreated, leftover, error: err } = await generateTeams(tournament.id);
                  return err ? { error: err } : (setNote(`Made ${teamsCreated ?? 0} teams${leftover ? `, ${leftover} left over` : ""}`), {});
                })}
                className="flex-1 rounded-xl bg-card py-2.5 text-sm font-medium ring-1 ring-border"
              >
                🎲 Auto-make teams
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => ungroupTeams(tournament.id))}
                className="rounded-xl bg-card px-3 py-2.5 text-sm font-medium text-foreground/60 ring-1 ring-border"
              >
                Undo
              </button>
            </div>
          )}
        </section>

        {/* Seed order (hand-arrange) */}
        {n > 0 && (
          <section className="space-y-2">
            <SectionLabel>Seed order — top seeds first</SectionLabel>
            <ul className="space-y-1.5">
              {orderedEntrants.map((e, idx) => (
                <li key={e.id} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                  <span className="w-5 text-center text-xs font-semibold text-foreground/40">{idx + 1}</span>
                  <span className="flex-1 truncate text-sm">{e.displayName}</span>
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="grid h-7 w-7 place-items-center rounded-full text-foreground/50 disabled:opacity-20" aria-label="Move up">▲</button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === n - 1} className="grid h-7 w-7 place-items-center rounded-full text-foreground/50 disabled:opacity-20" aria-label="Move down">▼</button>
                  {tournament.entrantType === "individual" && (
                    <button type="button" onClick={() => run(() => removeEntrant(e.id))} className="grid h-7 w-7 place-items-center rounded-full text-accent" aria-label="Remove">×</button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-foreground/40">Order sets the seeding (byes go to the top). Leave as-is to keep it, or shuffle by generating without arranging.</p>
          </section>
        )}

        {/* Pool (un-teamed sign-ups) + manual add */}
        {tournament.pool.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Not yet {isTeam ? "on a team" : "seeded"}</SectionLabel>
            <ul className="space-y-1.5">
              {tournament.pool.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                  <span className="flex-1 truncate text-sm">{p.name}</span>
                  <button type="button" onClick={() => run(() => removeParticipant(p.id))} className="grid h-7 w-7 place-items-center rounded-full text-accent" aria-label="Remove">×</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <SectionLabel>Add someone by hand</SectionLabel>
          <div className="flex gap-2">
            <input className={FIELD} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (works for people not on the app)" />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={async () => {
                const name = newName.trim();
                const { error: err } = await addParticipant(tournament.id, null, name);
                if (err) setError(err);
                else {
                  setNewName("");
                  await onChanged();
                }
              }}
              className="shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {isTeam && <p className="text-[11px] text-foreground/40">Added people join the pool — tap &ldquo;Auto-make teams&rdquo; to pair everyone up.</p>}
        </section>

        {/* Round-robin summary (no bracket/byes) */}
        {n >= 2 && isRR && (
          <section className="space-y-1">
            <SectionLabel>Schedule</SectionLabel>
            <p className="text-xs text-foreground/60">
              Everyone plays everyone once — {n} entrants → {(n * (n - 1)) / 2} games. Ranked by a standings table
              ({tournament.tiebreakers.map((t) => t.replace(/_/g, " ")).join(" → ")}).
            </p>
          </section>
        )}

        {/* Pools config */}
        {n >= 2 && isPools && (
          <section className="space-y-2">
            <SectionLabel>Pools</SectionLabel>
            <div className="flex items-center gap-3">
              <span className="w-28 text-sm text-foreground/60">Number of pools</span>
              <button type="button" onClick={() => setPoolCount((c) => Math.max(2, c - 1))} className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border">−</button>
              <span className="w-6 text-center font-bold tabular-nums">{poolCount}</span>
              <button type="button" onClick={() => setPoolCount((c) => Math.min(8, c + 1))} className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border">+</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 text-sm text-foreground/60">Advance per pool</span>
              <button type="button" onClick={() => setAdvance((a) => Math.max(1, a - 1))} className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border">−</button>
              <span className="w-6 text-center font-bold tabular-nums">{advance}</span>
              <button type="button" onClick={() => setAdvance((a) => a + 1)} className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border">+</button>
            </div>
            <p className="text-xs text-foreground/60">
              {n} entrants → {poolCount} pools of ~{Math.floor(n / poolCount)}; top {advance} of each ({poolCount * advance} total)
              advance to a knockout.
            </p>
          </section>
        )}

        {/* Bye framing + preview (single-elim) */}
        {n >= 2 && !isRR && !isPools && (
          <section className="space-y-2">
            <SectionLabel>Uneven bracket</SectionLabel>
            <SegmentedControl<ByeStrategy>
              size="sm"
              segments={[
                { value: "byes", label: "Byes" },
                { value: "play_in", label: "Play-in" },
              ]}
              value={byeStrategy}
              onChange={(v) => {
                setByeStrategy(v);
                void updateTournament(tournament.id, { byeStrategy: v });
              }}
            />
            <p className="text-xs text-foreground/60">{bracketSummary(n, byeStrategy)}</p>
            <div className="rounded-xl bg-card p-2 ring-1 ring-border">
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">First round preview</p>
              <ul className="space-y-1">
                {preview.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-1 text-xs">
                    <span className={m.a.name ? "" : "text-foreground/30"}>{m.a.name ?? "Bye"}</span>
                    <span className="text-foreground/30">{m.isBye ? "→" : "vs"}</span>
                    <span className={m.b.name ? "text-right" : "text-right text-foreground/30"}>{m.b.name ?? "Bye"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {restoreBlock}
        {startOverBlock}
      </div>
    </Sheet>
  );
}
