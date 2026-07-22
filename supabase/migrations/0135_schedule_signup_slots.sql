-- Optional "limited sign-up" time slots for a schedule event (e.g. a craft
-- station that only fits 4 people at a time): the event creator sets a
-- capacity-per-slot, an interval, and a first/last time, and members claim a
-- slot themselves — mirroring how event_attendance/help_request_items let
-- members write their own row while an organizer (here: can_edit_fest() OR the
-- event's lead/crew, same predicate as the 0110 self-edit policy) can act on
-- anyone's behalf, the same shape cabin bookings use for "admin books for a
-- member."
--
-- The slot list itself isn't stored — it's derived from five small config
-- columns on fest_schedule_items (capacity/interval/first/last), the same way
-- cabin_availability() derives room counts rather than persisting every open
-- slot. public.fest_schedule_slots(item) regenerates the valid slot list so
-- both the client (for display) and sign_up_for_schedule_slot() (for
-- validation) agree on exactly what a "slot_start" may be.

alter table public.fest_schedule_items
  add column if not exists signup_enabled     boolean not null default false,
  add column if not exists signup_capacity    int,
  add column if not exists signup_slot_minutes int,
  add column if not exists signup_start_time  text,   -- "HH:MM", first slot's start
  add column if not exists signup_end_time    text;   -- "HH:MM", boundary the last slot must end by

-- ── Who's in each slot ─────────────────────────────────────────────────────────
-- `name` is a display-name snapshot (mirrors lead_name/chef_name pre-0113 —
-- resolved from the profile at signup time for a linked member, or typed by an
-- organizer adding someone without an account). Public-read, like the rest of
-- fest_schedule_items and event_attendance — the client masks guest-facing
-- names with the same PrivateName component used everywhere else.
create table if not exists public.fest_schedule_signups (
  id               uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references public.fest_schedule_items (id) on delete cascade,
  slot_start       text not null,
  user_id          uuid references public.profiles (id) on delete set null,
  name             text not null,
  added_by         uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists fest_schedule_signups_item_idx
  on public.fest_schedule_signups (schedule_item_id, slot_start);
-- A member can only take a given slot once (re-running sign_up_for_schedule_slot
-- for the same slot is a no-op, not a second seat).
create unique index if not exists fest_schedule_signups_item_slot_user_idx
  on public.fest_schedule_signups (schedule_item_id, slot_start, user_id)
  where user_id is not null;

alter table public.fest_schedule_signups enable row level security;
drop policy if exists "fest_schedule_signups: public read" on public.fest_schedule_signups;
create policy "fest_schedule_signups: public read" on public.fest_schedule_signups for select using (true);
-- No insert/update/delete policy — every write goes through the SECURITY
-- DEFINER functions below, same as event_attendance/help_request_items.

do $$ begin alter publication supabase_realtime add table public.fest_schedule_signups; exception when duplicate_object then null; end $$;

-- ── May this caller manage OTHER people's slots on this event? ───────────────
-- Same predicate as the 0110 self-edit RLS policy (can_edit_fest() OR the
-- event's own lead/crew) — the "event creator" the feature request describes.
create or replace function public._can_manage_schedule_signups(p_item public.fest_schedule_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_fest()
    or p_item.lead_user_id = auth.uid()
    or auth.uid() = any(p_item.crew_user_ids);
$$;
revoke all on function public._can_manage_schedule_signups(public.fest_schedule_items) from public, anon;

-- ── The valid slot start times for an event's sign-up config ─────────────────
-- "HH:MM" strings from signup_start_time up to (but not reaching)
-- signup_end_time, signup_slot_minutes apart — e.g. 12:00/16:00/60 → 12:00,
-- 13:00, 14:00, 15:00 (four one-hour slots ending by 4pm).
create or replace function public.fest_schedule_slot_starts(p_item public.fest_schedule_items)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- generate_series has no `time` overload, only timestamp/timestamptz/numeric
  -- — anchor both ends to an arbitrary fixed date, then format back to "HH:MM".
  select to_char(t, 'HH24:MI')
  from generate_series(
    (date '2000-01-01' + p_item.signup_start_time::time),
    (date '2000-01-01' + p_item.signup_end_time::time) - make_interval(mins => p_item.signup_slot_minutes),
    make_interval(mins => p_item.signup_slot_minutes)
  ) t
  where p_item.signup_enabled
    and p_item.signup_start_time is not null
    and p_item.signup_end_time is not null
    and coalesce(p_item.signup_slot_minutes, 0) > 0;
$$;
-- Internal helper only (called from sign_up_for_schedule_slot below) — the
-- client derives the same slot list itself from the four config columns for
-- display, so this never needs a PostgREST grant.
revoke all on function public.fest_schedule_slot_starts(public.fest_schedule_items) from public, anon;

-- ── Claim a slot — for myself, or (organizer-only) for someone else ──────────
-- p_for_user: add a linked member other than the caller (organizer-only).
-- p_name: add a free-text, account-less name (organizer-only).
-- Neither set ⇒ the caller signs themselves up (name resolved from profiles).
create or replace function public.sign_up_for_schedule_slot(
  p_item     uuid,
  p_slot     text,
  p_for_user uuid default null,
  p_name     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_item  public.fest_schedule_items;
  v_can   boolean;
  v_uid_target uuid;
  v_name  text;
  v_taken int;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_item from public.fest_schedule_items where id = p_item;
  if not found then raise exception 'Event not found'; end if;
  if not v_item.signup_enabled then raise exception 'This event isn''t taking sign-ups'; end if;
  if coalesce(btrim(p_slot), '') = '' or not exists (
    select 1 from public.fest_schedule_slot_starts(v_item) s where s = p_slot
  ) then
    raise exception 'That time slot isn''t available';
  end if;

  v_can := public._can_manage_schedule_signups(v_item);

  if p_for_user is not null and p_for_user <> v_uid then
    if not v_can then raise exception 'Only the event organizer can add someone else'; end if;
    v_uid_target := p_for_user;
    select display_name into v_name from public.profiles where id = p_for_user;
    if v_name is null then raise exception 'Member not found'; end if;
  elsif p_name is not null and btrim(p_name) <> '' then
    if not v_can then raise exception 'Only the event organizer can add a name directly'; end if;
    v_uid_target := null;
    v_name := btrim(p_name);
  else
    v_uid_target := v_uid;
    select display_name into v_name from public.profiles where id = v_uid;
  end if;

  if v_uid_target is not null and exists (
    select 1 from public.fest_schedule_signups
    where schedule_item_id = p_item and slot_start = p_slot and user_id = v_uid_target
  ) then
    raise exception 'Already signed up for that slot';
  end if;

  select count(*) into v_taken
  from public.fest_schedule_signups
  where schedule_item_id = p_item and slot_start = p_slot;
  if v_taken >= coalesce(v_item.signup_capacity, 0) then
    raise exception 'That time slot is full';
  end if;

  insert into public.fest_schedule_signups (schedule_item_id, slot_start, user_id, name, added_by)
  values (p_item, p_slot, v_uid_target, v_name, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sign_up_for_schedule_slot(uuid, text, uuid, text) from public, anon;
grant execute on function public.sign_up_for_schedule_slot(uuid, text, uuid, text) to authenticated;

-- ── Remove a signup — the person themselves, or the event's organizer ────────
create or replace function public.remove_schedule_signup(p_signup uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_signup public.fest_schedule_signups;
  v_item   public.fest_schedule_items;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_signup from public.fest_schedule_signups where id = p_signup;
  if not found then raise exception 'That sign-up is already gone'; end if;
  select * into v_item from public.fest_schedule_items where id = v_signup.schedule_item_id;

  if v_signup.user_id is distinct from v_uid and not public._can_manage_schedule_signups(v_item) then
    raise exception 'Only the event organizer can remove someone else';
  end if;

  delete from public.fest_schedule_signups where id = p_signup;
end;
$$;
revoke all on function public.remove_schedule_signup(uuid) from public, anon;
grant execute on function public.remove_schedule_signup(uuid) to authenticated;
