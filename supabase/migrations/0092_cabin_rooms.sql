-- 0092_cabin_rooms.sql
-- Named rooms/areas within a cabin, for cabins where "how many rooms are
-- left" isn't specific enough — Red & White House needs people to pick WHICH
-- room/area they want (so two solo travelers can tell if they'd be sharing a
-- room, or avoid the room that's temporarily closed), not just a bare count.
-- A cabin with no cabin_rooms rows (e.g. Cabin 1) keeps behaving exactly as
-- before — this is additive, not a replacement for the room_count model.
--
-- Two new tables:
--   cabin_rooms        — the rooms/areas themselves (name, beds, active).
--   cabin_booking_rooms — which room(s) a booking reserves (a booking can
--                         reserve more than one room, e.g. 2 beds needed).
--
-- request_cabin_stay() gets an optional p_room_ids: when the cabin has rooms
-- defined, the member (or admin booking for someone) picks specific rooms
-- instead of a bare guest count. review_cabin_stay()'s capacity check now
-- checks per-room conflicts for a room-specific booking, falling back to the
-- original cabin-wide room_count math for a booking with no rooms attached
-- (legacy bookings, or a cabin that never got rooms defined). cabin_availability()
-- derives its room_count/available from cabin_rooms when any exist for that
-- cabin, so the existing "X of Y rooms left" card stays accurate either way.
--
-- set_booking_rooms(p_booking, p_room_ids) is a standalone admin-only RPC so
-- an admin can (re)assign rooms on ANY existing booking at any time — not just
-- at creation — which is how the current Red & White reservations (made
-- before rooms existed) get their room assignments filled in by hand.

-- ── cabin_rooms ──────────────────────────────────────────────────────────────
create table if not exists public.cabin_rooms (
  id         uuid primary key default gen_random_uuid(),
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  name       text not null,
  beds       int  not null default 1 check (beds >= 0),
  active     boolean not null default true,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cabin_id, name)
);
create index if not exists cabin_rooms_cabin_idx on public.cabin_rooms (cabin_id, sort_order);

alter table public.cabin_rooms enable row level security;

drop policy if exists "cabin_rooms: public read" on public.cabin_rooms;
create policy "cabin_rooms: public read" on public.cabin_rooms for select using (true);

drop policy if exists "cabin_rooms: admin write" on public.cabin_rooms;
create policy "cabin_rooms: admin write" on public.cabin_rooms for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop trigger if exists cabin_rooms_set_updated_at on public.cabin_rooms;
create trigger cabin_rooms_set_updated_at
  before update on public.cabin_rooms
  for each row execute function public.set_updated_at();

-- Seed Red & White House's five rooms/areas. Idempotent via the unique
-- (cabin_id, name) constraint — re-running this migration won't dupe or
-- clobber an admin's later edits.
insert into public.cabin_rooms (cabin_id, name, beds, active, sort_order)
select c.id, v.name, v.beds, v.active, v.sort_order
from public.cabins c
cross join (values
  ('Upstairs South Room',       1, true,  0),
  ('Upstairs East Room',        1, true,  1),
  ('Upstairs Open Area',        1, true,  2),
  ('Downstairs Near Bathroom',  1, true,  3),
  ('Downstairs Near Stairs',    1, false, 4)
) as v(name, beds, active, sort_order)
where c.slug = 'red-white-house'
on conflict (cabin_id, name) do nothing;

-- ── cabin_booking_rooms ──────────────────────────────────────────────────────
create table if not exists public.cabin_booking_rooms (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.cabin_bookings (id) on delete cascade,
  room_id    uuid not null references public.cabin_rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (booking_id, room_id)
);
create index if not exists cabin_booking_rooms_room_idx on public.cabin_booking_rooms (room_id);
create index if not exists cabin_booking_rooms_booking_idx on public.cabin_booking_rooms (booking_id);

alter table public.cabin_booking_rooms enable row level security;

