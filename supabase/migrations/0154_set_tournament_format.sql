-- 0154_set_tournament_format.sql
--
-- Let a manager switch a tournament's format (single-elim / round-robin / pools)
-- WHILE IT'S STILL IN SETUP — before a bracket/schedule is generated. Format is
-- otherwise picked only at creation and frozen; this closes the gap where a
-- tournament created as "Bracket" could never become a round-robin or pools without
-- deleting it. Same entrants work for all three formats, so no data reshaping — just
-- the flag (reset the bracket first if already generated).

create or replace function public.set_tournament_format(p_tournament uuid, p_format text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket before changing the format'; end if;
  if p_format not in ('single_elim', 'round_robin', 'pools_bracket') then raise exception 'Unknown format'; end if;
  update public.tournaments set format = p_format where id = p_tournament;
end;
$$;
revoke all on function public.set_tournament_format(uuid, text) from public, anon;
grant execute on function public.set_tournament_format(uuid, text) to authenticated;
