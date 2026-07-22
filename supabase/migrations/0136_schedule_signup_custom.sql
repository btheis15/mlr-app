-- Extends the "limited sign-up" feature (migration 0135) three ways, all
-- driven by the feature request "you don't have to have an event range":
--
--   1. EXPLICIT time slots. 0135 only derived slots from an interval + a
--      first/last time (all on the event's single day, all the same length).
--      A new `signup_mode = 'slots'` lets the creator list arbitrary,
--      independent slots instead — each with its OWN day + start time, an
--      optional end time, an optional label, and an optional per-slot
--      capacity. So "Mon 10:50am, Mon 3:58pm, Wed 1:48pm" is expressible, and
--      no two slots need to share a length or increment. The rows live in a
--      new `fest_schedule_slots` child table (the interval mode keeps deriving
--      its slots as before — nothing there changes).
--
--   2. SIGN-UP INSTRUCTIONS + CUSTOM COLUMNS. `signup_instructions` is a
--      free-text note the creator writes for signers. `signup_fields` is an
--      ordered jsonb array of {id,label} — extra columns required on every
--      person's row (e.g. a play's sign-up wants "Name" + "Character"). The
--      per-person values land in `fest_schedule_signups.fields` (a jsonb map
--      keyed by field id).
--
--   3. ANYONE CAN SIGN UP ANYONE. 0135 let a regular member add only
--      THEMSELVES; only an organizer could add others. The request is that any
--      signed-in member fill out a row for anyone they want — a linked member
--      or a hard-coded name — and add several. So the organizer gate on
--      `p_for_user`/`p_name` is dropped from sign_up_for_schedule_slot; removal
--      is still limited to the row's adder, the linked person, or an organizer.

-- ── New event-level config ───────────────────────────────────────────────────
alter table public.fest_schedule_items
  add column if not exists signup_mode         text not null default 'interval'
    check (signup_mode in ('interval', 'slots')),
  add column if not exists signup_instructions text,
  -- [{ "id": "...", "label": "..." }, …] — extra required columns per person.
  add column if not exists signup_fields       jsonb not null default '[]'::jsonb;

