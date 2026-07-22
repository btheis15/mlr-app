-- Bring the whole event sign-up feature (migrations 0135 + 0136) to "Anytime
-- all week" activities (fest_activities), which had no sign-up concept at all.
-- Mirrors the fest_schedule_items shape exactly — same config columns, the same
-- interval/slots split, the same custom columns + instructions, and the same
-- "anyone can sign up anyone" RPCs — but against fest_activities and its own
-- slot/signup child tables, so the two features stay cleanly separate (real FKs,
-- cascade deletes, no nullable-parent gymnastics on the shipped schedule tables).
--
-- Activities have no day/time of their own, so interval-mode slots here are
-- time-only (the client label just shows the time); slots-mode slots carry
-- their own optional day, exactly like the schedule side.

-- ── Sign-up config on the activity itself (all new — 0135/0136 added these to
--    fest_schedule_items only) ─────────────────────────────────────────────────
alter table public.fest_activities
  add column if not exists signup_enabled      boolean not null default false,
  add column if not exists signup_capacity     int,
  add column if not exists signup_slot_minutes int,
  add column if not exists signup_start_time   text,   -- "HH:MM"
  add column if not exists signup_end_time     text,   -- "HH:MM"
  add column if not exists signup_mode         text not null default 'interval'
    check (signup_mode in ('interval', 'slots')),
  add column if not exists signup_instructions text,
  add column if not exists signup_fields       jsonb not null default '[]'::jsonb;

-- ── May this caller manage the activity's sign-ups? ──────────────────────────
-- Same predicate as the 0110 activity self-edit policy: can_edit_fest() OR the
-- activity's own lead/crew.
create or replace function public._can_manage_activity_signups(p_act public.fest_activities)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_fest()
    or p_act.lead_user_id = auth.uid()
    or auth.uid() = any(p_act.crew_user_ids);
$$;
revoke all on function public._can_manage_activity_signups(public.fest_activities) from public, anon;

-- ── Interval-mode slot starts (mirrors fest_schedule_slot_starts) ────────────
create or replace function public.fest_activity_slot_starts(p_act public.fest_activities)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(t, 'HH24:MI')
  from generate_series(
    (date '2000-01-01' + p_act.signup_start_time::time),
    (date '2000-01-01' + p_act.signup_end_time::time) - make_interval(mins => p_act.signup_slot_minutes),
    make_interval(mins => p_act.signup_slot_minutes)
  ) t
  where p_act.signup_enabled
    and p_act.signup_start_time is not null
    and p_act.signup_end_time is not null
    and coalesce(p_act.signup_slot_minutes, 0) > 0;
$$;
revoke all on function public.fest_activity_slot_starts(public.fest_activities) from public, anon;

