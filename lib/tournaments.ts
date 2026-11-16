// Client helpers for tournament brackets (migration 0144). A tournament rides on
// top of an activity's sign-ups (fest_schedule_signups): a manager turns the
// sign-ups into a bracket or (later) a round-robin, seeds and hand-arranges it,
// and records results; any member watches the live bracket. Reads go through the
// Supabase client (members-only tables under RLS); writes go through SECURITY
// DEFINER RPCs so the manager gate + all the bracket logic live server-side.
// Degrades to "no tournament" with no backend or pre-migration (42P01) — never
// throws, the same idiom as lib/polls.ts.
//
// This module also holds the PURE bracket math (bracketSize / seedOrder /
// firstRoundPreview / formTeamsPreview) used to preview a bracket in the setup
// sheet before generating. The authoritative generation is the SQL RPC; these
// mirror it exactly so the preview can't disagree.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type TournamentFormat = "single_elim" | "round_robin" | "pools_bracket";
export type EntrantType = "individual" | "team";
export type ByeStrategy = "byes" | "play_in";
export type TournamentStatus = "setup" | "live" | "complete";
export type MatchStatus = "pending" | "ready" | "in_progress" | "complete";
export type MatchStage = "pool" | "bracket";

export interface TournamentParticipant {
  id: string;
  entrantId: string | null;
  userId: string | null;
  name: string;
  position: number;
}

export interface TournamentEntrant {
  id: string;
  seed: number | null;
  displayName: string;
  teamName: string | null;
  pool: string | null;
  position: number;
  withdrawnAt: string | null;
  /** The people on this entrant (from tournament_participants). */
  members: TournamentParticipant[];
}

export interface TournamentMatch {
  id: string;
  stage: MatchStage;
  pool: string | null;
  round: number;
  position: number;
  slot1EntrantId: string | null;
  slot2EntrantId: string | null;
  slot1Score: number | null;
  slot2Score: number | null;
  winnerEntrantId: string | null;
  nextMatchId: string | null;
  nextSlot: 1 | 2 | null;
  isPlayIn: boolean;
  status: MatchStatus;
  /** Scheduled start (ISO), or null. */
  scheduledAt: string | null;
  /** Lead times (minutes before scheduledAt) at which players get a reminder. */
  reminderMinutes: number[];
}

/** Where a tournament hangs — a Family Fest activity (fest_schedule_items) or a
 *  member-created private activity (private_activities, migration 0150). */
export type TournamentHost = { kind: "schedule"; id: string } | { kind: "activity"; id: string };

export interface Tournament {
  id: string;
  /** The fest activity this hangs off, or null for a private-activity tournament. */
  scheduleItemId: string | null;
  /** The private activity this hangs off, or null for a fest tournament. */
  privateActivityId: string | null;
  title: string;
  format: TournamentFormat;
  entrantType: EntrantType;
  teamSize: number | null;
  byeStrategy: ByeStrategy;
  poolCount: number | null;
  advancePerPool: number | null;
  tiebreakers: string[];
  targetScore: number | null;
  winBy: number | null;
  allowTies: boolean;
  status: TournamentStatus;
  createdBy: string | null;
  winnerEntrantId: string | null;
  entrants: TournamentEntrant[];
  /** Sign-ups not yet on an entrant (entrant_id null) — the seeding pool. */
  pool: TournamentParticipant[];
  matches: TournamentMatch[];
}

type PgError = { code?: string; message?: string } | null;

/** Missing relation ⇒ the 0144 migration hasn't run yet (same 42P01 idiom as
 *  lib/polls.ts). */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface ParticipantRow {
  id: string;
  entrant_id: string | null;
  user_id: string | null;
  name: string;
  position: number;
}
interface EntrantRow {
  id: string;
  seed: number | null;
  display_name: string;
  team_name: string | null;
  pool: string | null;
  position: number;
  withdrawn_at: string | null;
}
interface MatchRow {
  id: string;
  stage: MatchStage;
  pool: string | null;
  round: number;
  position: number;
  slot1_entrant_id: string | null;
  slot2_entrant_id: string | null;
  slot1_score: number | null;
  slot2_score: number | null;
  winner_entrant_id: string | null;
  next_match_id: string | null;
  next_slot: 1 | 2 | null;
  is_play_in: boolean;
  status: MatchStatus;
  scheduled_at: string | null;
  reminder_minutes: number[] | null;
}
interface TournamentRow {
  id: string;
  schedule_item_id: string | null;
  private_activity_id: string | null;
  title: string;
  format: TournamentFormat;
  entrant_type: EntrantType;
  team_size: number | null;
  bye_strategy: ByeStrategy;
  pool_count: number | null;
  advance_per_pool: number | null;
  tiebreakers: string[] | null;
  target_score: number | null;
  win_by: number | null;
  allow_ties: boolean;
  status: TournamentStatus;
  created_by: string | null;
  winner_entrant_id: string | null;
  tournament_entrants: EntrantRow[] | null;
  tournament_matches: MatchRow[] | null;
  tournament_participants: ParticipantRow[] | null;
}

