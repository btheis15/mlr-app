-- 0143_signup_headcount_and_teams.sql
-- Two extensions to schedule-event sign-ups (migrations 0135/0136), both
-- driven by "not every sign-up needs a time slot, and some need to be signed
-- up in fixed-size groups":
--
--   1. A third signup_mode = 'headcount' — no time dimension at all, just a
--      running count of who's coming (e.g. "who wants to play cornhole").
--      signup_capacity is OPTIONAL in this mode (null = no cap, just track
--      who's in). Reuses the exact same fest_schedule_signups table with
--      slot_start AND slot_id both null — the "no slot" bucket.
--
--   2. signup_team_size (default 1 = individual, as today). When the creator
--      sets it above 1 (e.g. 2 for baggo doubles), one sign-up action commits
--      a whole team at once — every member's name/link resolved and inserted
--      together, sharing a generated team_id (+ optional team_name the signer
--      can give it). Applies to ANY mode (headcount, interval, or slots) —
--      a specific-time slot can just as easily be "one doubles team" as it can
--      be "one person." Capacity stays a plain people-count (unchanged math),
--      so a team of 2 simply consumes 2 of a slot's/event's capacity.
--
-- Scoped to fest_schedule_items/fest_schedule_signups only — NOT mirrored to
-- fest_activities (the parallel iOS-only tables from migration 0138). Web
-- retired the separate "activities" concept in 0141; iOS parity for this pair
-- of features would be a separate follow-up if/when needed there.
--
-- Also fixes a latent bug found while extending this exact column: 0136's
-- insert can put a NULL into fest_schedule_signups.slot_start (when
-- p_slot_id is set, "case when p_slot_id is null then p_slot end" evaluates
-- to NULL) but the column was never widened past 0135's `not null` — so
-- "specific times" (signup_mode = 'slots') sign-ups have been failing with a
-- not-null violation since 0136 shipped. No signups exist yet with slot_id
-- set (verified against production), so no backfill is needed.

alter table public.fest_schedule_signups alter column slot_start drop not null;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.fest_schedule_items'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%signup_mode%'
  loop
    execute format('alter table public.fest_schedule_items drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.fest_schedule_items
  add constraint fest_schedule_items_signup_mode_check check (signup_mode in ('interval', 'slots', 'headcount'));

alter table public.fest_schedule_items
  add column if not exists signup_team_size int; -- null/1 = individual; e.g. 2 = sign up in pairs

alter table public.fest_schedule_signups
  add column if not exists team_id   uuid, -- shared by every row of one team sign-up; null for an individual
  add column if not exists team_name text; -- optional label the signer gave the team

-- ── Sign up — now also: no slot at all (headcount), and/or a whole team ──────
-- p_team_members: when set (non-empty), a jsonb array of
--   [{ "for_user": uuid|null, "name": text|null, "fields": {...} }, …] — one
--   element per team member, inserted together sharing one new team_id.
--   Omitted/empty ⇒ the original single-row behavior (p_for_user/p_name/
--   p_fields), unchanged — fully backward compatible with every existing
--   call site.
-- p_team_name: optional label for a team sign-up (ignored for a solo row).
-- Neither p_slot nor p_slot_id ⇒ headcount mode (the item's one "no slot"
-- bucket) — raises if the item isn't actually in headcount mode, same as the
-- existing guard against a stale/mismatched slot reference.
drop function if exists public.sign_up_for_schedule_slot(uuid, text, uuid, text, uuid, jsonb);
create or replace function public.sign_up_for_schedule_slot(
  p_item         uuid,
  p_slot         text    default null,
  p_for_user     uuid    default null,
  p_name         text    default null,
  p_slot_id      uuid    default null,
  p_fields       jsonb   default '{}'::jsonb,
  p_team_members jsonb   default null,
  p_team_name    text    default null
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
  v_cap        int;
  v_taken      int;
  v_members    jsonb;
  v_member     jsonb;
  v_count      int;
  v_team_id    uuid;
  v_uid_target uuid;
  v_name       text;
  v_field      jsonb;
  v_fid        text;
  v_first_id   uuid;
  v_id         uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_item from public.fest_schedule_items where id = p_item;
  if not found then raise exception 'Event not found'; end if;
  if not v_item.signup_enabled then raise exception 'This event isn''t taking sign-ups'; end if;

  -- Resolve the slot (or the headcount bucket) + its capacity.
  if p_slot_id is not null then
    select * into v_slot from public.fest_schedule_slots
      where id = p_slot_id and schedule_item_id = p_item;
    if not found then raise exception 'That time slot isn''t available'; end if;
    v_cap := coalesce(v_slot.capacity, v_item.signup_capacity, 0);
  elsif p_slot is not null then
    if coalesce(btrim(p_slot), '') = '' or not exists (
      select 1 from public.fest_schedule_slot_starts(v_item) s where s = p_slot
    ) then
      raise exception 'That time slot isn''t available';
    end if;
    v_cap := coalesce(v_item.signup_capacity, 0);
  else
    if v_item.signup_mode is distinct from 'headcount' then
      raise exception 'This event needs a time slot';
    end if;
    v_cap := v_item.signup_capacity; -- nullable ⇒ no cap, just a running headcount
  end if;

  -- Normalize to one list of members — a single legacy call becomes a
  -- one-element "team" so there's exactly one insert path below.
  if p_team_members is not null and jsonb_array_length(p_team_members) > 0 then
    v_members := p_team_members;
    v_team_id := gen_random_uuid();
  else
    v_members := jsonb_build_array(jsonb_build_object('for_user', p_for_user, 'name', p_name, 'fields', coalesce(p_fields, '{}'::jsonb)));
    v_team_id := null; -- solo sign-up — no team grouping
  end if;
  v_count := jsonb_array_length(v_members);

  select count(*) into v_taken
  from public.fest_schedule_signups
  where schedule_item_id = p_item
    and (
      (p_slot_id is not null and slot_id = p_slot_id)
      or (p_slot_id is null and p_slot is not null and slot_id is null and slot_start = p_slot)
      or (p_slot_id is null and p_slot is null and slot_id is null and slot_start is null)
    );
  if v_cap is not null and v_taken + v_count > v_cap then
    raise exception 'Not enough spots left';
  end if;

  for v_member in select * from jsonb_array_elements(v_members) loop
    if (v_member->>'for_user') is not null and (v_member->>'for_user')::uuid <> v_uid then
      v_uid_target := (v_member->>'for_user')::uuid;
      select display_name into v_name from public.profiles where id = v_uid_target;
      if v_name is null then raise exception 'Member not found'; end if;
    elsif coalesce(btrim(v_member->>'name'), '') <> '' then
      v_uid_target := null;
      v_name := btrim(v_member->>'name');
    else
      v_uid_target := v_uid;
      select display_name into v_name from public.profiles where id = v_uid;
    end if;

    for v_field in select * from jsonb_array_elements(coalesce(v_item.signup_fields, '[]'::jsonb)) loop
      v_fid := v_field->>'id';
      if v_fid is not null and coalesce(btrim((v_member->'fields')->>v_fid), '') = '' then
        raise exception 'Please fill in "%"', coalesce(v_field->>'label', 'all fields');
      end if;
    end loop;

    if v_uid_target is not null and exists (
      select 1 from public.fest_schedule_signups
      where schedule_item_id = p_item
        and user_id = v_uid_target
        and (
          (p_slot_id is not null and slot_id = p_slot_id)
          or (p_slot_id is null and p_slot is not null and slot_id is null and slot_start = p_slot)
          or (p_slot_id is null and p_slot is null and slot_id is null and slot_start is null)
        )
    ) then
      raise exception 'Already signed up';
    end if;

    insert into public.fest_schedule_signups
      (schedule_item_id, slot_start, slot_id, user_id, name, added_by, fields, team_id, team_name)
    values (
      p_item,
      case when p_slot_id is null then p_slot end,
      p_slot_id,
      v_uid_target,
      v_name,
      v_uid,
      coalesce(v_member->'fields', '{}'::jsonb),
      v_team_id,
      case when v_team_id is not null then nullif(btrim(coalesce(p_team_name, '')), '') end
    )
    returning id into v_id;
    if v_first_id is null then v_first_id := v_id; end if;
  end loop;

  return v_first_id;
end;
$$;
revoke all on function public.sign_up_for_schedule_slot(uuid, text, uuid, text, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.sign_up_for_schedule_slot(uuid, text, uuid, text, uuid, jsonb, jsonb, text) to authenticated;
