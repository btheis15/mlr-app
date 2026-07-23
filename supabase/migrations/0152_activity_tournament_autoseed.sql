-- 0152_activity_tournament_autoseed.sql
--
-- For a PRIVATE ACTIVITY the "Who's in" roster IS the player list — a host
-- shouldn't have to separately "import" them into the tournament. So
-- create_activity_tournament now seeds the tournament's people straight from the
-- activity's members on creation (into the pool, exactly like the manual import;
-- "Generate" then promotes each to a bracket entrant). Still idempotent + capped
-- at one tournament per activity (migration 0151).

create or replace function public.create_activity_tournament(
  p_activity     uuid,
  p_title        text,
  p_format       text default 'single_elim',
  p_entrant_type text default 'individual',
  p_team_size    int  default null,
  p_bye_strategy text default 'byes'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text; v_existing uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;

  -- Already has one → return it (idempotent; never a duplicate).
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

  -- Auto-seed the players from the activity roster (into the pool). Individuals →
  -- generate_bracket promotes each to a solo entrant; teams → the host taps
  -- "Auto-make teams" to pair the pool up first.
  insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
  select v_id, null, m.user_id, m.name, row_number() over (order by m.created_at)
  from public.private_activity_members m
  where m.activity_id = p_activity;

  return v_id;
end;
$$;
revoke all on function public.create_activity_tournament(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.create_activity_tournament(uuid, text, text, text, int, text) to authenticated;
