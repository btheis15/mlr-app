-- 0145_tournament_round_robin.sql
-- Phase B of tournament brackets (0144): the ROUND-ROBIN format — everyone plays
-- everyone once, ranked by a standings table (wins, then the configured
-- tiebreakers). Reuses the same four tables; adds one generation RPC and makes
-- record_match_result FORMAT-AWARE so a round-robin game (which has no
-- next_match_id) isn't mistaken for a single-elim final.
--
-- Standings themselves are computed CLIENT-SIDE (lib/tournaments.ts
-- computeStandings) with the tournament's ordered `tiebreakers`; the server only
-- stamps a best-effort leader (wins → point differential → points-for) as the
-- champion when every game is complete, for the notification + the winner banner.
--
-- Apply in the Supabase SQL editor after 0144.

-- ── Round-robin generation (circle method) ───────────────────────────────────
-- Every entrant plays every other once. The circle method schedules them into
-- balanced "rounds" (each entrant plays at most once per round) purely for nicer
-- display; standings don't depend on the round numbers. An odd count gets a
-- phantom "bye" slot each round (that pairing is simply not created).
create or replace function public.generate_round_robin(p_tournament uuid, p_seed_order uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tournaments; v_n int; p record; e1 uuid;
  v_ids uuid[]; v_m int; rd int; i int; a uuid; b uuid; tmp uuid; v_pos int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.format <> 'round_robin' then raise exception 'This tournament isn''t a round-robin'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));

  -- Individual format: make one solo entrant per pool participant (same as 0144).
  if v_t.entrant_type = 'individual' then
    for p in select * from public.tournament_participants
             where tournament_id = p_tournament and entrant_id is null loop
      insert into public.tournament_entrants (tournament_id, display_name, position)
      values (p_tournament, p.name, p.position) returning id into e1;
      update public.tournament_participants set entrant_id = e1 where id = p.id;
    end loop;
  end if;

  select count(*) into v_n from public.tournament_entrants
   where tournament_id = p_tournament and withdrawn_at is null;
  if v_n < 2 then raise exception 'Need at least two entrants'; end if;

  -- Seed (drives the standings display order tiebreak + explicit arrangement).
  if p_seed_order is not null and array_length(p_seed_order, 1) = v_n then
    for i in 1 .. v_n loop
      update public.tournament_entrants set seed = i where id = p_seed_order[i] and tournament_id = p_tournament;
    end loop;
  else
    with ord as (
      select id, row_number() over (order by random()) as rn
      from public.tournament_entrants where tournament_id = p_tournament and withdrawn_at is null
    )
    update public.tournament_entrants e set seed = ord.rn from ord where e.id = ord.id;
  end if;

  delete from public.tournament_matches where tournament_id = p_tournament;

  -- Build the rotating array (append a NULL phantom if odd).
  select array_agg(id order by seed) into v_ids
    from public.tournament_entrants where tournament_id = p_tournament and withdrawn_at is null;
  v_m := v_n;
  if v_m % 2 = 1 then v_ids := v_ids || null::uuid; v_m := v_m + 1; end if;

  for rd in 1 .. v_m - 1 loop
    v_pos := 0;
    for i in 1 .. v_m / 2 loop
      a := v_ids[i];
      b := v_ids[v_m + 1 - i];
      if a is not null and b is not null then
        insert into public.tournament_matches (tournament_id, stage, round, position, slot1_entrant_id, slot2_entrant_id, status)
        values (p_tournament, 'bracket', rd, v_pos, a, b, 'ready');
        v_pos := v_pos + 1;
      end if;
    end loop;
    -- Rotate: keep index 1 fixed, move the last into slot 2, shift the rest right.
    tmp := v_ids[v_m];
    for i in reverse v_m .. 3 loop v_ids[i] := v_ids[i - 1]; end loop;
    v_ids[2] := tmp;
  end loop;

  update public.tournaments set status = 'live', winner_entrant_id = null where id = p_tournament;
  perform public._notify_tournament_all(p_tournament, 'tournament_published',
    'Round-robin is live: ' || v_t.title, 'Every team plays every other — check the standings!');
end;
$$;
revoke all on function public.generate_round_robin(uuid, uuid[]) from public, anon;
grant execute on function public.generate_round_robin(uuid, uuid[]) to authenticated;