function toParticipant(r: ParticipantRow): TournamentParticipant {
  return { id: r.id, entrantId: r.entrant_id, userId: r.user_id, name: r.name, position: r.position };
}

/** Deterministic orderings so a realtime refetch can never reshuffle the screen
 *  (Postgres returns embedded rows in no guaranteed order). Entrants: seed (nulls
 *  last), position, id. Matches: stage (pool before bracket), pool, round,
 *  position, id. */
export function compareEntrants(
  a: { seed: number | null; position: number; id: string },
  b: { seed: number | null; position: number; id: string },
): number {
  return (
    (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
    a.position - b.position ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export function compareMatches(
  a: { stage: MatchStage; pool: string | null; round: number; position: number; id: string },
  b: { stage: MatchStage; pool: string | null; round: number; position: number; id: string },
): number {
  const stageRank = (x: MatchStage) => (x === "pool" ? 0 : 1);
  return (
    stageRank(a.stage) - stageRank(b.stage) ||
    (a.pool ?? "").localeCompare(b.pool ?? "") ||
    a.round - b.round ||
    a.position - b.position ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function assemble(row: TournamentRow): Tournament {
  const parts = (row.tournament_participants ?? []).map(toParticipant);
  const byEntrant = new Map<string, TournamentParticipant[]>();
  const pool: TournamentParticipant[] = [];
  for (const p of parts) {
    if (p.entrantId) {
      const list = byEntrant.get(p.entrantId) ?? [];
      list.push(p);
      byEntrant.set(p.entrantId, list);
    } else {
      pool.push(p);
    }
  }
  const entrants = (row.tournament_entrants ?? [])
    .map((e) => ({
      id: e.id,
      seed: e.seed,
      displayName: e.display_name,
      teamName: e.team_name,
      pool: e.pool,
      position: e.position,
      withdrawnAt: e.withdrawn_at,
      members: (byEntrant.get(e.id) ?? []).slice().sort((a, b) => a.position - b.position),
    }))
    .sort(compareEntrants);
  const matches = (row.tournament_matches ?? [])
    .map(
      (m): TournamentMatch => ({
        id: m.id,
        stage: m.stage,
        pool: m.pool,
        round: m.round,
        position: m.position,
        slot1EntrantId: m.slot1_entrant_id,
        slot2EntrantId: m.slot2_entrant_id,
        slot1Score: m.slot1_score,
        slot2Score: m.slot2_score,
        winnerEntrantId: m.winner_entrant_id,
        nextMatchId: m.next_match_id,
        nextSlot: m.next_slot,
        isPlayIn: m.is_play_in,
        status: m.status,
        scheduledAt: m.scheduled_at,
        reminderMinutes: m.reminder_minutes ?? [],
      }),
    )
    .sort(compareMatches);
  return {
    id: row.id,
    scheduleItemId: row.schedule_item_id ?? null,
    privateActivityId: row.private_activity_id ?? null,
    title: row.title,
    format: row.format,
    entrantType: row.entrant_type,
    teamSize: row.team_size,
    byeStrategy: row.bye_strategy,
    poolCount: row.pool_count,
    advancePerPool: row.advance_per_pool,
    tiebreakers: row.tiebreakers ?? [],
    targetScore: row.target_score,
    winBy: row.win_by,
    allowTies: row.allow_ties,
    status: row.status,
    createdBy: row.created_by,
    winnerEntrantId: row.winner_entrant_id,
    entrants,
    pool: pool.sort((a, b) => a.position - b.position),
    matches,
  };
}

// `tournaments` has TWO relationships to `tournament_entrants` — the normal
// child FK, and `tournaments_winner_fk` (winner_entrant_id → the champion). So
// the entrants embed MUST name the child FK explicitly, or PostgREST 300s with
// PGRST201 ("more than one relationship found") and the whole fetch fails →
// empty. (matches/participants have only one relationship each, so they're fine.)
const SELECT =
  "*, tournament_entrants!tournament_entrants_tournament_id_fkey(*), tournament_matches(*), tournament_participants(*)";

/** Every tournament on an activity (usually one), fully assembled. Empty with no
 *  backend, pre-migration (42P01), or on any read failure — never throws. */
export async function fetchTournamentsForItem(scheduleItemId: string): Promise<Tournament[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !scheduleItemId) return [];
  try {
    const { data, error } = await sb
      .from("tournaments")
      .select(SELECT)
      .eq("schedule_item_id", scheduleItemId)
      .order("created_at", { ascending: true });
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchTournamentsForItem: read error", error.message);
      return [];
    }
    return ((data ?? []) as unknown as TournamentRow[]).map(assemble);
  } catch {
    return [];
  }
}

/** Every tournament on a private activity (migration 0150), fully assembled. */
export async function fetchTournamentsForActivity(privateActivityId: string): Promise<Tournament[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !privateActivityId) return [];
  try {
    const { data, error } = await sb
      .from("tournaments")
      .select(SELECT)
      .eq("private_activity_id", privateActivityId)
      .order("created_at", { ascending: true });
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchTournamentsForActivity: read error", error.message);
      return [];
    }
    return ((data ?? []) as unknown as TournamentRow[]).map(assemble);
  } catch {
    return [];
  }
}

/** Tournaments for whichever host (fest activity or private activity). */
export function fetchTournamentsForHost(host: TournamentHost): Promise<Tournament[]> {
  return host.kind === "schedule" ? fetchTournamentsForItem(host.id) : fetchTournamentsForActivity(host.id);
}

/** One tournament by id (used by the notification deep-link). */
export async function fetchTournament(id: string): Promise<Tournament | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !id) return null;
  try {
    const { data, error } = await sb.from("tournaments").select(SELECT).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return assemble(data as unknown as TournamentRow);
  } catch {
    return null;
  }
}

