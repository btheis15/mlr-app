<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **14 correction(s)** were applied.

### Tournament brackets (migrations 0144–0154)

**Read this first: this is the largest single feature in this handoff — by a wide margin.** The web implementation is ~866 lines of client seam (`lib/tournaments.ts`), ~1,440 lines across five components, 24 client-callable RPCs, four tables, three formats, and a recursive server-side cascade. Do **not** try to port it in one pass. A v1 scope proposal is at the end; read it before you start typing.

Everything already exists in Supabase. Migrations 0144–0154 are applied in production (migration 0183 rewrote all four of these tables' SELECT policies, which proves the tables are there, and the web feature is live). **No backend change is needed for anything described here**, with two exceptions called out explicitly under "Gaps / possible backend work".

---

#### 1. What it is, in one paragraph

A competitive activity (cornhole, ping-pong, horseshoes) can run a tournament on top of an existing sign-up list. It attaches to **either** a Family Fest activity (`fest_schedule_items`) **or** a member-created private activity (`private_activities`, migration 0150). Any member who can see the parent can **watch** the live bracket; only the parent's manager can seed, arrange, and score it. Three formats: single elimination, round-robin, and pools→knockout. Scoring is one tap — pick the winner, scores are optional — and the winner propagates forward through a `next_match_id` pointer. Changing an already-decided match runs a recursive cascade that wipes every stale downstream result.

---

#### 2. The four tables (Codable-ready)

All writes go through `SECURITY DEFINER` RPCs. **These tables have SELECT policies only — there is no INSERT, UPDATE or DELETE policy on any of the four.** A direct `INSERT` from Swift fails with `42501`; a direct `UPDATE`/`DELETE` matches zero rows and returns **success with an empty array** — the worst possible failure mode. Never write to these tables from the client.

`public.tournaments` — one per host activity:

| column | type | Swift |
|---|---|---|
| `id` | uuid | `UUID` |
| `schedule_item_id` | uuid **nullable** | `UUID?` |
| `private_activity_id` | uuid **nullable** | `UUID?` |
| `title` | text | `String` |
| `format` | text | enum `single_elim` \| `round_robin` \| `pools_bracket` |
| `entrant_type` | text | enum `individual` \| `team` |
| `team_size` | int nullable | `Int?` (null/1 = individual; 2 = doubles) |
| `bye_strategy` | text | enum `byes` \| `play_in` |
| `pool_count` | int nullable | `Int?` (pools format only) |
| `advance_per_pool` | int nullable | `Int?` (pools format only) |
| `tiebreakers` | text[] NOT NULL | `[String]`, default `{win_pct,head_to_head,point_diff,points_for}` |
| `target_score` | int nullable | `Int?` — display hint only (e.g. cornhole to 21) |
| `win_by` | int nullable | `Int?` — display hint only |
| `allow_ties` | boolean NOT NULL | `Bool`, default false |
| `status` | text | enum `setup` \| `live` \| `complete` |
| `created_by` | uuid nullable | `UUID?` |
| `winner_entrant_id` | uuid nullable | `UUID?` — ⚠️ can go stale, see §8 |
| `created_at`, `updated_at` | timestamptz | |

`public.tournament_entrants` — a bracket unit (one player, or a team):
`id`, `tournament_id`, `seed int?` (null until generation), `display_name text` (person's name, team name, or "Alice & Bob"), `team_name text?`, `pool text?` (`'A'`/`'B'`… for pools formats, null otherwise), `signup_team_id uuid?` (back-link to `fest_schedule_signups.team_id`), `position int` (stable entry order, used as a tiebreak), `withdrawn_at timestamptz?`, `created_at`.

⚠️ `withdrawn_at` is **read-only in practice**: the generators and standings exclude a non-null value, but **no RPC anywhere writes it** and there is no UPDATE policy — so from a client it is permanently null. Decode it, honour it in your filters (mirror the server), but do not build a "withdraw" button; that would need a new migration.

`public.tournament_participants` — the actual people:
`id`, `tournament_id`, `entrant_id uuid?`, `user_id uuid?`, `name text`, `position int`, `created_at`.
Two nullable columns carry all the meaning:
- **`entrant_id` null = this person is in the pre-team POOL** (not yet on a bracket unit).
- **`user_id` null = an account-less typed-in name** (the linked-or-typed idiom from event sign-ups, migration 0143). `on delete set null` on `user_id` means the name snapshot survives if that member deletes their account, so a finished bracket is never disturbed.

`public.tournament_matches` — the bracket graph **and** round-robin/pool games:
`id`, `tournament_id`, `stage text` (`pool` \| `bracket`), `pool text?`, `round int` (1 = first round — see the warning below), `position int` (0-based within the round), `slot1_entrant_id uuid?`, `slot2_entrant_id uuid?`, `slot1_score int?`, `slot2_score int?`, `winner_entrant_id uuid?`, `next_match_id uuid?`, `next_slot int?` (1 or 2), `is_play_in bool`, `ready_notified bool` (server bookkeeping — never render it), `status text` (`pending` \| `ready` \| `in_progress` \| `complete`), `created_at`, `updated_at`, plus from migration 0148: `scheduled_at timestamptz?` and `reminder_minutes int[] NOT NULL default '{}'`.

⚠️ **`round` always starts at 1 — there is no round 0.** The 0144 schema comment says "0 = play-in", but that convention is never used: both `generate_bracket` and `_tournament_build_bracket` loop `for r in 1 .. v_r`, and a play-in game is a **round-1** row with `is_play_in = true`. Do not build a "Round 0 = play-in" pager stage; key play-in labelling off `is_play_in`.

⚠️ `in_progress` is in the CHECK constraint but **no RPC ever sets it** — decode it, never expect it.

⚠️ `reminder_minutes` is NOT NULL with a `{}` default, so decode as `[Int]`; but the web seam still defensively coerces `nil → []`. Do the same in Swift (`decodeIfPresent(...) ?? []`) — it costs nothing and survives a pre-0148 row if any exist.

**Ordering the server does not do for you** (mirror the web's `assemble()` exactly, or your bracket looks scrambled):
- entrants: sort by `seed` ascending with **nulls last**, then `position`.
- matches: sort by `round`, then `position`.
- an entrant's members: the participants with that `entrant_id`, sorted by `position`.
- the pool: participants with `entrant_id == nil`, sorted by `position`.

Realtime: all four tables have `replica identity full` and are in the `supabase_realtime` publication.

---

#### 3. The polymorphic parent — `schedule_item_id` XOR `private_activity_id`

Originally (0144) `tournaments.schedule_item_id` was `NOT NULL`. Migration **0150** dropped that, added `private_activity_id`, and added:

```sql
constraint tournaments_one_host check (num_nonnulls(schedule_item_id, private_activity_id) = 1)
```

So **exactly one is set, always**. In Swift model this as an enum rather than two optionals you have to keep straight. (Web's equivalent is the TS discriminated union `TournamentHost = {kind:'schedule'|'activity', id}`; the Swift shape is:)

```swift
enum TournamentHost { case schedule(UUID)   // a fest_schedule_items row
                      case activity(UUID) } // a private_activities row
```

and threads it through fetch/create/import. Fetch is `.eq("schedule_item_id", id)` or `.eq("private_activity_id", id)` accordingly, ordered by `created_at` ascending.

⚠️ **A fest activity can hold MORE THAN ONE tournament.** Only private activities are capped: migration 0151 added the partial unique index `tournaments_one_per_activity on tournaments (private_activity_id) where private_activity_id is not null`, and made `create_activity_tournament` **idempotent** (it returns the existing tournament's id instead of inserting). There is **no** equivalent guard on `schedule_item_id` — repeated `create_tournament` taps on a fest activity really do stack duplicate rows. Fetch a **list** and render a card per row, like web does; do not `.single()`.

⚠️ **`tournament_enabled` is a column on `fest_schedule_items` (migration 0147) and on `private_activities` (0150) — it does NOT exist on `fest_activities`.** The iOS "Anytime" section reads `fest_activities`, which can never host a tournament. Tournaments only ever hang off `fest_schedule_items`. If the iOS schedule model doesn't currently select `fest_schedule_items.tournament_enabled`, add it (`boolean not null default false`, public-read like the rest of that table) — and **only render the tournament section when it's true**, so the section never appears on non-tournament activities.

⚠️ **Only mount on a real DB row.** Family Fest has in-code *seed* schedule events whose ids are slugs (`"ye-olde-family-faire"`), not uuids. Web guards with a uuid regex before mounting anything, because `.eq("schedule_item_id", "ye-olde-...")` is a type error against a uuid column. If your iOS schedule merges seed content the same way, guard the same way (`UUID(uuidString:) != nil`).

---

#### 4. RLS read rules — one sentence per table

Migration **0183** dropped and recreated all four policies, **replacing** the old `auth.uid() is not null` clause with `is_approved_member()` (= `profiles.approved` true **or** `profiles.is_admin` true — the admin-verification gate from 0181/0182). The function resolves `where id = auth.uid()`, so it already implies a real session; there is no separate signed-in clause any more.

- **`tournaments`** — readable by an *approved* signed-in member; if `private_activity_id` is set, only when you are also that activity's creator, on its roster, or an admin (`is_private_activity_member()`).
- **`tournament_entrants`** — readable when you can read its parent `tournaments` row (same predicate, via an `exists` subquery).
- **`tournament_participants`** — same rule as entrants.
- **`tournament_matches`** — same rule as entrants.

**So an empty result almost always means "not permitted", not "no data."** Specifically: a brand-new unverified signup gets **zero rows on all four tables** and will see an apparently empty/broken tournament screen. Handle that with the same "waiting for a grown-up to verify you" state the rest of the app uses — do not show "no bracket yet".

Guests (no session) get nothing; web renders a "Sign in to see the bracket and scores" card in place of the section.

---

#### 5. Permissions — `is_tournament_manager` defers to the existing per-item predicate

There is **no new organizer role**. Migration 0144 introduced:

```sql
is_tournament_manager(p_tournament uuid) returns boolean   -- granted to authenticated
```

0144's version only knew about fest hosts; migration **0150** recreated it with the two-way branch that resolves whichever host is set and defers:
- **fest host** → `_can_manage_item_signups(schedule_item_id)` — which is `can_edit_fest()` (admin **or** a `committee_roster` link to the `family-fest` committee) **OR** `fest_schedule_items.lead_user_id = auth.uid()` **OR** `auth.uid() = any(fest_schedule_items.crew_user_ids)`. Exactly the same gate as that item's sign-ups.
- **private-activity host** → `is_private_activity_host(private_activity_id)` — creator, app admin, or a roster row with `role = 'host'`.

Every mutating RPC re-checks this server-side, so the client flag is UI-only.

**How to compute "can I manage this?" in Swift** — three options, best first:
1. `rpc("is_tournament_manager", ["p_tournament": id])` → `Bool`. Can't drift from the server. Needs the tournament to already exist. (Web never actually calls this — it uses option 3 — but the RPC exists and is granted to `authenticated`.)
2. For "can I *create* one here": `rpc("_can_manage_item_signups", ["p_item_id": scheduleItemId])` → `Bool` (yes, the leading underscore is fine over PostgREST — this one **is** granted to `authenticated`), or `rpc("is_private_activity_host", ["p_activity": id])`.
3. What web actually does (to avoid a round-trip per row): cache `rpc("can_edit_fest")` once per session and OR it with a local `event.leadUserId == uid || event.crewUserIds.contains(uid)` check.

⚠️ Most of the tournament helper functions are **revoked from `authenticated`** and will 404/403 if you call them: `_tournament_advance`, `_tournament_seed_order`, `_tournament_build_bracket`, `_tournament_deep_link`, `_seed_activity_tournament`, `_notify_tournament_all`, `_notify_tournament_match`, `_notify_match_matchup`, `run_tournament_match_reminders`, and `_notify` itself. Also revoked: the row-taking `_can_manage_schedule_signups(fest_schedule_items)`. The one underscore-prefixed function you'd ever want here is `_can_manage_item_signups(uuid)`. (`_humanize_minutes(int)` from 0140 happens to be callable too — it was never revoked, so it keeps the default PUBLIC grant — but there is no reason to call it from a client.)

---

#### 6. ⚠️⚠️ The one query you must get exactly right

`tournaments` has **two** foreign-key relationships to `tournament_entrants`: the normal child FK (`tournament_entrants.tournament_id`) and `tournaments_winner_fk` (`tournaments.winner_entrant_id → tournament_entrants.id`, declared at the end of 0144 once `tournament_entrants` exists — it is an ordinary immediately-checked FK, *not* a `DEFERRABLE` one). PostgREST cannot pick one, so an unqualified embed returns **HTTP 300 / `PGRST201` "more than one relationship found"** and the *entire fetch* fails — you get an empty tournament with no obvious cause. The child FK must be named:

```
*,tournament_entrants!tournament_entrants_tournament_id_fkey(*),tournament_matches(*),tournament_participants(*)
```

(`tournament_matches` and `tournament_participants` each have only one relationship to `tournaments`, so they're fine bare.) This exact bug has bitten this codebase before on this exact pair — if a Swift decode ever comes back empty for a tournament you know exists, check the HTTP status for 300 before anything else.

If you'd rather not fight nested decoding in Swift, **four separate flat queries** filtered by `tournament_id` and assembled locally is equally correct and sidesteps the ambiguity entirely. Given the assembly work you have to do anyway (§2), that's the recommendation for iOS.

---

#### 7. The three formats

| format | generation RPC | what the rows look like |
|---|---|---|
| `single_elim` | `generate_bracket` | `stage='bracket'`, `next_match_id`/`next_slot` wired child→parent, round 1 fold-seeded, byes auto-resolved |
| `round_robin` | `generate_round_robin` | `stage='bracket'`, **`next_match_id` is null on every row**, `round`/`position` are display-only groupings from the circle method |
| `pools_bracket` | `generate_pools` then `generate_bracket_from_pools` | pool games are `stage='pool'` + `pool='A'…`; the knockout is `stage='bracket'` with pointers |

**Single elimination.** Bracket size B = next power of two ≥ N; rounds R = log₂B. Round 1 is seated by standard fold-seed order (`_tournament_seed_order`), so seed 1 meets the weakest and 1 v 2 can only happen in the final. Phantom seeds > N leave a null slot = a **bye**, which the generator immediately completes (winner set, `status='complete'`) and advances. `bye_strategy`: `byes` (top seeds rest — falls out of fold seeding) or `play_in` (identical graph; round-1 real games get `is_play_in = true` so you can label them). Passing `p_seed_order = nil` gives random seeding, which naturally scatters the byes.

**Round-robin.** Circle method, every pair once; an odd count gets a phantom that simply produces no row that round. Standings are **computed client-side** from the tournament's ordered `tiebreakers`; the server only stamps a best-effort leader as champion once every game is complete (wins → point diff → points-for → seed), for the notification and the banner.

**Pools → bracket.** Entrants are dealt across `pool_count` pools by seed: `pool = chr(65 + ((seed-1) % pool_count))`, i.e. seed 1→A, 2→B, 3→A, 4→B… ⚠️ The SQL comment calls this "snaked", but the formula is a plain round-robin **deal**, not a serpentine snake (which would be 1→A, 2→B, 3→B, 4→A) — implement the formula, not the word, or your preview will disagree with the server. Each pool is a round-robin. `generate_bracket_from_pools` **refuses until every `stage='pool'` game is complete** ("Finish every pool game first (N left)"), then takes the top `advance_per_pool` per pool and cross-seeds them: global seed = `(pool_rank-1) * pool_count + pool_index + 1` (pool_index from `ascii(pool) - 65`), so pool winners land on opposite ends of the draw.

⚠️ Each generator hard-refuses a mismatched format (`generate_bracket` → "Only single-elimination is supported yet" if `format <> 'single_elim'`; `generate_round_robin` → "This tournament isn't a round-robin"; `generate_pools`/`generate_bracket_from_pools` → "This tournament isn't a pools → bracket"). To change format, call `set_tournament_format` first — **setup status only** (migration 0154; it raises "Reset the bracket before changing the format" otherwise). Same entrants work for all three formats, so no data reshaping is needed.

⚠️ Round-robin and pool games have no progression pointers, so "Final / SF / QF" labels are **wrong** there. Web decides with `matches.allSatisfy { $0.nextMatchId == nil }` → fall back to `"Round n · Game m"`. For pools, filter by `stage` per tab; a card list mixing pool games and knockout games is meaningless.

---

#### 8. Recording a result — winner alone, scores optional, and the cascade

```sql
record_match_result(
  p_match  uuid,
  p_winner uuid  default null,
  p_score1 int   default null,
  p_score2 int   default null
) returns void
```

Rules, in order, as the SQL actually runs them (0145 replaced 0144's version — this is the live one):
1. Both slots must be filled, else "Both sides must be set before recording a result".
2. If `p_winner` is given it must be one of the two slot entrants. **A winner alone is a complete result** — that's the primary interaction.
3. If `p_winner` is null but both scores are given, the higher score wins.
4. If both scores are equal: raises unless `allow_ties`, in which case the winner is recorded as **null** (a real tie) — but only for round-robin; a bracket match with a `next_match_id`, or any `single_elim`/`pools_bracket` tournament, raises "a bracket game can't end tied".
5. On save: scores + winner are written and `status='complete'`.
6. **Propagation**: if `next_match_id` is set and the winner actually changed, `_tournament_advance(next_match_id, next_slot, old_winner, new_winner)` runs; then if that next match is now `ready` and `ready_notified` is false, everybody in it gets a one-time `tournament_match_ready` notification.
7. If there's no `next_match_id` and the format is `single_elim`/`pools_bracket` and `stage='bracket'` → **this is the final**: `tournaments.winner_entrant_id`/`status='complete'` are set and a `tournament_champion` notification fans out.
8. For `round_robin`, nothing propagates; once zero matches remain incomplete the standings leader is crowned.

**The cascade.** `_tournament_advance` puts the new winner into the next match's slot, and then: *if that match was already decided, its result is now invalid* — winner and both scores are cleared, `ready_notified` reset, status recomputed (`ready` if both slots filled, else `pending`) — **and it recurses forward with `p_new = null`**, so every downstream result derived from the old winner is wiped and the slots emptied. That's how a corrected quarterfinal replays the rest of the bracket. `clear_match_result(p_match)` does the same thing from a standing start.

⚠️ **`clear_match_result` re-opens the tournament for ANY match with no `next_match_id`, not just "the final."** The actual SQL is `update tournaments set status='live', winner_entrant_id=null where id = m.tournament_id and m.next_match_id is null` — and every round-robin game and every `stage='pool'` game also has a null pointer. So clearing one round-robin result flips the whole tournament back to `live` and drops the champion. That's usually what you want there, but don't model it as "only the final".

⚠️ **`set_match_entrant` and `swap_match_entrants` also wipe results.** `set_match_entrant(p_match, p_slot, p_entrant_id)` unconditionally nulls that match's `winner_entrant_id`, `slot1_score`, `slot2_score` (and `ready_notified`) — *even when you're only filling an empty slot* — and, if the match had been decided, cascades forward. `swap_match_entrants(p_match_a, p_slot_a, p_match_b, p_slot_b)` is literally two `set_match_entrant` calls, so a swap **destroys the results of both matches**. Web's "⇄ Rearrange" mode is deliberately only offered on a bracket view; if you ship rearrange in v1, warn before the tap.

⚠️⚠️ **`tournaments.winner_entrant_id` can go STALE — do not trust it as your champion.** `_tournament_advance` clears the *final match's* result during a cascade but never touches the `tournaments` row; only `clear_match_result` called *directly on the final* resets `status`/`winner_entrant_id`. So: record the final → tournament is `complete` with a champion → then change a semifinal → the final is correctly cleared and re-opened, but the tournament still reads `status='complete'` with the **old** champion. (The web has this bug too.) A second route to the same state: `generate_bracket_from_pools` sets `status='live'` **without** `winner_entrant_id = null` (unlike `generate_bracket`/`generate_round_robin`/`generate_pools`, which all null it), so regenerating a pools knockout leaves the previous champion in place. In Swift, derive the champion from the final match instead — the `stage='bracket'` match with `next_match_id == nil`, `status == "complete"`, and a non-nil `winner_entrant_id` — and only fall back to the column for round-robin/pools where there is no single final in the same sense.

⚠️ **You cannot record a tie through the current client API.** The web wrapper always requires a non-nil winner, and *nothing anywhere in the web UI ever sets `allow_ties`* (`update_tournament` exposes `p_allow_ties`, but no surface calls it — the only field any web screen sends is `p_bye_strategy`). If iOS wants ties, you must (a) call `update_tournament` with `p_allow_ties: true`, and (b) call `record_match_result` with `p_winner: nil` and both scores — round-robin only. Treat that as out of v1 scope.

⚠️ **Concurrency**: every mutating RPC takes `pg_advisory_xact_lock(hashtextextended(tournament_id::text, 0))`, so two managers scoring at once are serialized server-side (one call blocks briefly, it does not fail). Still keep a **per-match in-flight guard** in Swift so a double-tap can't fire two writes that settle out of order — web keeps a `[matchId: Task]` dictionary and returns the existing task on a second tap.

⚠️ **Optimistic UI**: web's `applyMatchResult` models only the single forward step (decide the match, put the winner in `nextSlot` of `nextMatchId`, recompute that match's `ready`/`pending`, and set the tournament complete if it was the final). It **deliberately does not model the cascade-clear**, and refetches from the server the moment the RPC returns. Copy that split exactly — a local cascade implementation is a second source of truth that will disagree.

---

#### 9. Entrants, imports, and account-less typed names

**Import from the parent** (destructive — both refuse unless `status='setup'`, and both `DELETE` every existing participant *and* entrant first):
- `import_entrants_from_signups(p_tournament uuid) → int` — fest host. For a **team** tournament (`entrant_type='team'` and `team_size > 1`), each `fest_schedule_signups.team_id` group becomes one entrant (label = the group's `team_name`, else the members joined with `" & "`, else `"Team"`) with its people attached, and un-teamed sign-ups drop into the pool. For an **individual** tournament, every sign-up lands in the pool. Returns the count (teams created, or people pooled). ⚠️ It does **not** check that the tournament is a fest tournament: called on a private-activity tournament it still deletes every participant and entrant, then imports nothing (its reads are `where s.schedule_item_id = v_t.schedule_item_id`, which is NULL there) and returns `0` with no error. Only ever call it for `.schedule(...)` hosts.
- `import_entrants_from_activity_members(p_tournament uuid) → int` — private-activity host (0153). Guarded (`raise exception 'Not a private-activity tournament'` when `private_activity_id is null`). Individuals are seeded as **real entrants immediately** (one solo entrant each, so the seed-order list is orderable right away); teams land in the pool. Returns the roster count.

**Auto-seeding on creation**: `create_activity_tournament` already seeds the players from the activity roster (0152/0153, via `_seed_activity_tournament`) — for a private activity the roster *is* the player list, so the import button in the UI is only a "↻ Re-sync players from activity" affordance, not a required first step. `create_tournament` (fest) does **not** auto-seed; the manager must pull sign-ups in.

**Hand adds**:
- `add_participant(p_tournament uuid, p_for_user uuid default null, p_name text default null) → uuid` — one person into the pool. Pass `p_for_user` for a linked member (the name is snapshotted from `profiles.display_name`), or `p_name` for **an account-less typed name**. ⚠️ There's a partial unique index `tournament_participants_uniq_user (tournament_id, user_id) where user_id is not null`, so adding the same member twice fails with Postgres `23505` — catch it and say "already in". Typed names are deliberately **not** deduped (two "John"s are fine).
- `remove_participant(p_participant uuid) → void`.
- `add_entrant(p_tournament uuid, p_team_name text default null, p_members jsonb default null) → uuid` — the "they're already a team" path. `p_members` is a JSON array of `{"for_user": uuid|null, "name": string|null}`; it must be non-empty ("Add at least one person"). For a team tournament the count must equal `team_size` exactly ("A team needs exactly N people"). Display name = `p_team_name`, else the members joined with `" & "`.
- `remove_entrant(p_entrant uuid) → void` — setup only; its members drop back to the pool (`entrant_id → null`) rather than being deleted.
- `generate_teams(p_tournament uuid) → jsonb` — random-pairs the pool into teams of `team_size`. Returns `{"teams_created": n, "leftover": m}`; **leftover people stay in the pool and will not compete**. Setup only, team format only.
- `ungroup_teams(p_tournament uuid) → void` — everyone back to the pool, all entrants deleted. Setup only.

⚠️ **Account-less typed names are first-class everywhere** — they seed, they play, they win, they appear in standings. The single thing they can't do is receive a notification (`_notify_tournament_*` and `_notify_match_matchup` all filter `pp.user_id is not null`). Never promise a push to a typed-in name in copy.

⚠️ **"How many will actually compete" is not `entrants.count`.** For `entrant_type='individual'`, the generators promote every pool participant to a solo entrant at generation time, so the real number is `entrants.count + pool.count` (web calls this `readyCount` and gates its Generate button on `readyCount >= 2`). For teams, only formed entrants count. Getting this wrong disables the Generate button on a perfectly valid tournament — or lets a manager generate a bracket with one entrant, which raises "Need at least two entrants to generate a bracket".

---

#### 10. Complete RPC list — real names, real parameter order

Supabase RPC calls are keyed by parameter **name**, so a typo fails at runtime with a "function does not exist" style error. All of these are `revoke ... from public, anon` + `grant execute ... to authenticated`.

Lifecycle / config:
- `create_tournament(p_item uuid, p_title text, p_format text = 'single_elim', p_entrant_type text = 'individual', p_team_size int = null, p_bye_strategy text = 'byes') → uuid`
- `create_activity_tournament(p_activity uuid, p_title text, p_format text = 'single_elim', p_entrant_type text = 'individual', p_team_size int = null, p_bye_strategy text = 'byes') → uuid` — idempotent, auto-seeds the roster, and flips `private_activities.tournament_enabled` true
- `update_tournament(p_tournament uuid, p_title text = null, p_bye_strategy text = null, p_allow_ties boolean = null, p_target_score int = null, p_win_by int = null) → void`
- `set_tournament_format(p_tournament uuid, p_format text) → void` — setup only
- `delete_tournament(p_tournament uuid) → void`
- `reset_bracket(p_tournament uuid) → void` — deletes all matches, nulls every `seed`, back to `status='setup'`, clears `winner_entrant_id`. Entrants and participants are kept. ⚠️ It does **not** clear `tournament_entrants.pool` or `tournaments.pool_count`/`advance_per_pool`, so a pools tournament in setup still carries its 'A'/'B' labels — a UI that derives pool tabs from `entrant.pool` will show pools with zero pool games until you regenerate.

Entrants:
- `import_entrants_from_signups(p_tournament uuid) → int`
- `import_entrants_from_activity_members(p_tournament uuid) → int`
- `add_participant(p_tournament uuid, p_for_user uuid = null, p_name text = null) → uuid`
- `remove_participant(p_participant uuid) → void`
- `add_entrant(p_tournament uuid, p_team_name text = null, p_members jsonb = null) → uuid`
- `remove_entrant(p_entrant uuid) → void`
- `generate_teams(p_tournament uuid) → jsonb`
- `ungroup_teams(p_tournament uuid) → void`

Generation:
- `generate_bracket(p_tournament uuid, p_seed_order uuid[] = null) → void`
- `generate_round_robin(p_tournament uuid, p_seed_order uuid[] = null) → void`
- `generate_pools(p_tournament uuid, p_pool_count int = 2, p_advance int = 1, p_seed_order uuid[] = null) → void`
- `generate_bracket_from_pools(p_tournament uuid) → void`

`p_seed_order` is **entrant ids, index 0 = seed 1**. It is applied only when `array_length(p_seed_order,1)` equals the live entrant count exactly — otherwise it is silently ignored and seeding is randomized. Two ways that bites: (a) if you let the manager reorder while someone else is adding a player, the reorder is quietly discarded; (b) ⚠️ **for `entrant_type='individual'` the count is taken AFTER the RPC promotes every pool participant to a solo entrant**, so any non-empty pool guarantees a length mismatch and random seeding. Web reflects this — `doGenerate` sends `null` unless the order array length equals the *existing* entrant count. Send `nil` for random.

Scoring / arrangement:
- `record_match_result(p_match uuid, p_winner uuid = null, p_score1 int = null, p_score2 int = null) → void`
- `clear_match_result(p_match uuid) → void`
- `set_match_entrant(p_match uuid, p_slot int, p_entrant_id uuid) → void` — `p_slot` must be 1 or 2; `p_entrant_id` may be null to clear (no default — pass it explicitly)
- `swap_match_entrants(p_match_a uuid, p_slot_a int, p_match_b uuid, p_slot_b int) → void` — both matches must be in the same tournament

Scheduling + pushes (migration 0148):
- `schedule_match(p_match uuid, p_at timestamptz = null, p_reminders int[] = '{}') → void` — set/clear a match's time and its reminder lead-times in minutes. Re-scheduling **deletes the fired-reminder ledger rows** for that match so the new time re-arms them. Web only ever sends `[15]`.
- `notify_match(p_match uuid, p_when text = 'is up next!') → void` — immediate per-side push: each side is told *the other* entrant's name ("Your matchup against {other} {p_when}").

Predicates:
- `is_tournament_manager(p_tournament uuid) → boolean`
- `_can_manage_item_signups(p_item_id uuid) → boolean`
- `is_private_activity_host(p_activity uuid) → boolean`
- `can_edit_fest() → boolean`

Server-side only (pg_cron, no client involvement): `run_tournament_match_reminders()` ticks every minute, fires `_notify_match_matchup` for each `(match, lead-time)` whose moment has arrived, and dedupes through the `tournament_match_reminders_sent (match_id, minutes)` ledger. It only considers matches that are not `complete` and have both slots filled, and it skips any whose `scheduled_at` is more than 2 hours in the past.

⚠️ `notify_match`'s `p_when` is appended **verbatim** to the notification body. This app already learned the hard way (migration 0165, in the sign-up reminders) that a sender-chosen phrase like "is in 30 minutes" can flatly contradict the stored time and there is no way for the recipient to tell. Either reuse web's two fixed phrases (`"is up next!"`, `"is in about 15 minutes"`) or state the real `scheduled_at` — do not build a free-text lead-time picker.

---

#### 11. Notifications

Three kinds, all fanned out by `_notify` so they respect each recipient's `profiles.notif_types` and skip the actor:
- `tournament_published` — at generation (`generate_bracket` / `generate_round_robin` / `generate_pools`), to every participant with an account.
- `tournament_match_ready` — one-time per match (guarded by `tournament_matches.ready_notified`), plus the personalized matchup pushes from `notify_match` / the cron, **plus** a whole-tournament fan-out from `generate_bracket_from_pools` ("Knockout bracket is set: …") that reuses this same kind rather than `tournament_published`. So don't assume a `tournament_match_ready` row is always about one specific match.
- `tournament_champion` — when the final (or the last round-robin game) lands.

All three are already in `profiles.notif_types`' default list, and — importantly for you — **already in the iOS APNs sender's pushable set** (`media-server/apns-sender.js` lists `"tournament_published", "tournament_match_ready", "tournament_champion"`). So registered iOS devices are already receiving these pushes today; the app just has nowhere to land them.

⚠️ **The deep link in the payload is a WEB path — and it is not always populated.** `_notify_tournament_all` / `_notify_tournament_match` (recreated in 0150) build `notifications.url` from `_tournament_deep_link`: `/family-fest/schedule/<schedule_item_id>` for a fest tournament, `/events?activity=<private_activity_id>` for a private one. But `_notify_match_matchup` (0148 — the `notify_match` RPC **and** the cron reminders) was never updated for the polymorphic parent: it still hardcodes `'/family-fest/schedule/' || schedule_item_id`, so for a **private-activity** tournament that concatenation is `NULL` and the row lands with **no url at all**. Every kind does carry `entity_type = 'tournament'` and `entity_id = <tournament id>`. **Route off `entity_type`/`entity_id`, not the URL** — that's the only stable contract, and the ids are what you actually need anyway.

---

#### 12. Pure math you must port (and port exactly)

The server generation is authoritative, but the setup preview has to agree with it or the manager sees one bracket and gets another. Port these from `lib/tournaments.ts`; they're small.

```swift
func bracketSize(_ n: Int) -> Int { n < 2 ? n : { var b = 1; while b < n { b *= 2 }; return b }() }
func byeCount(_ n: Int) -> Int { max(0, bracketSize(n) - n) }
func lowerPow2(_ n: Int) -> Int { n < 1 ? 0 : { var b = 1; while b*2 <= n { b *= 2 }; return b }() }

/// Fold-seed slot order for a size-`size` bracket: element p (0-based) is the
/// 1-based seed number occupying slot p. Must match SQL `_tournament_seed_order`.
func seedOrder(_ size: Int) -> [Int] {
    if size <= 1 { return [1] }
    var arr = [1, 2], sz = 2
    while sz < size {
        var next: [Int] = []
        for s in arr { next.append(s); next.append(2*sz + 1 - s) }
        arr = next; sz *= 2
    }
    return arr
}
```

`firstRoundPreview(names, strategy)` then walks `i in 0..<(B/2)`, taking `order[2i]` and `order[2i+1]`; a seed > N is a bye (nil name); `isPlayIn = strategy == .playIn && B > N && !isBye`. `bracketSummary` is the one-liner ("12 entrants · 16-team bracket · 4 byes (top seeds rest)" / "12 entrants · 4 play-in games → clean 8-team draw").

`computeStandings(tournament, pool:)` — only needed if you ship round-robin/pools. Counts only `status == .complete` matches where both slots are present *and both entrants are in scope*; a match with `winnerEntrantId == nil` counts as a tie for both. `winPct = (wins + 0.5*ties) / played` (0 when unplayed). Then sort by the tournament's ordered `tiebreakers` array — `win_pct`, `point_diff` (`pointsFor - pointsAgainst`), `points_for`, `head_to_head` (find the one match between the two; the winner sorts first; no match or a tied match contributes 0 and falls through) — with `seed ?? position ?? .max` as the final tiebreak. **Point columns are hidden until any score exists anywhere** (`hasAnyScores`), because scores are optional and a winner-only round-robin should read as a clean W-L table.

---

#### 13. Web idioms that do NOT transfer

- **The SWR/localStorage cache doesn't port.** Web's `useTournament(host)` uses a `sessionStorage`-persisted, uid-scoped key (`tournament.<uid>.<kind>.<hostId>`). In Swift use whatever cache the app already has for houses/work items, and keep the uid in the key — a shared cache key once leaked one member's private data to the next user on this codebase (see the flicker-cache incident in CLAUDE.md).
- **Realtime**: web opens a single channel per host and subscribes to `postgres_changes` on all four tables **unfiltered**, debounced 250 ms, and then refetches the whole tournament. In Swift you can do better: filter the three child tables with `tournament_id=eq.<id>`. Still refetch-and-reassemble rather than patching rows — the cascade means one RPC can change a dozen rows at once and you'll never reconstruct that from individual change events.
- **Timestamp decoding**: `scheduled_at`, `created_at`, `updated_at`, `withdrawn_at` come back from PostgREST as `2026-08-10T15:04:05.123456+00:00`. Swift's `.iso8601` strategy chokes on 6-digit fractional seconds. Reuse the app's existing custom date decoding strategy; do not add a second one. Web keeps them as raw strings and only parses `scheduled_at` for display — that's also a valid choice here (`String?` in the model, formatted on demand).
- **Nothing about canvas/EXIF/image handling is relevant** — there's no media in this feature at all.
- **`datetime-local` ⇄ ISO conversion**: web hand-rolls a local-offset shim (`toLocalInput`) for its schedule input. On iOS use a `DatePicker` and send `ISO8601DateFormatter` output with the offset — `schedule_match`'s `p_at` is a real `timestamptz`, so the offset matters and there is no date-string trap here (unlike sign-up slots, which store bare `YYYY-MM-DD` and caused a whole one-day-off incident).

---

#### 14. Rendering notes worth stealing

- **The bracket pages one round at a time**, driven by a segmented control, so a round fits a phone without horizontal scrolling. Default the pager to the earliest round that still has an undecided match with both slots filled; else the last round. Round labels: `Final` / `SF` / `QF` computed as `maxRound - round`, else `R{n}` — and `R{n}` only, always, when nothing has a `nextMatchId`.
- **A match card** is two stacked rows (slot 1, divider, slot 2) plus a footer strip. Slot label: entrant name, else `"Bye"` if the match is complete, else `"TBD"`. Winner row gets a tint + bold. Footer shows a `Play-in` or `Ready` chip, the scheduled time if any, and "Tap to score" for managers.
- **A bye is not a game**: `(slot1 == nil) != (slot2 == nil) && status == .complete`. Dim it and make it non-tappable.
- **Tappable to score** only when: not rearranging, viewer is a manager, both slots filled *or* already complete, and it isn't a bye.
- **The result sheet** leads with "Tap the winner" (two big buttons), with scores behind an "Add scores (optional)" disclosure. Before saving a *change* to an already-decided match, walk the `nextMatchId` chain forward collecting matches that currently hold a `winnerEntrantId` and spell it out: "⚠️ Changing this will reset N later matches (Semifinal, Final) so they can be replayed", and swap the button to "Change & reset". That warning is the single most valuable piece of UX in this feature — the cascade is destructive and invisible otherwise.
- **A "Now" tab** for spectators is cheap and high-value: the `ready` matches, plus the last four completed ones as "X beat Y, 21–13". Most family members will never open the bracket grid.

---

#### 15. Gaps / possible backend work (flagging loudly, per the rules)

Things a thorough iOS port might want, none of which exists today:

1. **The stale-champion bug (§8)** is a genuine server-side defect (`_tournament_advance` should reset `tournaments.status`/`winner_entrant_id` when it clears a final; and `generate_bracket_from_pools` should null `winner_entrant_id` like the other three generators do). Fixing it is a real migration. **Don't fix it as part of the iOS port** — work around it client-side by deriving the champion from the final match, and raise it separately so web and iOS get the fix together.
2. **Ties are effectively unreachable** (§8) — no UI anywhere sets `allow_ties`. That needs no migration (the RPC parameter exists), just a client surface. Out of v1 scope.
3. **`withdrawn_at` has no writer** (§2) — the column is honoured by every generator and by standings, but nothing sets it and the tables take no client UPDATE. A real "withdraw an entrant" feature needs a new RPC. Don't design a withdraw button expecting it to work.
4. **The matchup-reminder deep link is broken for private activities** (§11) — `_notify_match_matchup` predates 0150 and yields a NULL `url` there. Routing off `entity_id` sidesteps it entirely for iOS, but it's a one-line server fix worth raising.

Also worth verifying with one `select` before you build against them: the migration-0148 columns `tournament_matches.scheduled_at` / `.reminder_minutes`, the `tournament_match_reminders_sent` ledger table, and the `schedule_match` / `notify_match` RPCs. The web reads and calls them and web is live, so they should be present — but 0183 only proves the four base tables exist.

---

#### 16. Suggested v1 scope

**Ship a spectator-only, single-elimination, fest-activity bracket first.** Concretely:

*v1 (small, genuinely useful, ~a day or two)*
- Add `tournament_enabled` to the `fest_schedule_items` model; render a `TournamentSection` only when true and the id is a real uuid.
- Four flat fetches by `tournament_id`, assembled locally per §2 (skip the nested-embed FK trap entirely).
- Read-only round-paged bracket + the "Now" summary (ready matches / recent results). Byes dimmed. Champion banner derived from the final match.
- Realtime on the four tables → debounce → refetch. That alone makes the phone a live scoreboard during fest week, which is most of the value.
- Route the three existing tournament pushes (they already arrive) to that screen via `entity_id`.

*v1.5 — manager scoring*
- `is_tournament_manager` gate, the result sheet (winner tap + optional scores), `record_match_result`, `clear_match_result`, and the downstream-reset warning. This is the piece that lets iOS actually *run* a bracket.

*v2 — setup*
- `create_tournament` + `import_entrants_from_signups` + seed reorder + `generate_bracket`, with the fold-seed preview. This is the biggest chunk of UI (web's setup sheet is 458 lines) and the least urgent — a manager can set the bracket up on the web and score it on the phone.

*Explicitly omit from v1*
- `round_robin` and `pools_bracket` (that's the standings table, the pools tabs, the tiebreaker legend, `generate_bracket_from_pools`, and stage filtering everywhere — call it a third of the whole feature).
- Teams (`entrant_type='team'`, `generate_teams`, `add_entrant`, the pool concept in the UI).
- Rearrange mode (`set_match_entrant` / `swap_match_entrants`) — destructive and fiddly.
- Match scheduling + `notify_match` (migration 0148).
- Private-activity tournaments — they depend on the whole private-activities feature (0150) also being ported. If private activities aren't in scope, hard-code `TournamentHost = .schedule(...)` and the polymorphism costs you nothing.
