-- 0115_request_cabin_stay_dedupe.sql
-- Cleans up a latent overload bug in request_cabin_stay(): migration 0092
-- added a 7-arg version ending in `p_room_ids uuid[]`; migration 0108 meant to
-- layer p_notify on top of that, but instead defined a SEPARATE 7-arg version
-- ending in `p_notify boolean` (and only dropped the older 6-arg signature,
-- not 0092's) — so both 7-arg overloads have coexisted since. In practice the
-- client (`requestStay()` in lib/cabins.ts) always sends p_room_ids and never
-- p_notify, so it has always resolved to 0092's overload — meaning any
-- `request_notify = false` intent has silently never taken effect (the row
-- just gets the column's default of true, since that overload's INSERT never
-- mentions the column at all).
--
-- This merges both feature sets into ONE canonical 8-arg function (room
-- picking + the request_notify column), then drops the two superseded 7-arg
-- overloads. No client change needed — the existing call (which passes
-- p_room_ids, not p_notify) now resolves unambiguously to this one function
-- and keeps behaving exactly as it does today; p_notify simply becomes usable
-- if a caller ever wants it (defaults to true either way).

create or replace function public.request_cabin_stay(
  p_cabin     uuid,
  p_check_in  date,
  p_check_out date,
  p_guests    int  default 1,
  p_notes     text default null,
  p_for_user  uuid default null,
  p_room_ids  uuid[] default null,
  p_notify    boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_target uuid;
  v_is_admin boolean;
  v_bad_room text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select p.is_admin into v_is_admin from public.profiles p where p.id = auth.uid();

  v_target := coalesce(p_for_user, auth.uid());
  if v_target <> auth.uid() and not coalesce(v_is_admin, false) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_target) then
    raise exception 'That member could not be found';
  end if;

  if not exists (select 1 from public.cabins c where c.id = p_cabin and c.active) then
    raise exception 'That cabin is not available';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;
  if coalesce(p_guests, 1) < 1 then
    raise exception 'At least one guest is required';
  end if;

  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    if exists (
      select 1 from unnest(p_room_ids) rid
      where not exists (select 1 from public.cabin_rooms r where r.id = rid and r.cabin_id = p_cabin)
    ) then
      raise exception 'One of those rooms isn''t part of this cabin';
    end if;

    select r.name into v_bad_room
    from public.cabin_rooms r
    where r.id = any(p_room_ids) and not r.active
    limit 1;
    if v_bad_room is not null then
      raise exception '% is currently closed', v_bad_room;
    end if;

    select r.name into v_bad_room
    from public.cabin_rooms r
    where r.id = any(p_room_ids)
      and exists (
        select 1
        from public.cabin_booking_rooms cbr
        join public.cabin_bookings b on b.id = cbr.booking_id
        where cbr.room_id = r.id
          and b.status = 'approved'
          and b.check_in < p_check_out
          and b.check_out > p_check_in
      )
    limit 1;
    if v_bad_room is not null then
      raise exception '% is already booked for one or more of those nights', v_bad_room;
    end if;
  end if;

  insert into public.cabin_bookings (cabin_id, user_id, check_in, check_out, guests, notes, booked_by, request_notify)
  values (p_cabin, v_target, p_check_in, p_check_out, coalesce(p_guests, 1),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when v_target <> auth.uid() then auth.uid() else null end,
          coalesce(p_notify, true))
  returning id into v_id;

  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    insert into public.cabin_booking_rooms (booking_id, room_id)
    select v_id, rid from unnest(p_room_ids) rid;
  end if;

  return v_id;
end;
$$;
revoke all on function public.request_cabin_stay(uuid, date, date, int, text, uuid, uuid[], boolean) from public, anon;
grant execute on function public.request_cabin_stay(uuid, date, date, int, text, uuid, uuid[], boolean) to authenticated;

-- Drop the two now-superseded 7-arg overloads so PostgREST's schema cache
-- can't resolve a call to either stale signature anymore.
drop function if exists public.request_cabin_stay(uuid, date, date, int, text, uuid, uuid[]);
drop function if exists public.request_cabin_stay(uuid, date, date, int, text, uuid, boolean);
