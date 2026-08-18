-- 0196_event_attendance_manual_add.sql
-- Manually add people to an event's RSVP list — for the event email's own
-- "reply here and you'll be added by hand" line (media-server/
-- event-email-template.js). An admin or the event's creator (can_manage_event,
-- 0190) can now add:
--
--   1. Someone ALREADY IN THE FAMILY — either a real member (has an app
--      account) or a pre-registered `family_roster` person who doesn't have
--      one yet. Both are picked from a search list, never typed free-hand, so
--      nobody accidentally hardcodes a name for someone the app already knows
--      about (which would silently create a second, disconnected "person").
--   2. A GUEST who isn't family at all — someone brought up to help who has
--      no roster entry and never will (this has actually happened at a work
--      weekend). Typed as plain text, on purpose: there's no record to link to.
--      Their email is OPTIONAL — a guest has no app account, so email is the
--      only way to keep them in the loop, and only about THIS one event (this
--      RPC is always scoped to one event_id; there is no path that reuses a
--      guest's email for anything else in the app). See migration 0197 for
--      where it's actually used: event_message_email()/event_message_preview()
--      fold it into the general recipient bucket.
--      Their sponsor — "who do they know" — is REQUIRED: a real member,
--      picked from a dropdown (never typed), so a random outside guest is
--      always traceable to whoever's vouching for them. `sponsor_user_id` is
--      nullable at the DB level only so it degrades gracefully if that
--      member's account is later deleted (`on delete set null`) — the RPC
--      itself always requires it at creation time.
--
-- These are two DELIBERATELY SEPARATE entry points in the UI
-- (components/EventAttendeeAdd.tsx: "Add someone in the family" vs.
-- "Add a guest") for exactly the reason above — collapsing them into one
-- "type a name" box is what caused the confusion this feature exists to fix.
--
-- ── Schema ────────────────────────────────────────────────────────────────────
-- event_attendance's PK was (event_id, user_id) with user_id NOT NULL — every
-- row was a real member's own RSVP. A manually-added row may represent a
-- roster person (no account: `roster_id`, not `user_id`) or an outside guest
-- (no account, no roster row: `guest_name` only). So:
--   - `user_id` becomes NULLABLE.
--   - `roster_id` (→ family_roster) and `guest_name` are new, both nullable.
--   - exactly one of the three is set per row (a plain member RSVP still
--     writes only `user_id`, unchanged).
--   - `added_by` records who manually added it (null for a self-RSVP).
--   - the old composite PK is replaced by a surrogate `id` (a guest row has no
--     natural key — two different guests can share a name), with PARTIAL
--     unique indexes standing in for the old PK on the other two cases so a
--     second add for the same member/roster person UPDATES instead of
--     duplicating.
--
-- set_event_attendance() (self-RSVP) is recreated from its CURRENT production
-- body (0122's) with only the ON CONFLICT target widened to name the same
-- partial index explicitly — no behavior change for a member RSVPing
-- themselves. clear_event_attendance() needs no change (still just
-- event_id + user_id = auth.uid()).
--
-- ⚠️ event_attendance now has THREE separate FKs to profiles (user_id,
-- sponsor_user_id, added_by) — any client `.select("...profiles(...)")` on
-- this table MUST name the FK explicitly
-- (`profiles!event_attendance_user_id_fkey(...)`) or PostgREST returns
-- PGRST201 "more than one relationship found" instead of data. This is the
-- exact embed-ambiguity trap already hit once on tournaments/tournament_entrants
-- — lib/events.ts's ATTENDANCE_SELECT is updated accordingly in this same change.

alter table public.event_attendance drop constraint event_attendance_pkey;
alter table public.event_attendance
  alter column user_id drop not null,
  add column id uuid not null default gen_random_uuid(),
  add column roster_id uuid references public.family_roster (id) on delete set null,
  add column guest_name text,
  add column guest_email text,
  add column sponsor_user_id uuid references public.profiles (id) on delete set null,
  add column added_by uuid references public.profiles (id) on delete set null,
  add constraint event_attendance_exactly_one_person
    check (num_nonnulls(user_id, roster_id, guest_name) = 1),
  add constraint event_attendance_guest_email_needs_guest
    check (guest_email is null or guest_name is not null);
alter table public.event_attendance add primary key (id);

create unique index event_attendance_event_user_uidx
  on public.event_attendance (event_id, user_id) where user_id is not null;
create unique index event_attendance_event_roster_uidx
  on public.event_attendance (event_id, roster_id) where roster_id is not null;

-- Recreated from 0122's current production body — the ON CONFLICT target now
-- names the partial index's predicate explicitly (required once the plain PK
-- is gone); everything else is verbatim.
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
  on conflict (event_id, user_id) where user_id is not null
  do update set status = excluded.status, days = excluded.days, confirmed = true, updated_at = now();
end;
$$;
revoke all on function public.set_event_attendance(text, text, jsonb) from public, anon;
grant execute on function public.set_event_attendance(text, text, jsonb) to authenticated;

-- ── Add / remove (manager-only) ───────────────────────────────────────────────

-- "Add someone in the family" — either branch resolves to a real name we
-- already have on file, never a typed one.
create or replace function public.add_event_family_member(
  p_event_id  text,
  p_user_id   uuid    default null,
  p_roster_id uuid    default null,
  p_status    text    default 'going'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only the event''s creator or an admin can add attendees';
  end if;
  if p_status not in ('going', 'maybe', 'not_going') then raise exception 'Invalid status'; end if;
  if num_nonnulls(p_user_id, p_roster_id) <> 1 then
    raise exception 'Pass exactly one of a member or a roster person';
  end if;

  if p_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'Member not found';
    end if;
    insert into public.event_attendance (event_id, user_id, status, added_by)
    values (btrim(p_event_id), p_user_id, p_status, auth.uid())
    on conflict (event_id, user_id) where user_id is not null
    do update set status = excluded.status, confirmed = true, added_by = excluded.added_by, updated_at = now()
    returning id into v_id;
  else
    if not exists (select 1 from public.family_roster where id = p_roster_id) then
      raise exception 'Roster person not found';
    end if;
    insert into public.event_attendance (event_id, roster_id, status, added_by)
    values (btrim(p_event_id), p_roster_id, p_status, auth.uid())
    on conflict (event_id, roster_id) where roster_id is not null
    do update set status = excluded.status, added_by = excluded.added_by, updated_at = now()
    returning id into v_id;
  end if;

  return v_id;
end;
$$;
revoke all on function public.add_event_family_member(text, uuid, uuid, text) from public, anon;
grant execute on function public.add_event_family_member(text, uuid, uuid, text) to authenticated;

-- "Add a guest" — a typed name, no roster/account link, because there's
-- nothing to link to (someone's friend, brought up to help for the weekend).
-- `p_sponsor_user_id` is REQUIRED — "who do they know" — a real member
-- picked from a dropdown in the UI (editable there in case the wrong person
-- was picked; this RPC just enforces "some member, not nobody"). Email is
-- optional: a guest has no app account, so it's the only way to keep them in
-- the loop about updates to THIS event (new tasks, notes, etc. via a future
-- "Email everyone" send) — never used for anything else in the app.
create or replace function public.add_event_guest(
  p_event_id        text,
  p_name            text,
  p_sponsor_user_id uuid,
  p_status          text default 'going',
  p_email           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only the event''s creator or an admin can add attendees';
  end if;
  if p_status not in ('going', 'maybe', 'not_going') then raise exception 'Invalid status'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'A name is required'; end if;
  if p_sponsor_user_id is null then raise exception 'Who do they know? Pick a member.'; end if;
  if not exists (select 1 from public.profiles where id = p_sponsor_user_id) then
    raise exception 'That member wasn''t found';
  end if;
  if v_email is not null and v_email not like '%@%' then
    raise exception 'That doesn''t look like an email address';
  end if;

  insert into public.event_attendance (event_id, guest_name, guest_email, sponsor_user_id, status, added_by)
  values (btrim(p_event_id), btrim(p_name), lower(v_email), p_sponsor_user_id, p_status, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_event_guest(text, text, uuid, text, text) from public, anon;
grant execute on function public.add_event_guest(text, text, uuid, text, text) to authenticated;

-- Remove any one attendance row by id — a manager can pull a guest/roster
-- entry they added by mistake, or a member's row on their behalf (e.g. they
-- emailed asking to be taken off the list). A member can still remove their
-- OWN row without being a manager (mirrors clear_event_attendance's self-only
-- rule, just addressed by id instead of event+uid).
create or replace function public.remove_event_attendance_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  text;
  v_user   uuid;
begin
  select event_id, user_id into v_event, v_user from public.event_attendance where id = p_id;
  if v_event is null then return; end if; -- already gone

  if not (public.can_manage_event(v_event) or v_user = auth.uid()) then
    raise exception 'Not allowed to remove this RSVP';
  end if;

  delete from public.event_attendance where id = p_id;
end;
$$;
revoke all on function public.remove_event_attendance_entry(uuid) from public, anon;
grant execute on function public.remove_event_attendance_entry(uuid) to authenticated;