-- ── Format-aware result recording (replaces the 0144 version) ────────────────
-- Winner required, scores optional (unchanged). Propagation now branches:
--  • a match WITH next_match_id  → advance the winner (single-elim / pools knockout);
--  • a bracket-stage match with NO next pointer, single_elim/pools_bracket
--        → the FINAL: crown the champion;
--  • otherwise (round_robin, or a pool-stage game) → just record it; for a
--        round-robin, once every game is complete, crown the standings leader.
create or replace function public.record_match_result(
  p_match uuid, p_winner uuid default null, p_score1 int default null, p_score2 int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches; v_t public.tournaments; v_winner uuid; v_old uuid; d public.tournament_matches;
        v_name text; v_remaining int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.tournament_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(m.tournament_id) then raise exception 'Not authorized'; end if;
  select * into v_t from public.tournaments where id = m.tournament_id;
  perform pg_advisory_xact_lock(hashtextextended(m.tournament_id::text, 0));

  if m.slot1_entrant_id is null or m.slot2_entrant_id is null then
    raise exception 'Both sides must be set before recording a result';
  end if;

  if p_winner is not null then
    if p_winner not in (m.slot1_entrant_id, m.slot2_entrant_id) then
      raise exception 'The winner must be one of the two entrants';
    end if;
    v_winner := p_winner;
  elsif p_score1 is not null and p_score2 is not null then
    if p_score1 = p_score2 then
      if not v_t.allow_ties then raise exception 'Pick a winner (the score is tied)'; end if;
      v_winner := null; -- a recorded tie (round-robin only)
    else
      v_winner := case when p_score1 > p_score2 then m.slot1_entrant_id else m.slot2_entrant_id end;
    end if;
  else
    raise exception 'Pick a winner';
  end if;

  -- A tie is only meaningful in round-robin; a bracket match must resolve.
  if v_winner is null and (m.next_match_id is not null or v_t.format in ('single_elim', 'pools_bracket')) then
    raise exception 'Pick a winner (a bracket game can''t end tied)';
  end if;

  v_old := m.winner_entrant_id;
  update public.tournament_matches
    set slot1_score = p_score1, slot2_score = p_score2, winner_entrant_id = v_winner, status = 'complete'
    where id = m.id;

  if m.next_match_id is not null then
    -- Knockout progression.
    if v_old is distinct from v_winner then
      perform public._tournament_advance(m.next_match_id, m.next_slot, v_old, v_winner);
    end if;
    select * into d from public.tournament_matches where id = m.next_match_id;
    if d.status = 'ready' and not d.ready_notified then
      update public.tournament_matches set ready_notified = true where id = d.id;
      perform public._notify_tournament_match(d.id, 'tournament_match_ready',
        'Your next match is ready', 'Your next game is set — check the bracket.');
    end if;
  elsif m.stage = 'bracket' and v_t.format in ('single_elim', 'pools_bracket') then
    -- The final.
    update public.tournaments set winner_entrant_id = v_winner, status = 'complete' where id = m.tournament_id;
    select display_name into v_name from public.tournament_entrants where id = v_winner;
    perform public._notify_tournament_all(m.tournament_id, 'tournament_champion',
      '🏆 We have a champion!', coalesce(v_name, 'The winner') || ' won ' || v_t.title || '!');
  elsif v_t.format = 'round_robin' then
    -- No propagation. Crown the standings leader once every game is complete.
    select count(*) into v_remaining from public.tournament_matches
      where tournament_id = m.tournament_id and status <> 'complete';
    if v_remaining = 0 then
      select e.id into v_winner
      from public.tournament_entrants e
      left join public.tournament_matches tm
        on tm.tournament_id = e.tournament_id and tm.status = 'complete'
        and (e.id = tm.slot1_entrant_id or e.id = tm.slot2_entrant_id)
      where e.tournament_id = m.tournament_id and e.withdrawn_at is null
      group by e.id
      order by
        sum(case when tm.winner_entrant_id = e.id then 1 else 0 end) desc,
        sum(case when e.id = tm.slot1_entrant_id then coalesce(tm.slot1_score, 0) - coalesce(tm.slot2_score, 0)
                 when e.id = tm.slot2_entrant_id then coalesce(tm.slot2_score, 0) - coalesce(tm.slot1_score, 0)
                 else 0 end) desc,
        sum(case when e.id = tm.slot1_entrant_id then coalesce(tm.slot1_score, 0)
                 when e.id = tm.slot2_entrant_id then coalesce(tm.slot2_score, 0) else 0 end) desc,
        min(e.seed)
      limit 1;
      update public.tournaments set winner_entrant_id = v_winner, status = 'complete' where id = m.tournament_id;
      select display_name into v_name from public.tournament_entrants where id = v_winner;
      perform public._notify_tournament_all(m.tournament_id, 'tournament_champion',
        '🏆 We have a champion!', coalesce(v_name, 'The winner') || ' topped ' || v_t.title || '!');
    end if;
  end if;
end;
$$;
revoke all on function public.record_match_result(uuid, uuid, int, int) from public, anon;
grant execute on function public.record_match_result(uuid, uuid, int, int) to authenticated;
