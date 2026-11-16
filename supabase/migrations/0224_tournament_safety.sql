-- 0224_tournament_safety.sql
--
-- A tournament in progress must not be erasable or reshuffle-able by accident.
--
-- What happened: partway through a real tournament the bracket was wiped and
-- reseeded. Every generate_* function started with
-- `delete from tournament_matches where tournament_id = …` and none of them
-- checked whether the tournament had already started, and the "Generate
-- bracket" button stayed on the Manage sheet after start on both clients. One
-- tap rebuilt the bracket, and with a stale seed order it reseeded at random.
-- reset_bracket, the rearrange swaps and both deletes were equally unguarded,
-- and nothing kept a copy, so there was no way back.
--
-- This migration puts the rule on the server, where an old app build or the
-- other client cannot skip it:
--
--   1. generate_bracket / generate_round_robin / generate_pools only run while
--      the tournament is in setup.
--   2. generate_bracket_from_pools will not rebuild a knockout that has results.
--   3. reset_bracket, set_match_entrant and swap_match_entrants refuse to
--      destroy recorded results unless the caller passes an explicit
--      confirm/force flag (a new trailing argument, default false, so existing
--      callers keep working for the harmless cases and are refused for the
--      destructive ones).
--   4. Every operation that can destroy results first writes a full snapshot
--      of the tournament to tournament_snapshots, and
--      restore_tournament_snapshot() puts one back. Deletes snapshot too.
--   5. Clearing the final's result (directly or by a cascade) takes the
--      tournament out of 'complete', so a stale champion is never shown.
--
-- The original function bodies are NOT copied here. Each is renamed to an
-- internal `_…_unguarded` name (execute revoked from clients) and a thin
-- guarded function takes over its public name, so the generation logic itself
-- is byte-for-byte what was already running.

begin;

-- ── Snapshots ────────────────────────────────────────────────────────────────
-- No FK to tournaments on purpose: a snapshot must outlive a deleted tournament.
create table if not exists public.tournament_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null,
  private_activity_id uuid,
  schedule_item_id    uuid,
  reason              text not null,
  taken_by            uuid,
  taken_at            timestamptz not null default now(),
  played_matches      int not null default 0,
  data                jsonb not null
);
create index if not exists tournament_snapshots_t_idx
  on public.tournament_snapshots (tournament_id, taken_at desc);

alter table public.tournament_snapshots enable row level security;

drop policy if exists "tournament_snapshots: managers read" on public.tournament_snapshots;
create policy "tournament_snapshots: managers read" on public.tournament_snapshots
  for select to authenticated
  using (public.is_tournament_manager(tournament_id));
-- No insert/update/delete policies: written only by the definer functions below.

-- A "played" game: a real result, not an auto-resolved bye. Ties (round robin
-- with allow_ties) have no winner but are complete with scores.
create or replace function public._tournament_match_is_played(m public.tournament_matches)
returns boolean language sql immutable set search_path = '' as $$
  select m.slot1_entrant_id is not null and m.slot2_entrant_id is not null
     and (m.winner_entrant_id is not null
          or (m.status = 'complete' and m.slot1_score is not null and m.slot2_score is not null));
$$;
revoke all on function public._tournament_match_is_played(public.tournament_matches) from public, anon, authenticated;