// ── Optimistic transform (mirrors record_match_result's forward-propagation) ──

/** Return a copy of the tournament with `matchId` decided for `winnerId` (+
 *  optional scores) and the winner advanced into its next match — the local
 *  paint before the RPC confirms. Mirrors the server's cascade: when the winner
 *  changes, every downstream result that depended on the old winner is cleared
 *  (and a cleared final takes the tournament out of 'complete'), so the screen
 *  never shows stale later rounds. */
export function applyMatchResult(
  t: Tournament,
  matchId: string,
  winnerId: string,
  score1: number | null,
  score2: number | null,
): Tournament {
  if (!t.matches.some((x) => x.id === matchId)) return t;
  const byId = new Map(t.matches.map((x) => [x.id, { ...x }]));
  let finalCleared = false;

  const settle = (x: TournamentMatch) => {
    if (x.winnerEntrantId) return;
    x.status = x.slot1EntrantId && x.slot2EntrantId ? "ready" : "pending";
  };
  // Put `entrant` into a slot; if that changes who is there and the game had a
  // result, erase it and keep cascading.
  const place = (id: string, slot: 1 | 2, entrant: string | null) => {
    const n = byId.get(id);
    if (!n) return;
    const key = slot === 1 ? "slot1EntrantId" : "slot2EntrantId";
    if (n[key] === entrant) return;
    n[key] = entrant;
    if (n.winnerEntrantId) {
      n.winnerEntrantId = null;
      n.slot1Score = null;
      n.slot2Score = null;
      if (!n.nextMatchId) finalCleared = true;
      else if (n.nextSlot) place(n.nextMatchId, n.nextSlot, null);
    }
    settle(n);
  };

  const m = byId.get(matchId)!;
  m.winnerEntrantId = winnerId;
  m.slot1Score = score1;
  m.slot2Score = score2;
  m.status = "complete";
  if (m.nextMatchId && m.nextSlot) place(m.nextMatchId, m.nextSlot, winnerId);

  const matches = t.matches.map((x) => byId.get(x.id)!);
  const isFinal = !m.nextMatchId;
  let status = t.status;
  let winnerEntrantId = t.winnerEntrantId;
  if (isFinal) {
    status = "complete";
    winnerEntrantId = winnerId;
  } else if (finalCleared && t.status === "complete" && t.format !== "round_robin") {
    status = "live";
    winnerEntrantId = null;
  }
  return { ...t, matches, status, winnerEntrantId };
}

