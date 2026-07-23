-- 0153_activity_individual_entrants.sql
--
-- For a private-activity tournament, seed INDIVIDUALS as real entrants right away
-- (not the pre-team "pool"), so the setup sheet's "Seed order — top seeds first"
-- list shows them with reorder controls: auto-seeded → you can confirm/adjust the
-- seeding → Generate, and that's the only step. (Teams still land in the pool so
-- the host can "Auto-make teams" first.) generate_bracket seeds the existing
-- entrants (its pool-promotion loop simply finds nothing to promote).

-- create_activity_tournament: auto-seed on creation (individuals → entrants).
create or replace function public.create_activity_tournament(
  p_activity     uuid,
  p_title        text,
  p_format       text default 'single_elim',
  p_entrant_type text default 'individual',
  p_team_size    int  default null,
  p_bye_strategy text default 'byes'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text; v_existing uuid; rec record; v_ent uuid; v_pos int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;

  select id into v_existing from public.tournaments where private_activity_id = p_activity limit 1;
  if v_existing is not null then return v_existing; end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if p_format not in ('single_elim', 'round_robin', 'pools_bracket') then raise exception 'Unknown format'; end if;
  if p_entrant_type not in ('individual', 'team') then raise exception 'Unknown entrant type'; end if;
  if p_bye_strategy not in ('byes', 'play_in') then raise exception 'Unknown bye strategy'; end if;

  update public.private_activities set tournament_enabled = true where id = p_activity;

  insert into public.tournaments (private_activity_id, title, format, entrant_type, team_size, bye_strategy, created_by)
  values (p_activity, v_title, p_format,
          p_entrant_type,
          case when p_entrant_type = 'team' then greatest(coalesce(p_team_size, 2), 2) else null end,
          p_bye_strategy, auth.uid())
  returning id into v_id;

  perform public._seed_activity_tournament(v_id, p_activity, p_entrant_type);
  return v_id;
end;
$$;
revoke all on function public.create_activity_tournament(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.create_activity_tournament(uuid, text, text, text, int, text) to authenticated;

-- Shared seeding helper: individuals → one entrant each (orderable); teams → pool.
create or replace function public._seed_activity_tournament(p_tournament uuid, p_activity uuid, p_entrant_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare rec record; v_ent uuid; v_pos int := 0;
begin
  if p_entrant_type = 'individual' then
    for rec in
      select user_id, name from public.private_activity_members
      where activity_id = p_activity order by created_at
    loop
      insert into public.tournament_entrants (tournament_id, display_name, position)
      values (p_tournament, rec.name, v_pos) returning id into v_ent;
      insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
      values (p_tournament, v_ent, rec.user_id, rec.name, 0);
      v_pos := v_pos + 1;
    end loop;
  else
    insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
    select p_tournament, null, m.user_id, m.name, row_number() over (order by m.created_at)
    from public.private_activity_members m
    where m.activity_id = p_activity;
  end if;
end;
$$;
revoke all on function public._seed_activity_tournament(uuid, uuid, text) from public, anon, authenticated;

-- Re-sync ("↻ Re-sync players from activity"): replace the roster, same shape.
create or replace function public.import_entrants_from_activity_members(p_tournament uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_count int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.private_activity_id is null then raise exception 'Not a private-activity tournament'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket before re-importing'; end if;

  delete from public.tournament_participants where tournament_id = p_tournament;
  delete from public.tournament_entrants where tournament_id = p_tournament;

  perform public._seed_activity_tournament(p_tournament, v_t.private_activity_id, v_t.entrant_type);

  select count(*) into v_count from public.private_activity_members where activity_id = v_t.private_activity_id;
  return v_count;
end;
$$;
revoke all on function public.import_entrants_from_activity_members(uuid) from public, anon;
grant execute on function public.import_entrants_from_activity_members(uuid) to authenticated;
