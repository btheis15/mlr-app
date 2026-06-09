-- 0034_events.sql
-- Resort events + the "Going / Maybe / Can't make" attendance feature span two
-- migrations: this one is the admin-managed `events` table (the resort calendar —
-- Work Weekends, holiday weekends like the 4th of July, and any custom event);
-- 0035 adds the per-member attendance.
--
-- Family Fest is deliberately NOT a row here. It's synthesized from FAMILY_FEST
-- in lib/data.ts so it stays in lock-step with the season model (lib/festSeason.ts)
-- — its dates have one source of truth. Attendance still works for it because
-- attendance keys on a STABLE TEXT id ('family-fest-2026'), not a FK (see 0035).
--
-- Events are PUBLIC READ (the calendar is browsable, like committees/cabins). All
-- writes go through SECURITY DEFINER RPCs gated to app admins (profiles.is_admin),
-- the same shape as the cabin RPCs in 0032. Apply in the Supabase SQL editor after
-- the prior migrations (it's numbered above 0033).

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  kind        text not null default 'custom'
              check (kind in ('family_fest', 'work_weekend', 'holiday', 'custom')),
  title       text not null,
  emoji       text,
  description text,
  location    text,
  start_date  date not null,
  end_date    date,                 -- null ⇒ single-day (= start_date)
  day_rsvp    boolean not null default false,  -- offer the per-day drill-down
  source      text not null default 'admin' check (source in ('admin', 'gcal')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists events_start_idx on public.events (start_date);

alter table public.events enable row level security;

-- The calendar is public to browse. No client writes — every change goes through
-- the admin RPCs below (authorization lives in one place).
drop policy if exists "events: public read" on public.events;
create policy "events: public read" on public.events for select using (true);

-- Keep updated_at fresh (reuses the generic trigger fn from 0001).
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ── RPCs (app admins only) ───────────────────────────────────────────────────
create or replace function public.create_event(
  p_title       text,
  p_start_date  date,
  p_end_date    date default null,
  p_kind        text default 'custom',
  p_emoji       text default null,
  p_location    text default null,
  p_description text default null,
  p_day_rsvp    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A title is required'; end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  insert into public.events (title, start_date, end_date, kind, emoji, location, description, day_rsvp, created_by)
  values (
    btrim(p_title), p_start_date, p_end_date,
    coalesce(nullif(p_kind, ''), 'custom'),
    nullif(btrim(coalesce(p_emoji, '')), ''),
    nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_day_rsvp, false),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_event(text, date, date, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_event(text, date, date, text, text, text, text, boolean) to authenticated;

create or replace function public.update_event(
  p_id          uuid,
  p_title       text,
  p_start_date  date,
  p_end_date    date default null,
  p_kind        text default 'custom',
  p_emoji       text default null,
  p_location    text default null,
  p_description text default null,
  p_day_rsvp    boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A title is required'; end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  update public.events set
    title       = btrim(p_title),
    start_date  = p_start_date,
    end_date    = p_end_date,
    kind        = coalesce(nullif(p_kind, ''), 'custom'),
    emoji       = nullif(btrim(coalesce(p_emoji, '')), ''),
    location    = nullif(btrim(coalesce(p_location, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    day_rsvp    = coalesce(p_day_rsvp, false)
  where id = p_id;
  if not found then raise exception 'Event not found'; end if;
end;
$$;
revoke all on function public.update_event(uuid, text, date, date, text, text, text, text, boolean) from public, anon;
grant execute on function public.update_event(uuid, text, date, date, text, text, text, text, boolean) to authenticated;

create or replace function public.delete_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  delete from public.events where id = p_id;
  -- Attendance keys on the event id as TEXT (see 0035 — no FK cascade), so clean
  -- up its rows here. Resolved at execution time, by which point 0035 has run.
  delete from public.event_attendance where event_id = p_id::text;
end;
$$;
revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- Live updates so the /events page + Home reflect new/edited/removed events
-- immediately (mirrors cabin_bookings in 0032).
alter table public.events replica identity full;
do $$ begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; end $$;