// ── Pure bracket math (mirrors the SQL; used for the setup preview) ───────────

/** Next power of two ≥ n (the bracket size). n<2 ⇒ n. */
export function bracketSize(n: number): number {
  if (n < 2) return n;
  let b = 1;
  while (b < n) b *= 2;
  return b;
}

/** Byes needed for n entrants = bracketSize − n. */
export function byeCount(n: number): number {
  return Math.max(0, bracketSize(n) - n);
}

/** Largest power of two ≤ n (the clean main-draw size for the play-in framing). */
export function lowerPow2(n: number): number {
  if (n < 1) return 0;
  let b = 1;
  while (b * 2 <= n) b *= 2;
  return b;
}

/** Standard fold-seed slot order for a size-`size` bracket: entry p (0-based) =
 *  the seed number (1-based) that occupies slot p. Mirrors
 *  _tournament_seed_order in SQL. */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  let arr = [1, 2];
  let sz = 2;
  while (sz < size) {
    const next: number[] = [];
    for (const s of arr) {
      next.push(s, 2 * sz + 1 - s);
    }
    arr = next;
    sz *= 2;
  }
  return arr;
}

export interface PreviewSlot {
  /** Seed number, or null for a bye/phantom. */
  seed: number | null;
  /** Entrant display name if we can resolve it from the given order. */
  name: string | null;
}
export interface PreviewMatch {
  a: PreviewSlot;
  b: PreviewSlot;
  isBye: boolean;
  isPlayIn: boolean;
}

/** Build the first-round matchups for a set of entrant names in seed order (index
 *  0 = seed 1), for the live setup preview. `names.length` = N. */
export function firstRoundPreview(names: string[], strategy: ByeStrategy): PreviewMatch[] {
  const n = names.length;
  if (n < 2) return [];
  const b = bracketSize(n);
  const order = seedOrder(b);
  const hasByes = b > n;
  const out: PreviewMatch[] = [];
  for (let i = 0; i < b / 2; i++) {
    const s1 = order[2 * i];
    const s2 = order[2 * i + 1];
    const a: PreviewSlot = { seed: s1 <= n ? s1 : null, name: s1 <= n ? names[s1 - 1] : null };
    const bb: PreviewSlot = { seed: s2 <= n ? s2 : null, name: s2 <= n ? names[s2 - 1] : null };
    const isBye = !a.name || !bb.name;
    out.push({
      a,
      b: bb,
      isBye,
      isPlayIn: strategy === "play_in" && hasByes && !isBye,
    });
  }
  return out;
}

/** A one-line human summary of the bracket shape for the setup sheet. */
export function bracketSummary(n: number, strategy: ByeStrategy): string {
  if (n < 2) return "Need at least 2 entrants";
  const b = bracketSize(n);
  const byes = byeCount(n);
  const games = n - lowerPow2(n); // real first-phase games
  if (byes === 0) return `${n} entrants · ${b}-team bracket · no byes`;
  if (strategy === "play_in") {
    return `${n} entrants · ${games} play-in game${games === 1 ? "" : "s"} → clean ${lowerPow2(n)}-team draw`;
  }
  return `${n} entrants · ${b}-team bracket · ${byes} bye${byes === 1 ? "" : "s"} (top seeds rest)`;
}

// ── Standings (round-robin / pools — computed client-side) ────────────────────

export interface Standing {
  entrantId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  rank: number;
}

/** Whether any score has been entered (drives showing the PF/PA/Diff columns —
 *  scores are optional, so a winner-only round-robin hides them). */
export function hasAnyScores(t: Tournament): boolean {
  return t.matches.some((m) => m.slot1Score != null || m.slot2Score != null);
}

/** Distinct pool labels present on the entrants (sorted A, B, …). */
export function poolLabels(t: Tournament): string[] {
  return Array.from(new Set(t.entrants.map((e) => e.pool).filter((p): p is string => !!p))).sort();
}

/** True once every pool-stage game is complete (and at least one exists). */
export function poolStageComplete(t: Tournament): boolean {
  const pool = t.matches.filter((m) => m.stage === "pool");
  return pool.length > 0 && pool.every((m) => m.status === "complete");
}