create or replace function public._tournament_played_count(p_tournament uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tournament_matches m
   where m.tournament_id = p_tournament and public._tournament_match_is_played(m);
$$;
revoke all on function public._tournament_played_count(uuid) from public, anon, authenticated;

-- Write a full copy of one tournament. Returns null when there is nothing worth
-- keeping (no matches yet), so setup-time churn does not pile up snapshots.
create or replace function public._tournament_snapshot(p_tournament uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_id uuid;
begin
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then return null; end if;
  if not exists (select 1 from public.tournament_matches where tournament_id = p_tournament) then
    return null;
  end if;
  insert into public.tournament_snapshots
    (tournament_id, private_activity_id, schedule_item_id, reason, taken_by, played_matches, data)
  values (
    p_tournament, v_t.private_activity_id, v_t.schedule_item_id, p_reason, auth.uid(),
    public._tournament_played_count(p_tournament),
    jsonb_build_object(
      'tournament',   to_jsonb(v_t),
      'entrants',     coalesce((select jsonb_agg(to_jsonb(e)) from public.tournament_entrants e
                                 where e.tournament_id = p_tournament), '[]'::jsonb),
      'participants', coalesce((select jsonb_agg(to_jsonb(p)) from public.tournament_participants p
                                 where p.tournament_id = p_tournament), '[]'::jsonb),
      'matches',      coalesce((select jsonb_agg(to_jsonb(m)) from public.tournament_matches m
                                 where m.tournament_id = p_tournament), '[]'::jsonb)
    )
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public._tournament_snapshot(uuid, text) from public, anon, authenticated;

-- ── Move the existing functions aside (once) ────────────────────────────────
-- Guarded with to_regprocedure so re-running this file never renames a wrapper.
do $$
begin
  if to_regprocedure('public._generate_bracket_unguarded(uuid, uuid[])') is null then
    alter function public.generate_bracket(uuid, uuid[]) rename to _generate_bracket_unguarded;
  end if;
  if to_regprocedure('public._generate_round_robin_unguarded(uuid, uuid[])') is null then
    alter function public.generate_round_robin(uuid, uuid[]) rename to _generate_round_robin_unguarded;
  end if;
  if to_regprocedure('public._generate_pools_unguarded(uuid, int, int, uuid[])') is null then
    alter function public.generate_pools(uuid, int, int, uuid[]) rename to _generate_pools_unguarded;
  end if;
  if to_regprocedure('public._generate_bracket_from_pools_unguarded(uuid)') is null then
    alter function public.generate_bracket_from_pools(uuid) rename to _generate_bracket_from_pools_unguarded;
  end if;
  if to_regprocedure('public._reset_bracket_unguarded(uuid)') is null then
    alter function public.reset_bracket(uuid) rename to _reset_bracket_unguarded;
  end if;
  if to_regprocedure('public._set_match_entrant_unguarded(uuid, int, uuid)') is null then
    alter function public.set_match_entrant(uuid, int, uuid) rename to _set_match_entrant_unguarded;
  end if;
  if to_regprocedure('public._delete_tournament_unguarded(uuid)') is null then
    alter function public.delete_tournament(uuid) rename to _delete_tournament_unguarded;
  end if;
  if to_regprocedure('public._delete_private_activity_unguarded(uuid)') is null then
    alter function public.delete_private_activity(uuid) rename to _delete_private_activity_unguarded;
  end if;
end $$;

-- The old swap called set_match_entrant by name; it is replaced outright below.
drop function if exists public.swap_match_entrants(uuid, int, uuid, int);

revoke all on function public._generate_bracket_unguarded(uuid, uuid[])            from public, anon, authenticated;
revoke all on function public._generate_round_robin_unguarded(uuid, uuid[])        from public, anon, authenticated;
revoke all on function public._generate_pools_unguarded(uuid, int, int, uuid[])    from public, anon, authenticated;
revoke all on function public._generate_bracket_from_pools_unguarded(uuid)         from public, anon, authenticated;
revoke all on function public._reset_bracket_unguarded(uuid)                       from public, anon, authenticated;
revoke all on function public._set_match_entrant_unguarded(uuid, int, uuid)        from public, anon, authenticated;
revoke all on function public._delete_tournament_unguarded(uuid)                   from public, anon, authenticated;
revoke all on function public._delete_private_activity_unguarded(uuid)             from public, anon, authenticated;

-- Shared refusal for "generate" once play has begun. Authorization is checked
-- first so a non-manager learns nothing about the tournament's state.
create or replace function public._tournament_require_setup(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select status into v_status from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_status <> 'setup' then
    raise exception 'This tournament has already started, so the bracket can''t be generated again. To start over on purpose, use "Start over" — it asks first and keeps a copy.'
      using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public._tournament_require_setup(uuid) from public, anon, authenticated;

-- ── 1. Generate: setup only ─────────────────────────────────────────────────
create or replace function public.generate_bracket(p_tournament uuid, p_seed_order uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._tournament_require_setup(p_tournament);
  perform public._generate_bracket_unguarded(p_tournament, p_seed_order);
end;
$$;
revoke all on function public.generate_bracket(uuid, uuid[]) from public, anon;
grant execute on function public.generate_bracket(uuid, uuid[]) to authenticated;

create or replace function public.generate_round_robin(p_tournament uuid, p_seed_order uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._tournament_require_setup(p_tournament);
  perform public._generate_round_robin_unguarded(p_tournament, p_seed_order);
end;
$$;
revoke all on function public.generate_round_robin(uuid, uuid[]) from public, anon;
grant execute on function public.generate_round_robin(uuid, uuid[]) to authenticated;

create or replace function public.generate_pools(
  p_tournament uuid, p_pool_count int default 2, p_advance int default 1, p_seed_order uuid[] default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._tournament_require_setup(p_tournament);
  perform public._generate_pools_unguarded(p_tournament, p_pool_count, p_advance, p_seed_order);
end;
$$;
revoke all on function public.generate_pools(uuid, int, int, uuid[]) from public, anon;
grant execute on function public.generate_pools(uuid, int, int, uuid[]) to authenticated;

-- ── 2. Knockout from pools: never over a knockout that has results ──────────
create or replace function public.generate_bracket_from_pools(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament) then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if exists (select 1 from public.tournament_matches m
              where m.tournament_id = p_tournament and m.stage = 'bracket'
                and public._tournament_match_is_played(m)) then
    raise exception 'The knockout bracket already has results, so it can''t be generated again.';
  end if;
  perform public._generate_bracket_from_pools_unguarded(p_tournament);
end;
$$;
revoke all on function public.generate_bracket_from_pools(uuid) from public, anon;
grant execute on function public.generate_bracket_from_pools(uuid) to authenticated;

-- ── 3a. Start over: explicit confirm once anything has been played ──────────
create or replace function public.reset_bracket(p_tournament uuid, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_played int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament) then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));
  v_played := public._tournament_played_count(p_tournament);
  if v_played > 0 and not coalesce(p_confirm, false) then
    raise exception 'This tournament has % recorded result(s). Starting over erases them — confirm to continue.', v_played;
  end if;
  perform public._tournament_snapshot(p_tournament, 'start over');
  perform public._reset_bracket_unguarded(p_tournament);
end;
$$;
revoke all on function public.reset_bracket(uuid, boolean) from public, anon;
grant execute on function public.reset_bracket(uuid, boolean) to authenticated;

-- ── 3b. Rearranging: free before a game is played, forced (and saved) after ─
-- Changing who is in a slot clears that game's result and everything decided
-- downstream of it. That is fine while fixing a fresh bracket and destructive
-- once games have been played.
create or replace function public._tournament_slot_change_destroys(p_match uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare m public.tournament_matches; n public.tournament_matches;
begin
  select * into m from public.tournament_matches where id = p_match;
  if not found then return false; end if;
  if public._tournament_match_is_played(m) then return true; end if;
  -- A bye already advanced its entrant; moving them is destructive only if the
  -- game they advanced into has been played.
  if m.winner_entrant_id is not null and m.next_match_id is not null then
    select * into n from public.tournament_matches where id = m.next_match_id;
    if found and public._tournament_match_is_played(n) then return true; end if;
  end if;
  return false;
end;
$$;
revoke all on function public._tournament_slot_change_destroys(uuid) from public, anon, authenticated;

create or replace function public.set_match_entrant(
  p_match uuid, p_slot int, p_entrant_id uuid, p_force boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select tournament_id into v_t from public.tournament_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(v_t) then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_t::text, 0));
  if public._tournament_slot_change_destroys(p_match) then
    if not coalesce(p_force, false) then
      raise exception 'That game already has a result. Moving a player would erase it and every game decided after it.';
    end if;
    perform public._tournament_snapshot(v_t, 'rearranged after results');
  end if;
  perform public._set_match_entrant_unguarded(p_match, p_slot, p_entrant_id);
end;
$$;
revoke all on function public.set_match_entrant(uuid, int, uuid, boolean) from public, anon;
grant execute on function public.set_match_entrant(uuid, int, uuid, boolean) to authenticated;

create or replace function public.swap_match_entrants(
  p_match_a uuid, p_slot_a int, p_match_b uuid, p_slot_b int, p_force boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare a public.tournament_matches; b public.tournament_matches; ea uuid; eb uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_slot_a not in (1, 2) or p_slot_b not in (1, 2) then raise exception 'Invalid slot'; end if;
  select * into a from public.tournament_matches where id = p_match_a;
  select * into b from public.tournament_matches where id = p_match_b;
  if a.id is null or b.id is null then raise exception 'Match not found'; end if;
  if a.tournament_id <> b.tournament_id then raise exception 'Matches must be in the same tournament'; end if;
  if not public.is_tournament_manager(a.tournament_id) then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.tournament_id::text, 0));
  if public._tournament_slot_change_destroys(p_match_a) or public._tournament_slot_change_destroys(p_match_b) then
    if not coalesce(p_force, false) then
      raise exception 'One of those games already has a result. Swapping would erase it and every game decided after it.';
    end if;
    perform public._tournament_snapshot(a.tournament_id, 'rearranged after results');
  end if;
  ea := case when p_slot_a = 1 then a.slot1_entrant_id else a.slot2_entrant_id end;
  eb := case when p_slot_b = 1 then b.slot1_entrant_id else b.slot2_entrant_id end;
  perform public._set_match_entrant_unguarded(p_match_a, p_slot_a, eb);
  perform public._set_match_entrant_unguarded(p_match_b, p_slot_b, ea);
end;
$$;
revoke all on function public.swap_match_entrants(uuid, int, uuid, int, boolean) from public, anon;
grant execute on function public.swap_match_entrants(uuid, int, uuid, int, boolean) to authenticated;

-- ── 4. Deletes keep a copy ──────────────────────────────────────────────────
-- If the inner function refuses (not authorized), the whole call rolls back
-- and the snapshot goes with it.
create or replace function public.delete_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._tournament_snapshot(p_tournament, 'tournament deleted');
  perform public._delete_tournament_unguarded(p_tournament);
end;
$$;
revoke all on function public.delete_tournament(uuid) from public, anon;
grant execute on function public.delete_tournament(uuid) to authenticated;

create or replace function public.delete_private_activity(p_activity uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  for t in select id from public.tournaments where private_activity_id = p_activity loop
    perform public._tournament_snapshot(t.id, 'game deleted');
  end loop;
  perform public._delete_private_activity_unguarded(p_activity);
end;
$$;
revoke all on function public.delete_private_activity(uuid) from public, anon;
grant execute on function public.delete_private_activity(uuid) to authenticated;

-- ── 5. A cleared final un-completes the tournament ──────────────────────────
-- _tournament_advance clears downstream results but never touched the
-- tournaments row, so a cascade that reached the final left status='complete'
-- and the old champion on screen.
create or replace function public._tournament_final_cleared()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.winner_entrant_id is not null and new.winner_entrant_id is null
     and new.stage = 'bracket' and new.next_match_id is null and not new.is_play_in then
    update public.tournaments
       set status = 'live', winner_entrant_id = null
     where id = new.tournament_id and status = 'complete'
       and format in ('single_elim', 'pools_bracket');
  end if;
  return new;
end;
$$;
revoke all on function public._tournament_final_cleared() from public, anon, authenticated;

drop trigger if exists tournament_final_cleared on public.tournament_matches;
create trigger tournament_final_cleared
  after update of winner_entrant_id on public.tournament_matches
  for each row execute function public._tournament_final_cleared();

-- ── 6. Put a snapshot back ──────────────────────────────────────────────────
-- Restores entrants, people and every game exactly as they were. The current
-- state is snapshotted first, so a restore can itself be undone. Only for a
-- tournament that still exists (a deleted one stays in the table for manual
-- recovery).
create or replace function public.restore_tournament_snapshot(p_snapshot uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.tournament_snapshots; v_t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into s from public.tournament_snapshots where id = p_snapshot;
  if not found then raise exception 'Saved copy not found'; end if;
  v_t := s.tournament_id;
  if not exists (select 1 from public.tournaments where id = v_t) then
    raise exception 'That tournament was deleted, so it can''t be restored here.';
  end if;
  if not public.is_tournament_manager(v_t) then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_t::text, 0));

  perform public._tournament_snapshot(v_t, 'before restore');

  update public.tournaments set winner_entrant_id = null where id = v_t;
  delete from public.tournament_matches      where tournament_id = v_t;
  delete from public.tournament_participants where tournament_id = v_t;
  delete from public.tournament_entrants     where tournament_id = v_t;

  insert into public.tournament_entrants
    select * from jsonb_populate_recordset(null::public.tournament_entrants, s.data -> 'entrants');
  insert into public.tournament_participants
    select * from jsonb_populate_recordset(null::public.tournament_participants, s.data -> 'participants');
  -- One statement, so the self-referencing next_match_id is satisfied at its end.
  insert into public.tournament_matches
    select * from jsonb_populate_recordset(null::public.tournament_matches, s.data -> 'matches');

  update public.tournaments t set
      status            = (s.data -> 'tournament' ->> 'status'),
      format            = (s.data -> 'tournament' ->> 'format'),
      pool_count        = (s.data -> 'tournament' ->> 'pool_count')::int,
      advance_per_pool  = (s.data -> 'tournament' ->> 'advance_per_pool')::int,
      winner_entrant_id = (s.data -> 'tournament' ->> 'winner_entrant_id')::uuid
    where t.id = v_t;
end;
$$;
revoke all on function public.restore_tournament_snapshot(uuid) from public, anon;
grant execute on function public.restore_tournament_snapshot(uuid) to authenticated;

-- New/renamed functions: have PostgREST pick them up straight away.
notify pgrst, 'reload schema';

commit;
