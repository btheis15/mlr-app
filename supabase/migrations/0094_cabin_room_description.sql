-- 0094_cabin_room_description.sql
-- Lets admins add a free-form description to a named cabin room/area (e.g.
-- "small room, no closet" or "extra-firm mattress") — same spirit as the
-- cabin-level notes field (migration 0089), just scoped to one room. Shown to
-- members in the room picker alongside the bed count.
--
-- (Closing a room to future bookings while keeping existing reservations is
-- already live via cabin_rooms.active — migration 0092's "Open/Closed" toggle
-- in the room editor. Toggling a room inactive only blocks NEW picks
-- (cabin_room_availability / request_cabin_stay / set_booking_rooms all check
-- `active`); it never touches cabin_booking_rooms rows already tied to
-- existing reservations, so those stand untouched until someone cancels them.
-- No schema change needed for that part — this migration is just the new
-- description field.)

alter table public.cabin_rooms add column if not exists description text;

-- Adding a column to the returned table shape requires dropping first —
-- CREATE OR REPLACE can't change a function's result rowtype.
drop function if exists public.cabin_room_availability(uuid, date, date);

create or replace function public.cabin_room_availability(p_cabin_id uuid, p_check_in date, p_check_out date)
returns table (
  room_id     uuid,
  name        text,
  beds        int,
  description text,
  active      boolean,
  available   boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    r.id,
    r.name,
    r.beds,
    r.description,
    r.active,
    (r.active and not exists (
      select 1
      from public.cabin_booking_rooms cbr
      join public.cabin_bookings b on b.id = cbr.booking_id
      where cbr.room_id = r.id
        and b.status = 'approved'
        and b.check_in < p_check_out
        and b.check_out > p_check_in
    )) as available
  from public.cabin_rooms r
  where r.cabin_id = p_cabin_id
  order by r.sort_order, r.name;
$$;
revoke all on function public.cabin_room_availability(uuid, date, date) from public, anon;
grant execute on function public.cabin_room_availability(uuid, date, date) to authenticated;