/** True once the knockout bracket has been generated from the pools. */
export function hasKnockoutBracket(t: Tournament): boolean {
  return t.matches.some((m) => m.stage === "bracket");
}

/**
 * Standings for a round-robin (or one pool), ranked by the tournament's ordered
 * `tiebreakers` (win_pct → head_to_head → point_diff → points_for by default).
 * Pass `pool` to rank just that pool's entrants; omit for the whole field.
 */
export function computeStandings(t: Tournament, pool: string | null = null): Standing[] {
  const entrants = t.entrants.filter((e) => !e.withdrawnAt && (pool == null || e.pool === pool));
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const rows = new Map<string, Standing>();
  for (const e of entrants) {
    rows.set(e.id, {
      entrantId: e.id,
      name: e.displayName,
      played: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
      rank: 0,
    });
  }
  const completed = t.matches.filter(
    (m) => m.status === "complete" && m.slot1EntrantId && m.slot2EntrantId && byId.has(m.slot1EntrantId) && byId.has(m.slot2EntrantId!),
  );
  for (const m of completed) {
    const a = rows.get(m.slot1EntrantId!)!;
    const b = rows.get(m.slot2EntrantId!)!;
    a.played++;
    b.played++;
    const s1 = m.slot1Score ?? 0;
    const s2 = m.slot2Score ?? 0;
    a.pointsFor += s1;
    a.pointsAgainst += s2;
    b.pointsFor += s2;
    b.pointsAgainst += s1;
    if (!m.winnerEntrantId) {
      a.ties++;
      b.ties++;
    } else if (m.winnerEntrantId === a.entrantId) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  for (const r of rows.values()) r.diff = r.pointsFor - r.pointsAgainst;

  const winPct = (r: Standing) => (r.played ? (r.wins + 0.5 * r.ties) / r.played : 0);
  const h2h = (x: Standing, y: Standing): number => {
    const m = completed.find(
      (mm) =>
        (mm.slot1EntrantId === x.entrantId && mm.slot2EntrantId === y.entrantId) ||
        (mm.slot1EntrantId === y.entrantId && mm.slot2EntrantId === x.entrantId),
    );
    if (!m || !m.winnerEntrantId) return 0;
    return m.winnerEntrantId === x.entrantId ? -1 : 1;
  };
  const seedOf = (id: string) => byId.get(id)?.seed ?? byId.get(id)?.position ?? 1e9;

  const sorted = Array.from(rows.values()).sort((x, y) => {
    for (const tb of t.tiebreakers) {
      let d = 0;
      if (tb === "win_pct") d = winPct(y) - winPct(x);
      else if (tb === "point_diff") d = y.diff - x.diff;
      else if (tb === "points_for") d = y.pointsFor - x.pointsFor;
      else if (tb === "head_to_head") d = h2h(x, y);
      if (d !== 0) return d;
    }
    return seedOf(x.entrantId) - seedOf(y.entrantId);
  });
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}

const TIEBREAKER_LABEL: Record<string, string> = {
  win_pct: "win-loss record",
  head_to_head: "head-to-head",
  point_diff: "point differential",
  points_for: "points scored",
};

/** Human legend of the tiebreaker order actually in effect (drops win% — that's
 *  the record itself — and the point-based ones when no scores were recorded). */
export function tiebreakerLegend(t: Tournament, showPoints: boolean): string {
  const order = t.tiebreakers
    .filter((tb) => tb !== "win_pct")
    .filter((tb) => showPoints || (tb !== "point_diff" && tb !== "points_for"));
  return order.map((tb) => TIEBREAKER_LABEL[tb] ?? tb.replace(/_/g, " ")).join(", then ");
}

export interface TieNote {
  over: string;
  under: string;
  reason: string;
}

/** For each pair of adjacent entrants with an IDENTICAL W-L(-T) record, explain
 *  which tiebreaker put one above the other (head-to-head names who beat whom).
 *  Empty when nothing is tied. Same ranking logic as computeStandings. */
export function standingTieNotes(t: Tournament, pool: string | null = null): TieNote[] {
  const rows = computeStandings(t, pool);
  const completed = t.matches.filter(
    (m) => m.status === "complete" && m.slot1EntrantId && m.slot2EntrantId,
  );
  const h2h = (aId: string, bId: string): number => {
    const m = completed.find(
      (mm) =>
        (mm.slot1EntrantId === aId && mm.slot2EntrantId === bId) ||
        (mm.slot1EntrantId === bId && mm.slot2EntrantId === aId),
    );
    if (!m || !m.winnerEntrantId) return 0;
    return m.winnerEntrantId === aId ? 1 : -1;
  };
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const notes: TieNote[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.wins !== b.wins || a.losses !== b.losses || a.ties !== b.ties) continue;
    // Only note ties a real tiebreaker actually decided — skip pairs that are
    // genuinely even (e.g. an unplayed pool where everyone is 0-0-0), so the
    // note doesn't spam every adjacent row.
    let reason = "";
    for (const tb of t.tiebreakers) {
      if (tb === "win_pct") continue; // equal (same record)
      if (tb === "head_to_head") {
        if (h2h(a.entrantId, b.entrantId) === 1) {
          reason = "won their head-to-head game";
          break;
        }
        continue; // didn't play / tied that game → next tiebreaker
      }
      if (tb === "point_diff" && a.diff !== b.diff) {
        reason = `better point differential (${signed(a.diff)} vs ${signed(b.diff)})`;
        break;
      }
      if (tb === "points_for" && a.pointsFor !== b.pointsFor) {
        reason = `scored more points (${a.pointsFor} vs ${b.pointsFor})`;
        break;
      }
    }
    if (reason) notes.push({ over: a.name, under: b.name, reason });
  }
  return notes;
}

