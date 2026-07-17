-- 0111_cabin_availability_beds.sql
-- Extend cabin_availability() to also return real bed counts, not just room
-- counts, so "Request a Cabin Stay" can show "X of Y beds left" instead of
-- only a static bed total. beds_total/beds_available are null for a cabin
-- with no named rooms (0092) — the client falls back to cabins.bed_count.
--
-- A named room is an exclusive-claim unit regardless of its own `beds` count
-- (cabin_room_availability already treats a room as fully unavailable the
-- moment ANY approved booking claims it), so beds_available sums the `beds`
-- of whichever rooms are still fully open. This can't be derived client-side:
-- cabin_bookings/cabin_booking_rooms are own-or-admin read (RLS), so a plain
-- member has no way to see how many OTHER approved bookings exist — same
-- reason room_count/available already had to be a security-definer RPC.
--
-- An approved booking with NO room picked yet ("Not sure yet") isn't tied to
-- any specific room, so it can't be subtracted from a specific room's beds —
-- it's treated as reserving exactly one bed, mirroring both the "one room per
-- bed needed" convention CabinRequestSheet already uses ("Need 2 beds? Pick 2
-- rooms") and this function's own pre-existing `unassigned` handling for
-- room_count (0108).
drop function if exists public.cabin_availability(date, date);

create or replace function public.cabin_availability(p_check_in date, p_check_out date)
returns table (
  cabin_id uuid,
  slug text,
  name text,
  room_count int,
  available int,
  beds_total int,
  beds_available int
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
    end as available,
    rc.beds_total,
    case
      when rc.beds_total is not null then
        greatest(0, rc.beds_available - coalesce(unassigned.cnt, 0))
      else null
    end as beds_available
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
      ))::int as available,
      coalesce(sum(r.beds) filter (where r.active), 0)::int as beds_total,
      coalesce(sum(r.beds) filter (where r.active and not exists (
        select 1
        from public.cabin_booking_rooms cbr
        join public.cabin_bookings b on b.id = cbr.booking_id
        where cbr.room_id = r.id
          and b.status = 'approved'
          and b.check_in < p_check_out
          and b.check_out > p_check_in
      )), 0)::int as beds_available
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