-- ── Explicit, independent slots (signup_mode = 'slots') ──────────────────────
create table if not exists public.fest_activity_slots (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.fest_activities (id) on delete cascade,
  day         text,           -- ISO "YYYY-MM-DD"; null ⇒ no specific day
  start_time  text not null,  -- "HH:MM"
  end_time    text,           -- "HH:MM", optional
  label       text,
  capacity    int,            -- null ⇒ activity's signup_capacity
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists fest_activity_slots_item_idx
  on public.fest_activity_slots (activity_id, position);

alter table public.fest_activity_slots enable row level security;
drop policy if exists "fest_activity_slots: public read" on public.fest_activity_slots;
create policy "fest_activity_slots: public read" on public.fest_activity_slots for select using (true);

do $$ begin alter publication supabase_realtime add table public.fest_activity_slots; exception when duplicate_object then null; end $$;

create or replace function public._can_manage_activity_item_signups(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fest_activities a
    where a.id = p_activity_id and public._can_manage_activity_signups(a)
  );
$$;
revoke all on function public._can_manage_activity_item_signups(uuid) from public, anon;
grant execute on function public._can_manage_activity_item_signups(uuid) to authenticated;

drop policy if exists "fest_activity_slots: manage insert" on public.fest_activity_slots;
create policy "fest_activity_slots: manage insert" on public.fest_activity_slots
  for insert with check (public._can_manage_activity_item_signups(activity_id));
drop policy if exists "fest_activity_slots: manage update" on public.fest_activity_slots;
create policy "fest_activity_slots: manage update" on public.fest_activity_slots
  for update using (public._can_manage_activity_item_signups(activity_id))
             with check (public._can_manage_activity_item_signups(activity_id));
drop policy if exists "fest_activity_slots: manage delete" on public.fest_activity_slots;
create policy "fest_activity_slots: manage delete" on public.fest_activity_slots
  for delete using (public._can_manage_activity_item_signups(activity_id));

-- ── Who's signed up ──────────────────────────────────────────────────────────
create table if not exists public.fest_activity_signups (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.fest_activities (id) on delete cascade,
  slot_start  text,          -- interval mode
  slot_id     uuid references public.fest_activity_slots (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null,
  added_by    uuid references public.profiles (id) on delete set null,
  fields      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fest_activity_signups_item_idx
  on public.fest_activity_signups (activity_id, slot_start);
create unique index if not exists fest_activity_signups_item_slot_user_idx
  on public.fest_activity_signups (activity_id, slot_start, user_id)
  where user_id is not null and slot_id is null;
create unique index if not exists fest_activity_signups_slotid_user_idx
  on public.fest_activity_signups (slot_id, user_id)
  where slot_id is not null and user_id is not null;

alter table public.fest_activity_signups enable row level security;
drop policy if exists "fest_activity_signups: public read" on public.fest_activity_signups;
create policy "fest_activity_signups: public read" on public.fest_activity_signups for select using (true);

do $$ begin alter publication supabase_realtime add table public.fest_activity_signups; exception when duplicate_object then null; end $$;

-- ── Sign up for an activity slot — open to any member, for anyone, with fields ─
-- p_item is the activity id (named p_item for call-shape symmetry with the
-- schedule RPC, so the client passes the same args either way).
create or replace function public.sign_up_for_activity_slot(
  p_item     uuid,
  p_slot     text    default null,
  p_for_user uuid    default null,
  p_name     text    default null,
  p_slot_id  uuid    default null,
  p_fields   jsonb   default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_act        public.fest_activities;
  v_slot       public.fest_activity_slots;
  v_uid_target uuid;
  v_name       text;
  v_cap        int;
  v_taken      int;
  v_id         uuid;
  v_field      jsonb;
  v_fid        text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_act from public.fest_activities where id = p_item;
  if not found then raise exception 'Activity not found'; end if;
  if not v_act.signup_enabled then raise exception 'This activity isn''t taking sign-ups'; end if;

  if p_slot_id is not null then
    select * into v_slot from public.fest_activity_slots
      where id = p_slot_id and activity_id = p_item;
    if not found then raise exception 'That time slot isn''t available'; end if;
    v_cap := coalesce(v_slot.capacity, v_act.signup_capacity, 0);
  else
    if coalesce(btrim(p_slot), '') = '' or not exists (
      select 1 from public.fest_activity_slot_starts(v_act) s where s = p_slot
    ) then
      raise exception 'That time slot isn''t available';
    end if;
    v_cap := coalesce(v_act.signup_capacity, 0);
  end if;

  if p_for_user is not null and p_for_user <> v_uid then
    v_uid_target := p_for_user;
    select display_name into v_name from public.profiles where id = p_for_user;
    if v_name is null then raise exception 'Member not found'; end if;
  elsif p_name is not null and btrim(p_name) <> '' then
    v_uid_target := null;
    v_name := btrim(p_name);
  else
    v_uid_target := v_uid;
    select display_name into v_name from public.profiles where id = v_uid;
  end if;

  for v_field in select * from jsonb_array_elements(coalesce(v_act.signup_fields, '[]'::jsonb)) loop
    v_fid := v_field->>'id';
    if v_fid is not null and coalesce(btrim(p_fields->>v_fid), '') = '' then
      raise exception 'Please fill in "%"', coalesce(v_field->>'label', 'all fields');
    end if;
  end loop;

  if v_uid_target is not null and exists (
    select 1 from public.fest_activity_signups
    where activity_id = p_item
      and user_id = v_uid_target
      and ((p_slot_id is not null and slot_id = p_slot_id)
        or (p_slot_id is null and slot_id is null and slot_start = p_slot))
  ) then
    raise exception 'Already signed up for that slot';
  end if;

  select count(*) into v_taken
  from public.fest_activity_signups
  where activity_id = p_item
    and ((p_slot_id is not null and slot_id = p_slot_id)
      or (p_slot_id is null and slot_id is null and slot_start = p_slot));
  if v_taken >= v_cap then raise exception 'That time slot is full'; end if;

  insert into public.fest_activity_signups (activity_id, slot_start, slot_id, user_id, name, added_by, fields)
  values (p_item, case when p_slot_id is null then p_slot end, p_slot_id, v_uid_target, v_name, v_uid,
          coalesce(p_fields, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sign_up_for_activity_slot(uuid, text, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.sign_up_for_activity_slot(uuid, text, uuid, text, uuid, jsonb) to authenticated;

-- ── Remove a sign-up — the person, the row's adder, or an organizer ──────────
create or replace function public.remove_activity_signup(p_signup uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_signup public.fest_activity_signups;
  v_act    public.fest_activities;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_signup from public.fest_activity_signups where id = p_signup;
  if not found then raise exception 'That sign-up is already gone'; end if;
  select * into v_act from public.fest_activities where id = v_signup.activity_id;

  if v_signup.user_id is distinct from v_uid
     and v_signup.added_by is distinct from v_uid
     and not public._can_manage_activity_signups(v_act) then
    raise exception 'You can only remove a sign-up you added';
  end if;

  delete from public.fest_activity_signups where id = p_signup;
end;
$$;
revoke all on function public.remove_activity_signup(uuid) from public, anon;
grant execute on function public.remove_activity_signup(uuid) to authenticated;