/** Random-pair a name list into teams of `size` for the setup preview (the real
 *  teaming is server-side in generate_teams). Returns { teams, leftover }. */
export function formTeamsPreview(
  names: string[],
  size: number,
): { teams: string[][]; leftover: string[] } {
  const shuffled = names.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const teams: string[][] = [];
  let i = 0;
  while (i + size <= shuffled.length) {
    teams.push(shuffled.slice(i, i + size));
    i += size;
  }
  return { teams, leftover: shuffled.slice(i) };
}

// ── Write wrappers (thin sb.rpc calls, {error?}/{id?}) ────────────────────────

type Res = { error?: string };
type IdRes = { id?: string; error?: string };

async function rpc(name: string, params: Record<string, unknown>): Promise<Res> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(name, params);
  return error ? { error: error.message } : {};
}

export interface CreateTournamentInput {
  scheduleItemId: string;
  title: string;
  format?: TournamentFormat;
  entrantType?: EntrantType;
  teamSize?: number | null;
  byeStrategy?: ByeStrategy;
}
export async function createTournament(input: CreateTournamentInput): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_tournament", {
    p_item: input.scheduleItemId,
    p_title: input.title,
    p_format: input.format ?? "single_elim",
    p_entrant_type: input.entrantType ?? "individual",
    p_team_size: input.teamSize ?? null,
    p_bye_strategy: input.byeStrategy ?? "byes",
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

export interface CreateActivityTournamentInput {
  privateActivityId: string;
  title: string;
  format?: TournamentFormat;
  entrantType?: EntrantType;
  teamSize?: number | null;
}
/** Create a tournament on a private activity (migration 0150). */
export async function createActivityTournament(input: CreateActivityTournamentInput): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_activity_tournament", {
    p_activity: input.privateActivityId,
    p_title: input.title,
    p_format: input.format ?? "single_elim",
    p_entrant_type: input.entrantType ?? "individual",
    p_team_size: input.teamSize ?? null,
    p_bye_strategy: "byes",
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Create a tournament on whichever host. */
export function createTournamentForHost(
  host: TournamentHost,
  input: { title: string; format?: TournamentFormat; entrantType?: EntrantType; teamSize?: number | null },
): Promise<IdRes> {
  return host.kind === "schedule"
    ? createTournament({ scheduleItemId: host.id, ...input })
    : createActivityTournament({ privateActivityId: host.id, ...input });
}

/** Seed a private-activity tournament's pool from its roster. */
export async function importEntrantsFromActivityMembers(id: string): Promise<{ count?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("import_entrants_from_activity_members", { p_tournament: id });
  if (error) return { error: error.message };
  return { count: (data as number) ?? 0 };
}

/** Import entrants from whichever host (sign-ups, or the activity roster). */
export function importEntrantsForHost(host: TournamentHost, tournamentId: string): Promise<{ count?: number; error?: string }> {
  return host.kind === "schedule"
    ? importEntrantsFromSignups(tournamentId)
    : importEntrantsFromActivityMembers(tournamentId);
}

