-- 0151_one_tournament_per_activity.sql
--
-- A private activity may have AT MOST ONE tournament. A client display hiccup let
-- repeated "Create tournament" taps stack up duplicate rows (nothing rendered, so
-- the "Set up a tournament" button kept reappearing and each tap inserted again).
-- Two guards:
--   1) a partial unique index so the DB refuses a second tournament per activity;
--   2) create_activity_tournament is now IDEMPOTENT — if the activity already has
--      a tournament it returns that one instead of inserting, so a re-tap can never
--      pile up and always lands you on the existing tournament.

-- Collapse any existing duplicates (keep the earliest per activity; the extras are
-- empty setup-state rows). Safe if there are none.
delete from public.tournaments t
using public.tournaments other
where t.private_activity_id is not null
  and other.private_activity_id = t.private_activity_id
  and (other.created_at, other.id) < (t.created_at, t.id);

create unique index if not exists tournaments_one_per_activity
  on public.tournaments (private_activity_id)
  where private_activity_id is not null;

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
  return v_id;
end;
$$;
revoke all on function public.create_activity_tournament(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.create_activity_tournament(uuid, text, text, text, int, text) to authenticated;
