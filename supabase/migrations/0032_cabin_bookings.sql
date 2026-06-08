-- 0032_cabin_bookings.sql
-- "Request a Cabin Stay": members request a room in one of the resort's two
-- cabins for any date range (defaulting to Family Fest week); app admins
-- approve or deny. Capacity is counted per house (room_count) — one room per
-- request, so a family needing two rooms submits two requests. The schema is
-- built so individual rooms can be NAMED later (add a cabin_rooms table + an
-- optional room_id on bookings) without reworking this.
--
-- On a decision the mini's push-sender + alert-mailer (service role) notify the
-- requester (push + a templated confirmation email); cabin_bookings is added to
-- Realtime so they wake on the status change. Apply in the Supabase SQL editor
-- after the prior migrations (it's numbered above the in-flight 0029/0030/0031).

-- ── Cabins (count-based capacity) ────────────────────────────────────────────
create table if not exists public.cabins (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  room_count int not null check (room_count > 0),
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- The two houses. Idempotent on slug — re-running this migration won't dupe or
-- clobber an admin's later edits to room_count/name.
insert into public.cabins (slug, name, room_count, sort_order) values
  ('cabin-1', 'Cabin 1', 3, 0),
  ('red-white-house', 'Red & White House', 4, 1)
on conflict (slug) do nothing;

alter table public.cabins enable row level security;

-- Cabins (name + capacity) are public, like committees — the availability view
-- needs them. No client writes; seeded here, managed by admins later.
drop policy if exists "cabins: public read" on public.cabins;
create policy "cabins: public read" on public.cabins for select using (true);

-- ── Bookings / requests ──────────────────────────────────────────────────────
-- check_out is the DEPARTURE date (exclusive): a stay occupies the nights
-- [check_in, check_out), so nights = check_out - check_in. "All Family Fest
-- Days" maps to check_in = 2026-07-27, check_out = 2026-08-01 (5 nights).
create table if not exists public.cabin_bookings (
  id            uuid primary key default gen_random_uuid(),
  cabin_id      uuid not null references public.cabins (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  check_in      date not null,
  check_out     date not null,
  guests        int not null default 1 check (guests >= 1),
  notes         text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  -- Atomic claim for the decision email (same pattern as announcements).
  decision_email_sent_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (check_out > check_in)
);
create index if not exists cabin_bookings_cabin_status_idx
  on public.cabin_bookings (cabin_id, status, check_in);
create index if not exists cabin_bookings_user_idx
  on public.cabin_bookings (user_id, created_at);

alter table public.cabin_bookings enable row level security;

-- Bookings are private: a member sees only their own requests; admins see all
-- (the approval queue). There are intentionally NO insert/update/delete policies
-- — every write goes through the SECURITY DEFINER RPCs below, so capacity and
-- authorization are enforced in one place. Members read availability via the
-- cabin_availability() RPC, never by reading other people's rows.
drop policy if exists "cabin_bookings: own or admin read" on public.cabin_bookings;
create policy "cabin_bookings: own or admin read" on public.cabin_bookings for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Keep updated_at fresh (reuses the generic trigger fn from 0001).
drop trigger if exists cabin_bookings_set_updated_at on public.cabin_bookings;
create trigger cabin_bookings_set_updated_at
  before update on public.cabin_bookings
  for each row execute function public.set_updated_at();

-- ── RPCs ─────────────────────────────────────────────────────────────────────
-- Create a request (always 'pending'; one room). The requester is auth.uid().
create or replace function public.request_cabin_stay(
  p_cabin uuid,
  p_check_in date,
  p_check_out date,
  p_guests int default 1,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.cabins c where c.id = p_cabin and c.active) then
    raise exception 'That cabin is not available';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;
  if coalesce(p_guests, 1) < 1 then
    raise exception 'At least one guest is required';
  end if;

  insert into public.cabin_bookings (cabin_id, user_id, check_in, check_out, guests, notes)
  values (p_cabin, auth.uid(), p_check_in, p_check_out, coalesce(p_guests, 1),
          nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_cabin_stay(uuid, date, date, int, text) from public, anon;
grant execute on function public.request_cabin_stay(uuid, date, date, int, text) to authenticated;

-- Approve or deny a request — app admins only. On approve, enforce capacity:
-- no night in the stay's range may already have room_count approved bookings.
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
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.status = 'cancelled' then raise exception 'That request was cancelled'; end if;

  if p_approve then
    select c.room_count, c.name into v_room_count, v_name
      from public.cabins c where c.id = r.cabin_id;
    -- Reject if any night in [check_in, check_out) is already at capacity among
    -- OTHER approved bookings for this cabin. Iterate nights via integer offsets
    -- (date + int) to avoid generate_series overload ambiguity.
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

-- Cancel a request — the requester (their own) or an admin.
create or replace function public.cancel_cabin_stay(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
begin
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.user_id <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.cabin_bookings set status = 'cancelled' where id = p_booking;
end;
$$;
revoke all on function public.cancel_cabin_stay(uuid) from public, anon;
grant execute on function public.cancel_cabin_stay(uuid) to authenticated;

-- Availability for a date range, per cabin: rooms still bookable for the WHOLE
-- range = room_count - (peak approved overlap across the nights). Lets any
-- member see "3 of 4 left" without reading others' private bookings.
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
    c.room_count,
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
    ), 0))::int as available
  from public.cabins c
  where c.active
  order by c.sort_order, c.name;
$$;
revoke all on function public.cabin_availability(date, date) from public, anon;
grant execute on function public.cabin_availability(date, date) to authenticated;

-- Everything the mini needs to push + email a decision to the requester.
-- service_role only (reads auth.users for the email) — never the client.
create or replace function public.cabin_booking_notification(p_booking uuid)
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
  requester_email text
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
    u.email::text
  from public.cabin_bookings b
  join public.cabins c on c.id = b.cabin_id
  join public.profiles p on p.id = b.user_id
  join auth.users u on u.id = b.user_id
  where b.id = p_booking;
$$;
revoke all on function public.cabin_booking_notification(uuid) from public, anon, authenticated;
grant execute on function public.cabin_booking_notification(uuid) to service_role;

-- Live updates so the mini wakes on a new request (notify admins) and on a
-- decision (notify the requester). REPLICA IDENTITY FULL so an UPDATE event
-- carries the OLD row too — the mini only notifies on the pending → decision
-- transition.
alter table public.cabin_bookings replica identity full;
do $$ begin alter publication supabase_realtime add table public.cabin_bookings; exception when duplicate_object then null; end $$;
