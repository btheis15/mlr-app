-- 0146_tournament_pools.sql
-- Phase C of tournament brackets (0144/0145): the POOLS → BRACKET format. Entrants
-- are split into pools that each play a round-robin; the top N of each pool then
-- advance to a seeded single-elimination knockout (cross-seeded so pool winners
-- can't meet until late). Reuses the same four tables and the format-aware
-- record_match_result from 0145 (a pool-stage game — stage='pool' — records with
-- no propagation; the knockout crowns the champion like single_elim).
--
-- Two RPCs: generate_pools (build the group stage) and generate_bracket_from_pools
-- (once every pool game is done, seed the knockout). Plus an internal
-- _tournament_build_bracket helper shared by the knockout builder.
--
-- Apply in the Supabase SQL editor after 0145.

-- ── Internal: build a single-elim bracket among an ordered id list ───────────
-- p_ids[1] = top seed. Deletes existing BRACKET-stage matches only (pool-stage
-- rows are preserved), then fold-seeds, wires next_match pointers, seats round 1,
-- and auto-resolves byes — the same construction generate_bracket (0144) does
-- inline, factored so the pools knockout can reuse it.
create or replace function public._tournament_build_bracket(p_t uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bye text; v_n int; v_b int; v_r int; v_tmp int; v_order int[]; v_has_byes boolean;
  i int; cnt int; r int; s1 int; s2 int; e1 uuid; e2 uuid; m record; v_winner uuid;
begin
  v_n := coalesce(array_length(p_ids, 1), 0);
  if v_n < 2 then raise exception 'Need at least two entrants for a bracket'; end if;
  select bye_strategy into v_bye from public.tournaments where id = p_t;

  v_b := 1; while v_b < v_n loop v_b := v_b * 2; end loop;
  v_r := 0; v_tmp := v_b; while v_tmp > 1 loop v_tmp := v_tmp / 2; v_r := v_r + 1; end loop;
  v_has_byes := (v_b > v_n);

  delete from public.tournament_matches where tournament_id = p_t and stage = 'bracket';

  for r in 1 .. v_r loop
    cnt := v_b >> r;
    for i in 0 .. cnt - 1 loop
      insert into public.tournament_matches (tournament_id, stage, round, position, status)
      values (p_t, 'bracket', r, i, 'pending');
    end loop;
  end loop;

  update public.tournament_matches child
    set next_match_id = parent.id,
        next_slot = case when child.position % 2 = 0 then 1 else 2 end
    from public.tournament_matches parent
    where child.tournament_id = p_t and parent.tournament_id = p_t
      and child.stage = 'bracket' and parent.stage = 'bracket'
      and child.round < v_r and parent.round = child.round + 1
      and parent.position = child.position / 2;

  v_order := public._tournament_seed_order(v_b);
  for i in 0 .. (v_b / 2) - 1 loop
    s1 := v_order[2 * i + 1];
    s2 := v_order[2 * i + 2];
    e1 := case when s1 <= v_n then p_ids[s1] end;
    e2 := case when s2 <= v_n then p_ids[s2] end;
    update public.tournament_matches
      set slot1_entrant_id = e1, slot2_entrant_id = e2,
          is_play_in = (v_bye = 'play_in' and v_has_byes and e1 is not null and e2 is not null),
          status = case when e1 is not null and e2 is not null then 'ready' else 'pending' end
      where tournament_id = p_t and stage = 'bracket' and round = 1 and position = i;
  end loop;

  for m in select * from public.tournament_matches
           where tournament_id = p_t and stage = 'bracket' and round = 1
             and ((slot1_entrant_id is null) <> (slot2_entrant_id is null)) loop
    v_winner := coalesce(m.slot1_entrant_id, m.slot2_entrant_id);
    update public.tournament_matches set winner_entrant_id = v_winner, status = 'complete' where id = m.id;
    perform public._tournament_advance(m.next_match_id, m.next_slot, null, v_winner);
  end loop;
end;
$$;
revoke all on function public._tournament_build_bracket(uuid, uuid[]) from public, anon, authenticated;

-- ── Group stage ──────────────────────────────────────────────────────────────
-- Split entrants into p_pool_count pools (snaked by seed for balance), each a
-- round-robin. Stores the pool config on the tournament.
create or replace function public.generate_pools(
  p_tournament uuid, p_pool_count int default 2, p_advance int default 1, p_seed_order uuid[] default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tournaments; v_n int; p record; e1 uuid; v_pc int; v_adv int;
  v_pool_ids uuid[]; v_label text; v_m int; rd int; i int; a uuid; b uuid; tmp uuid; v_pos int; pi int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.format <> 'pools_bracket' then raise exception 'This tournament isn''t a pools → bracket'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));

  v_pc := greatest(coalesce(p_pool_count, 2), 2);
  v_adv := greatest(coalesce(p_advance, 1), 1);

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
  if v_n < v_pc * 2 then raise exception 'Need at least % entrants for % pools', v_pc * 2, v_pc; end if;
  if v_adv * v_pc < 2 then raise exception 'At least 2 entrants must advance overall'; end if;

  -- Seed, then snake entrants across pools (seed 1→A, 2→B, …, wrapping).
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

  update public.tournament_entrants
    set pool = chr(65 + ((seed - 1) % v_pc))
    where tournament_id = p_tournament and seed is not null;

  update public.tournaments set pool_count = v_pc, advance_per_pool = v_adv where id = p_tournament;
  delete from public.tournament_matches where tournament_id = p_tournament;

  -- Round-robin within each pool (circle method), stage='pool'.
  for pi in 0 .. v_pc - 1 loop
    v_label := chr(65 + pi);
    select array_agg(id order by seed) into v_pool_ids
      from public.tournament_entrants
      where tournament_id = p_tournament and pool = v_label and withdrawn_at is null;
    if v_pool_ids is null then continue; end if;
    v_m := array_length(v_pool_ids, 1);
    if v_m % 2 = 1 then v_pool_ids := v_pool_ids || null::uuid; v_m := v_m + 1; end if;
    for rd in 1 .. v_m - 1 loop
      v_pos := 0;
      for i in 1 .. v_m / 2 loop
        a := v_pool_ids[i]; b := v_pool_ids[v_m + 1 - i];
        if a is not null and b is not null then
          insert into public.tournament_matches (tournament_id, stage, pool, round, position, slot1_entrant_id, slot2_entrant_id, status)
          values (p_tournament, 'pool', v_label, rd, v_pos, a, b, 'ready');
          v_pos := v_pos + 1;
        end if;
      end loop;
      tmp := v_pool_ids[v_m];
      for i in reverse v_m .. 3 loop v_pool_ids[i] := v_pool_ids[i - 1]; end loop;
      v_pool_ids[2] := tmp;
    end loop;
  end loop;

  update public.tournaments set status = 'live', winner_entrant_id = null where id = p_tournament;
  perform public._notify_tournament_all(p_tournament, 'tournament_published',
    'Pools are live: ' || v_t.title, 'Group play has started — check the pool standings!');
end;
$$;
revoke all on function public.generate_pools(uuid, int, int, uuid[]) from public, anon;
grant execute on function public.generate_pools(uuid, int, int, uuid[]) to authenticated;

-- ── Knockout from pools ──────────────────────────────────────────────────────
-- Once every pool game is complete, take the top advance_per_pool of each pool
-- and seed them into a single-elim bracket with cross-seeding: global seed =
-- (pool_rank-1)*pool_count + pool_index + 1, so pool winners land on opposite
-- ends and same-pool rematches are pushed as late as possible.
create or replace function public.generate_bracket_from_pools(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_remaining int; v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.format <> 'pools_bracket' then raise exception 'This tournament isn''t a pools → bracket'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));

  select count(*) into v_remaining from public.tournament_matches
    where tournament_id = p_tournament and stage = 'pool' and status <> 'complete';
  if v_remaining > 0 then raise exception 'Finish every pool game first (% left)', v_remaining; end if;

  -- Rank within each pool, keep the top advance_per_pool, order by cross-seed.
  with ranked as (
    select e.id, e.pool,
      row_number() over (
        partition by e.pool order by
          sum(case when tm.winner_entrant_id = e.id then 1 else 0 end) desc,
          sum(case when e.id = tm.slot1_entrant_id then coalesce(tm.slot1_score,0) - coalesce(tm.slot2_score,0)
                   when e.id = tm.slot2_entrant_id then coalesce(tm.slot2_score,0) - coalesce(tm.slot1_score,0)
                   else 0 end) desc,
          sum(case when e.id = tm.slot1_entrant_id then coalesce(tm.slot1_score,0)
                   when e.id = tm.slot2_entrant_id then coalesce(tm.slot2_score,0) else 0 end) desc,
          e.seed
      ) as pool_rank
    from public.tournament_entrants e
    left join public.tournament_matches tm
      on tm.tournament_id = e.tournament_id and tm.stage = 'pool' and tm.status = 'complete'
      and (e.id = tm.slot1_entrant_id or e.id = tm.slot2_entrant_id)
    where e.tournament_id = p_tournament and e.pool is not null and e.withdrawn_at is null
    group by e.id, e.pool, e.seed
  )
  select array_agg(id order by (pool_rank - 1) * coalesce(v_t.pool_count, 2) + (ascii(pool) - 65) + 1) into v_ids
  from ranked
  where pool_rank <= coalesce(v_t.advance_per_pool, 1);

  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'Not enough qualifiers'; end if;

  perform public._tournament_build_bracket(p_tournament, v_ids);
  update public.tournaments set status = 'live' where id = p_tournament;
  perform public._notify_tournament_all(p_tournament, 'tournament_match_ready',
    'Knockout bracket is set: ' || v_t.title, 'Pool play is done — the bracket is live.');
end;
$$;
revoke all on function public.generate_bracket_from_pools(uuid) from public, anon;
grant execute on function public.generate_bracket_from_pools(uuid) to authenticated;