export interface UpdateTournamentInput {
  title?: string;
  byeStrategy?: ByeStrategy;
  allowTies?: boolean;
  targetScore?: number | null;
  winBy?: number | null;
}
export function updateTournament(id: string, input: UpdateTournamentInput): Promise<Res> {
  return rpc("update_tournament", {
    p_tournament: id,
    p_title: input.title ?? null,
    p_bye_strategy: input.byeStrategy ?? null,
    p_allow_ties: input.allowTies ?? null,
    p_target_score: input.targetScore ?? null,
    p_win_by: input.winBy ?? null,
  });
}

export function deleteTournament(id: string): Promise<Res> {
  return rpc("delete_tournament", { p_tournament: id });
}

/** Switch the format (single-elim / round-robin / pools) — allowed only while the
 *  tournament is still in setup (before a bracket/schedule is generated). */
export function setTournamentFormat(id: string, format: TournamentFormat): Promise<Res> {
  return rpc("set_tournament_format", { p_tournament: id, p_format: format });
}

/** Pull entrants from the activity's sign-ups. Returns the count, or an error. */
export async function importEntrantsFromSignups(id: string): Promise<{ count?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("import_entrants_from_signups", { p_tournament: id });
  if (error) return { error: error.message };
  return { count: (data as number) ?? 0 };
}

export async function addParticipant(id: string, forUser: string | null, name: string | null): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_participant", { p_tournament: id, p_for_user: forUser, p_name: name });
  return error ? { error: error.message } : { id: data as string };
}
export function removeParticipant(participantId: string): Promise<Res> {
  return rpc("remove_participant", { p_participant: participantId });
}

export interface EntrantMemberInput {
  forUser?: string | null;
  name?: string | null;
}
export async function addEntrant(id: string, teamName: string | null, members: EntrantMemberInput[]): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_entrant", {
    p_tournament: id,
    p_team_name: teamName,
    p_members: members.map((m) => ({ for_user: m.forUser ?? null, name: m.name ?? null })),
  });
  return error ? { error: error.message } : { id: data as string };
}
export function removeEntrant(entrantId: string): Promise<Res> {
  return rpc("remove_entrant", { p_entrant: entrantId });
}

/** Random-pair pool individuals into teams. Returns {teamsCreated, leftover}. */
export async function generateTeams(id: string): Promise<{ teamsCreated?: number; leftover?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("generate_teams", { p_tournament: id });
  if (error) return { error: error.message };
  const d = (data ?? {}) as { teams_created?: number; leftover?: number };
  return { teamsCreated: d.teams_created ?? 0, leftover: d.leftover ?? 0 };
}
export function ungroupTeams(id: string): Promise<Res> {
  return rpc("ungroup_teams", { p_tournament: id });
}

/** Generate the bracket. `seedOrderIds` = entrant ids in seed order (null = random). */
export function generateBracket(id: string, seedOrderIds: string[] | null = null): Promise<Res> {
  return rpc("generate_bracket", { p_tournament: id, p_seed_order: seedOrderIds });
}
/** Generate a round-robin schedule (every entrant plays every other once). */
export function generateRoundRobin(id: string, seedOrderIds: string[] | null = null): Promise<Res> {
  return rpc("generate_round_robin", { p_tournament: id, p_seed_order: seedOrderIds });
}
/** Generate the group stage: split into `poolCount` pools, `advance` per pool go
 *  on to the knockout. */
export function generatePools(
  id: string,
  poolCount: number,
  advance: number,
  seedOrderIds: string[] | null = null,
): Promise<Res> {
  return rpc("generate_pools", {
    p_tournament: id,
    p_pool_count: poolCount,
    p_advance: advance,
    p_seed_order: seedOrderIds,
  });
}
/** Seed the knockout from the finished pools (top N of each pool advance). */
export function generateBracketFromPools(id: string): Promise<Res> {
  return rpc("generate_bracket_from_pools", { p_tournament: id });
}
/** Start over. The server refuses when results exist unless `confirm` is true,
 *  and keeps a snapshot either way. `p_confirm` is sent only when true so the
 *  call also works against the pre-0224 one-argument function. */
export function resetBracket(id: string, confirm?: boolean): Promise<Res> {
  return rpc("reset_bracket", confirm ? { p_tournament: id, p_confirm: true } : { p_tournament: id });
}