-- ── Explicit, independent time slots (signup_mode = 'slots') ─────────────────
-- Unlike the interval config on the event, each row here is a fully standalone
-- slot: its own day + start, and it doesn't have to match any other slot's
-- length or spacing. `capacity` null falls back to the event's signup_capacity.
create table if not exists public.fest_schedule_slots (
  id               uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references public.fest_schedule_items (id) on delete cascade,
  day              text,           -- ISO "YYYY-MM-DD"; null ⇒ the event's own day
  start_time       text not null,  -- "HH:MM"
  end_time         text,           -- "HH:MM", optional
  label            text,           -- optional override for the auto "day · time" label
  capacity         int,            -- optional per-slot cap; null ⇒ event's signup_capacity
  position         int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists fest_schedule_slots_item_idx
  on public.fest_schedule_slots (schedule_item_id, position);

alter table public.fest_schedule_slots enable row level security;
-- Public read like the rest of the fest content; writes below are gated to
-- whoever can manage this event's sign-ups (fest editor OR its lead/crew).
drop policy if exists "fest_schedule_slots: public read" on public.fest_schedule_slots;
create policy "fest_schedule_slots: public read" on public.fest_schedule_slots for select using (true);

do $$ begin alter publication supabase_realtime add table public.fest_schedule_slots; exception when duplicate_object then null; end $$;

-- ── Per-person custom-column values + the explicit-slot link ─────────────────
alter table public.fest_schedule_signups
  add column if not exists slot_id uuid references public.fest_schedule_slots (id) on delete cascade,
  add column if not exists fields  jsonb not null default '{}'::jsonb;

-- One linked member per explicit slot (mirrors the 0135 index for interval
-- slots, which keyed on slot_start). Free-text names (user_id null) aren't
-- de-duped — the same character might legitimately be filled by two people.
create unique index if not exists fest_schedule_signups_slotid_user_idx
  on public.fest_schedule_signups (slot_id, user_id)
  where slot_id is not null and user_id is not null;

-- ── May this caller manage the event's sign-up setup? (id overload) ──────────
-- The RLS policies on fest_schedule_slots need the row-taking
-- _can_manage_schedule_signups() (0135) but only have the child's
-- schedule_item_id, so wrap it.
create or replace function public._can_manage_item_signups(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fest_schedule_items i
    where i.id = p_item_id and public._can_manage_schedule_signups(i)
  );
$$;
revoke all on function public._can_manage_item_signups(uuid) from public, anon;
grant execute on function public._can_manage_item_signups(uuid) to authenticated;

drop policy if exists "fest_schedule_slots: manage insert" on public.fest_schedule_slots;
create policy "fest_schedule_slots: manage insert" on public.fest_schedule_slots
  for insert with check (public._can_manage_item_signups(schedule_item_id));
drop policy if exists "fest_schedule_slots: manage update" on public.fest_schedule_slots;
create policy "fest_schedule_slots: manage update" on public.fest_schedule_slots
  for update using (public._can_manage_item_signups(schedule_item_id))
             with check (public._can_manage_item_signups(schedule_item_id));
drop policy if exists "fest_schedule_slots: manage delete" on public.fest_schedule_slots;
create policy "fest_schedule_slots: manage delete" on public.fest_schedule_slots
  for delete using (public._can_manage_item_signups(schedule_item_id));

-- ── Sign up for a slot — now OPEN to any member, for anyone, with fields ─────
-- p_slot_id  : the explicit slot (signup_mode = 'slots').
-- p_slot     : the "HH:MM" slot_start (interval mode) — mutually exclusive with p_slot_id.
-- p_for_user : link this row to a member (their profile name is snapshotted).
-- p_name     : a free-text, account-less name.
-- p_fields   : { fieldId: value } for the event's custom columns (all required).
-- Neither for_user nor name ⇒ the caller signs themselves up.
drop function if exists public.sign_up_for_schedule_slot(uuid, text, uuid, text);
create or replace function public.sign_up_for_schedule_slot(
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
  v_item       public.fest_schedule_items;
  v_slot       public.fest_schedule_slots;
  v_uid_target uuid;
  v_name       text;
  v_cap        int;
  v_taken      int;
  v_id         uuid;
  v_field      jsonb;
  v_fid        text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_item from public.fest_schedule_items where id = p_item;
  if not found then raise exception 'Event not found'; end if;
  if not v_item.signup_enabled then raise exception 'This event isn''t taking sign-ups'; end if;

  -- Resolve the slot + its capacity for either mode.
  if p_slot_id is not null then
    select * into v_slot from public.fest_schedule_slots
      where id = p_slot_id and schedule_item_id = p_item;
    if not found then raise exception 'That time slot isn''t available'; end if;
    v_cap := coalesce(v_slot.capacity, v_item.signup_capacity, 0);
  else
    if coalesce(btrim(p_slot), '') = '' or not exists (
      select 1 from public.fest_schedule_slot_starts(v_item) s where s = p_slot
    ) then
      raise exception 'That time slot isn''t available';
    end if;
    v_cap := coalesce(v_item.signup_capacity, 0);
  end if;

  -- Who is this row for? Any signed-in member may add anyone.
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

  -- Every custom column the creator defined is required on each row.
  for v_field in select * from jsonb_array_elements(coalesce(v_item.signup_fields, '[]'::jsonb)) loop
    v_fid := v_field->>'id';
    if v_fid is not null and coalesce(btrim(p_fields->>v_fid), '') = '' then
      raise exception 'Please fill in "%"', coalesce(v_field->>'label', 'all fields');
    end if;
  end loop;

  -- One seat per linked member per slot.
  if v_uid_target is not null and exists (
    select 1 from public.fest_schedule_signups
    where schedule_item_id = p_item
      and user_id = v_uid_target
      and ((p_slot_id is not null and slot_id = p_slot_id)
        or (p_slot_id is null and slot_id is null and slot_start = p_slot))
  ) then
    raise exception 'Already signed up for that slot';
  end if;

  select count(*) into v_taken
  from public.fest_schedule_signups
  where schedule_item_id = p_item
    and ((p_slot_id is not null and slot_id = p_slot_id)
      or (p_slot_id is null and slot_id is null and slot_start = p_slot));
  if v_taken >= v_cap then raise exception 'That time slot is full'; end if;

  insert into public.fest_schedule_signups (schedule_item_id, slot_start, slot_id, user_id, name, added_by, fields)
  values (p_item, case when p_slot_id is null then p_slot end, p_slot_id, v_uid_target, v_name, v_uid,
          coalesce(p_fields, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sign_up_for_schedule_slot(uuid, text, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.sign_up_for_schedule_slot(uuid, text, uuid, text, uuid, jsonb) to authenticated;

-- ── Remove a sign-up — the person, the row's ADDER, or the organizer ─────────
-- (0135 allowed the person or an organizer; adding "the adder" so whoever wrote
-- a free-text row for someone else can undo it, now that anyone can add anyone.)
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

  if v_signup.user_id is distinct from v_uid
     and v_signup.added_by is distinct from v_uid
     and not public._can_manage_schedule_signups(v_item) then
    raise exception 'You can only remove a sign-up you added';
  end if;

  delete from public.fest_schedule_signups where id = p_signup;
end;
$$;
revoke all on function public.remove_schedule_signup(uuid) from public, anon;
grant execute on function public.remove_schedule_signup(uuid) to authenticated;