-- Same read shape as cabin_bookings itself (own or admin) — no client
-- insert/update/delete policies; every write goes through request_cabin_stay
-- or set_booking_rooms below.
drop policy if exists "cabin_booking_rooms: own or admin read" on public.cabin_booking_rooms;
create policy "cabin_booking_rooms: own or admin read" on public.cabin_booking_rooms for select
  using (
    exists (
      select 1 from public.cabin_bookings b
      where b.id = booking_id
        and (b.user_id = auth.uid()
             or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
    )
  );

alter table public.cabin_booking_rooms replica identity full;
do $$ begin alter publication supabase_realtime add table public.cabin_booking_rooms; exception when duplicate_object then null; end $$;

-- ── cabin_room_availability — per-room state for a date range ────────────────
create or replace function public.cabin_room_availability(p_cabin_id uuid, p_check_in date, p_check_out date)
returns table (
  room_id   uuid,
  name      text,
  beds      int,
  active    boolean,
  available boolean
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

-- ── request_cabin_stay — now accepts specific room picks ─────────────────────
drop function if exists public.request_cabin_stay(uuid, date, date, int, text, uuid);

create or replace function public.request_cabin_stay(
  p_cabin     uuid,
  p_check_in  date,
  p_check_out date,
  p_guests    int  default 1,
  p_notes     text default null,
  p_for_user  uuid default null,
  p_room_ids  uuid[] default null
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

  insert into public.cabin_bookings (cabin_id, user_id, check_in, check_out, guests, notes, booked_by)
  values (p_cabin, v_target, p_check_in, p_check_out, coalesce(p_guests, 1),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when v_target <> auth.uid() then auth.uid() else null end)
  returning id into v_id;

  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    insert into public.cabin_booking_rooms (booking_id, room_id)
    select v_id, rid from unnest(p_room_ids) rid;
  end if;

  return v_id;
end;
$$;
revoke all on function public.request_cabin_stay(uuid, date, date, int, text, uuid, uuid[]) from public, anon;
grant execute on function public.request_cabin_stay(uuid, date, date, int, text, uuid, uuid[]) to authenticated;

-- ── review_cabin_stay — per-room capacity check when rooms are attached ──────
create or replace function public.review_cabin_stay(
  p_booking uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
  v_room_count int;
  v_name text;
  v_room_ids uuid[];
  v_bad_room text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.status = 'cancelled' then raise exception 'That request was cancelled'; end if;

  if p_approve then
    select array_agg(room_id) into v_room_ids
      from public.cabin_booking_rooms where booking_id = r.id;

    if v_room_ids is not null and array_length(v_room_ids, 1) > 0 then
      -- Room-specific booking: check its OWN rooms against other approved
      -- bookings of the same room, not the cabin-wide count.
      select rm.name into v_bad_room
      from public.cabin_rooms rm
      where rm.id = any(v_room_ids)
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
    else
      -- Legacy / no room selection: the original cabin-wide capacity count.
      select c.room_count, c.name into v_room_count, v_name
        from public.cabins c where c.id = r.cabin_id;
      if exists (
        select 1
        from generate_series(0, (r.check_out - r.check_in) - 1) as g(n)
        where (
          select count(b.id)
          from public.cabin_bookings b
          where b.cabin_id = r.cabin_id
            and b.status = 'approved'
            and b.id <> r.id
            and b.check_in <= r.check_in + g.n
            and b.check_out > r.check_in + g.n
        ) >= v_room_count
      ) then
        raise exception 'No rooms left in % for one or more of those nights', v_name;
      end if;
    end if;
  end if;

  update public.cabin_bookings
    set status = case when p_approve then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_booking;
end;
$$;
revoke all on function public.review_cabin_stay(uuid, boolean, text) from public, anon;
grant execute on function public.review_cabin_stay(uuid, boolean, text) to authenticated;

-- ── cabin_availability — derive room_count/available from cabin_rooms when
--    any are defined for that cabin; unchanged for a cabin with none ─────────
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
    coalesce(rc.available, greatest(0, c.room_count - coalesce((
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
    ), 0))) as available
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
  where c.active
  order by c.sort_order, c.name;
$$;
revoke all on function public.cabin_availability(date, date) from public, anon;
grant execute on function public.cabin_availability(date, date) to authenticated;

-- ── set_booking_rooms — admin-only, reassign rooms on ANY existing booking ───
-- The ongoing capability (not a one-time fix): lets an admin manually attach/
-- change which room(s) an existing reservation (including ones made before
-- rooms existed) actually occupies, any time.
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
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;

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

  delete from public.cabin_booking_rooms where booking_id = r.id;
  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    insert into public.cabin_booking_rooms (booking_id, room_id)
    select r.id, rid from unnest(p_room_ids) rid;
  end if;
end;
$$;
revoke all on function public.set_booking_rooms(uuid, uuid[]) from public, anon;
grant execute on function public.set_booking_rooms(uuid, uuid[]) to authenticated;
