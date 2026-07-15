-- 0106_cabin_self_room_pick.sql
-- When an admin books a cabin stay for someone who doesn't know their room yet
-- (migration 0104/0105's "not sure yet" skip), the requester should be able to
-- come back later and pick their own room from their own "Your requests" list
-- — not wait on an admin to do it via Admin → Cabin requests. set_booking_rooms
-- (0092) was admin-only; this widens it to also allow the booking's own
-- requester (user_id = auth.uid()), same shape as the existing
-- cancel_cabin_stay "own or admin" check. Capacity/overlap enforcement is
-- unchanged — a member picking their own room is still blocked from double-
-- booking a room another approved stay already holds.

create or replace function public.set_booking_rooms(p_booking uuid, p_room_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
  v_bad_room text;
begin
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.user_id <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;

  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    if exists (
      select 1 from unnest(p_room_ids) rid
      where not exists (select 1 from public.cabin_rooms cr where cr.id = rid and cr.cabin_id = r.cabin_id)
    ) then
      raise exception 'One of those rooms isn''t part of this cabin';
    end if;

    select rm.name into v_bad_room
    from public.cabin_rooms rm
    where rm.id = any(p_room_ids)
      and exists (
        select 1
        from public.cabin_booking_rooms cbr
        join public.cabin_bookings b on b.id = cbr.booking_id
        where cbr.room_id = rm.id
          and b.id <> r.id
          and b.status = 'approved'
          and b.check_in < r.check_out
          and b.check_out > r.check_in
      )
    limit 1;
    if v_bad_room is not null then
      raise exception '% is already booked for one or more of those nights', v_bad_room;
    end if;
  end if;

  delete from public.cabin_booking_rooms where booking_id = p_booking;
  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    insert into public.cabin_booking_rooms (booking_id, room_id)
    select p_booking, rid from unnest(p_room_ids) rid;
  end if;
end;
$$;
revoke all on function public.set_booking_rooms(uuid, uuid[]) from public, anon;
grant execute on function public.set_booking_rooms(uuid, uuid[]) to authenticated;
