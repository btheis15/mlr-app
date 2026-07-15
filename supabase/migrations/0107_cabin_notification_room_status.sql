-- 0107_cabin_notification_room_status.sql
-- cabin_booking_notification (0032) now also reports whether the booking has
-- a room assigned and whether its cabin even uses named rooms, so the mini's
-- approval-confirmation email can tell an unassigned requester "pick your
-- room in the app" instead of silently omitting the room line.

-- CREATE OR REPLACE can't change a function's RETURNS TABLE column list —
-- Postgres errors with "cannot change return type of existing function".
-- Drop the 0032-shaped version first, then recreate with the two new columns.
drop function if exists public.cabin_booking_notification(uuid);

create function public.cabin_booking_notification(p_booking uuid)
returns table (
  booking_id uuid,
  status text,
  cabin_name text,
  cabin_slug text,
  check_in date,
  check_out date,
  guests int,
  notes text,
  review_note text,
  requester_id uuid,
  requester_name text,
  requester_email text,
  room_names text,
  cabin_has_rooms boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    b.id,
    b.status,
    c.name,
    c.slug,
    b.check_in,
    b.check_out,
    b.guests,
    b.notes,
    b.review_note,
    b.user_id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Member'),
    u.email::text,
    (
      select string_agg(cr.name, ', ' order by cr.sort_order)
      from public.cabin_booking_rooms cbr
      join public.cabin_rooms cr on cr.id = cbr.room_id
      where cbr.booking_id = b.id
    ),
    exists (select 1 from public.cabin_rooms cr where cr.cabin_id = c.id)
  from public.cabin_bookings b
  join public.cabins c on c.id = b.cabin_id
  join public.profiles p on p.id = b.user_id
  join auth.users u on u.id = b.user_id
  where b.id = p_booking;
$$;
revoke all on function public.cabin_booking_notification(uuid) from public, anon, authenticated;
grant execute on function public.cabin_booking_notification(uuid) to service_role;
