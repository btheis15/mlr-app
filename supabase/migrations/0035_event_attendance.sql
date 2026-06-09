-- 0035_event_attendance.sql
-- Per-member attendance for resort events — the Facebook-style Going / Maybe /
-- Can't-make RSVP. Depends on 0034 (events).
--
-- Keyed by a STABLE TEXT event id, NOT a FK to public.events. That's deliberate:
-- the synthesized Family Fest event ('family-fest-2026', from lib/data.ts) and any
-- future in-code/seed events carry attendance exactly like admin-created DB events
-- (whose id is the uuid as text). delete_event() (0034) cleans up rows by id.
--
-- PUBLIC READ — members see who's coming. Guest names are masked in the UI
-- (PrivateName), the same privacy-wall doctrine as posts/profiles; the table
-- itself is public-read. Writes go through ONE SECURITY DEFINER upsert RPC so a
-- member can only ever write their OWN row.
--
-- `days` is an optional per-day map for multi-day events with the drill-down on
-- (Family Fest): {"2026-07-27": "going", "2026-07-28": "maybe"}. The overall
-- `status` is the rolled-up answer (going if any day is going) — the client keeps
-- them consistent; effectiveStatus() in lib/events.ts re-derives it defensively.

create table if not exists public.event_attendance (
  event_id   text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null check (status in ('going', 'maybe', 'not_going')),
  days       jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_attendance_event_idx on public.event_attendance (event_id);

alter table public.event_attendance enable row level security;

drop policy if exists "event_attendance: public read" on public.event_attendance;
create policy "event_attendance: public read" on public.event_attendance for select using (true);

drop trigger if exists event_attendance_set_updated_at on public.event_attendance;
create trigger event_attendance_set_updated_at
  before update on public.event_attendance
  for each row execute function public.set_updated_at();

-- Set (or change) my attendance for an event — upsert my own row only.
create or replace function public.set_event_attendance(
  p_event  text,
  p_status text,
  p_days   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event), '') = '' then raise exception 'An event is required'; end if;
  if p_status not in ('going', 'maybe', 'not_going') then raise exception 'Invalid status'; end if;

  insert into public.event_attendance (event_id, user_id, status, days)
  values (btrim(p_event), auth.uid(), p_status, p_days)
  on conflict (event_id, user_id)
  do update set status = excluded.status, days = excluded.days, updated_at = now();
end;
$$;
revoke all on function public.set_event_attendance(text, text, jsonb) from public, anon;
grant execute on function public.set_event_attendance(text, text, jsonb) to authenticated;

-- Clear my attendance (remove my own row).
create or replace function public.clear_event_attendance(p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.event_attendance where event_id = btrim(p_event) and user_id = auth.uid();
end;
$$;
revoke all on function public.clear_event_attendance(text) from public, anon;
grant execute on function public.clear_event_attendance(text) to authenticated;

-- Live counts on the /events page (and a member's own RSVP across devices).
alter table public.event_attendance replica identity full;
do $$ begin alter publication supabase_realtime add table public.event_attendance; exception when duplicate_object then null; end $$;
