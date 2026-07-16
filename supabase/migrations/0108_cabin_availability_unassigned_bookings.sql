-- Fix cabin_availability() so an approved booking with NO specific room
-- picked yet (the "Not sure yet" option added in 0104-0107) still counts
-- against the room-based availability count. Previously the room-based
-- branch only subtracted rooms reserved via cabin_booking_rooms, so an
-- approved-but-unassigned booking was invisible to "X of Y rooms left" —
-- a cabin could show 4/4 available with a real guest already coming.
-- Each such booking is assumed to occupy exactly one room, mirroring how
-- request_cabin_stay/CabinRoomPicker require one room per bed needed.
create or replace function public.cabin_availability(p_check_in date, p_check_out date)
returns table (
  cabin_id uuid,
  slug text,
  name text,
  room_count int,
  available int
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.id,
    c.slug,
    c.name,
    coalesce(rc.total, c.room_count) as room_count,
    case
      when rc.total is not null then
        greatest(0, rc.available - coalesce(unassigned.cnt, 0))
      else
        greatest(0, c.room_count - coalesce((
          select max(per_night.cnt)
          from (
            select count(b.id) as cnt
            from generate_series(0, (p_check_out - p_check_in) - 1) as g(n)
            left join public.cabin_bookings b
              on b.cabin_id = c.id
             and b.status = 'approved'
             and b.check_in <= p_check_in + g.n
             and b.check_out > p_check_in + g.n
            group by g.n
          ) per_night
        ), 0))
    end as available
  from public.cabins c
  left join lateral (
    select
      count(*) filter (where r.active)::int as total,
      count(*) filter (where r.active and not exists (
        select 1
        from public.cabin_booking_rooms cbr
        join public.cabin_bookings b on b.id = cbr.booking_id
        where cbr.room_id = r.id
          and b.status = 'approved'
          and b.check_in < p_check_out
          and b.check_out > p_check_in
      ))::int as available
    from public.cabin_rooms r
    where r.cabin_id = c.id
    having count(*) > 0
  ) rc on true
  left join lateral (
    select count(*)::int as cnt
    from public.cabin_bookings b
    where b.cabin_id = c.id
      and b.status = 'approved'
      and b.check_in < p_check_out
      and b.check_out > p_check_in
      and not exists (
        select 1 from public.cabin_booking_rooms cbr where cbr.booking_id = b.id
      )
  ) unassigned on rc.total is not null
  where c.active
  order by c.sort_order, c.name;
$$;
revoke all on function public.cabin_availability(date, date) from public, anon;
grant execute on function public.cabin_availability(date, date) to authenticated;