/** `force` acknowledges that the move erases a recorded result and everything
 *  decided after it; sent only when true (works against pre-0224 too). */
export function setMatchEntrant(
  matchId: string,
  slot: 1 | 2,
  entrantId: string | null,
  force?: boolean,
): Promise<Res> {
  const params: Record<string, unknown> = { p_match: matchId, p_slot: slot, p_entrant_id: entrantId };
  if (force) params.p_force = true;
  return rpc("set_match_entrant", params);
}
export function swapMatchEntrants(
  matchA: string,
  slotA: 1 | 2,
  matchB: string,
  slotB: 1 | 2,
  force?: boolean,
): Promise<Res> {
  const params: Record<string, unknown> = { p_match_a: matchA, p_slot_a: slotA, p_match_b: matchB, p_slot_b: slotB };
  if (force) params.p_force = true;
  return rpc("swap_match_entrants", params);
}

// ── Safety snapshots (migration 0224) ─────────────────────────────────────────

export interface TournamentSnapshot {
  id: string;
  tournamentId: string;
  reason: string;
  takenBy: string | null;
  takenAt: string;
  playedMatches: number;
}

/** Saved copies of a tournament, newest first. Never selects `data` (the full
 *  copy). `available` is false when the table doesn't exist yet (pre-0224). */
export async function fetchTournamentSnapshots(
  tournamentId: string,
): Promise<{ snapshots: TournamentSnapshot[]; available: boolean; error?: string }> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !tournamentId) return { snapshots: [], available: false };
  try {
    const { data, error } = await sb
      .from("tournament_snapshots")
      .select("id, tournament_id, reason, taken_by, taken_at, played_matches")
      .eq("tournament_id", tournamentId)
      .order("taken_at", { ascending: false });
    if (error) {
      const missing = isMissingTable(error) || (error as { code?: string }).code === "PGRST205";
      return missing
        ? { snapshots: [], available: false }
        : { snapshots: [], available: true, error: error.message };
    }
    const rows = (data ?? []) as {
      id: string;
      tournament_id: string;
      reason: string;
      taken_by: string | null;
      taken_at: string;
      played_matches: number;
    }[];
    return {
      available: true,
      snapshots: rows.map((r) => ({
        id: r.id,
        tournamentId: r.tournament_id,
        reason: r.reason,
        takenBy: r.taken_by,
        takenAt: r.taken_at,
        playedMatches: r.played_matches,
      })),
    };
  } catch {
    return { snapshots: [], available: false };
  }
}

/** Put a saved copy back (the current state is snapshotted first server-side). */
export function restoreTournamentSnapshot(id: string): Promise<Res> {
  return rpc("restore_tournament_snapshot", { p_snapshot: id });
}

/** Games with a real result (both sides known and decided, or a scored tie) —
 *  mirrors the server's "played" test. */
export function playedMatchCount(t: Tournament): number {
  return t.matches.filter((m) => isPlayed(m)).length;
}
export function isPlayed(m: TournamentMatch): boolean {
  return (
    !!m.slot1EntrantId &&
    !!m.slot2EntrantId &&
    (!!m.winnerEntrantId || (m.status === "complete" && m.slot1Score != null && m.slot2Score != null))
  );
}

/** Record a result. Winner is required; scores optional. */
export function recordMatchResult(
  matchId: string,
  winnerId: string,
  score1: number | null = null,
  score2: number | null = null,
): Promise<Res> {
  return rpc("record_match_result", {
    p_match: matchId,
    p_winner: winnerId,
    p_score1: score1,
    p_score2: score2,
  });
}
export function clearMatchResult(matchId: string): Promise<Res> {
  return rpc("clear_match_result", { p_match: matchId });
}

/** Set (or clear, with null) a match's scheduled time + reminder lead-times. */
export function scheduleMatch(matchId: string, atISO: string | null, reminderMinutes: number[] = []): Promise<Res> {
  return rpc("schedule_match", { p_match: matchId, p_at: atISO, p_reminders: reminderMinutes });
}

/** Send an immediate matchup push. `when` is the trailing phrase, e.g.
 *  "is up next!" or "is in about 15 minutes". */
export function notifyMatch(matchId: string, when: string): Promise<Res> {
  return rpc("notify_match", { p_match: matchId, p_when: when });
}
